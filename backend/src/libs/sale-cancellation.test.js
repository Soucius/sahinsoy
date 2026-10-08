import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { createSale, updateSale, cancelSale } from "../controllers/sale.controller.js";

const userId = "000000000000000000000001";
const saleId = "000000000000000000000002";
const productId = "000000000000000000000003";
const otherProductId = "000000000000000000000004";
const missingProductId = "000000000000000000000005";
const clone = (value) => JSON.parse(JSON.stringify(value));
const item = (product = productId, quantity = 2) => ({
    product, quantity, unit_price: 10, total_price: quantity * 10,
});
const payload = (overrides = {}) => {
    const saleItems = overrides.sale_items || [item()];
    const total = saleItems.reduce((sum, entry) => sum + entry.total_price, 0);
    return {
        sale_items: saleItems, sub_total: total, grand_total: total,
        status: "tamamlandi", payment_method: "Nakit", ...overrides,
    };
};
const storedSale = (overrides = {}) => clone(new Sale({
    _id: saleId, sold_by: userId, ...payload(overrides),
}).toObject());
const storedProduct = (overrides = {}) => ({
    _id: productId, product_name: "TEST product", stock_quantity: 10,
    stock_tracking: true, ...overrides,
});

// Keep real Mongoose casting and schema validation, replacing database I/O only.
// The transaction mock rolls back durable state on a failure. These tests verify
// controller behavior and session usage; MongoDB write-conflict handling still
// requires integration verification against a replica set.
function database(t, { sales = [], products = [], rejectStockUpdate = null } = {}) {
    const state = {
        sales: new Map(sales.map((sale) => [String(sale._id), clone(sale)])),
        products: new Map(products.map((product) => [String(product._id), clone(product)])),
    };
    const sessions = [], stockWrites = [], saleWrites = [];
    const snapshot = () => ({
        sales: new Map([...state.sales].map(([id, sale]) => [id, clone(sale)])),
        products: new Map([...state.products].map(([id, product]) => [id, clone(product)])),
    });
    const query = (read) => {
        let selectedSession;
        return {
            session(session) { selectedSession = session; return this; },
            populate() { return this; },
            then(resolve, reject) {
                if (selectedSession) assert.equal(selectedSession.active, true);
                return Promise.resolve().then(read).then(resolve, reject);
            },
        };
    };
    t.mock.method(mongoose, "startSession", async () => {
        const session = {
            active: false, transactions: 0, ended: false,
            async withTransaction(callback) {
                const before = snapshot();
                this.active = true;
                this.transactions += 1;
                try { return await callback(); }
                catch (error) { state.sales = before.sales; state.products = before.products; throw error; }
                finally { this.active = false; }
            },
            async endSession() { this.ended = true; },
        };
        sessions.push(session);
        return session;
    });
    t.mock.method(Sale, "findById", (id) => query(() => {
        const record = state.sales.get(String(id));
        return record ? Sale.hydrate(clone(record)) : null;
    }));
    t.mock.method(Sale, "findOne", (filter) => query(() => {
        const record = [...state.sales.values()].find((sale) =>
            sale.client_request_id === filter.client_request_id && sale.sold_by === String(filter.sold_by));
        return record ? Sale.hydrate(clone(record)) : null;
    }));
    t.mock.method(Sale.prototype, "save", async function ({ session } = {}) {
        assert.equal(session?.active, true, "sale writes must share the transaction");
        await this.validate();
        const record = clone(this.toObject());
        saleWrites.push(record);
        state.sales.set(String(this._id), record);
        return this;
    });
    t.mock.method(Product, "findById", (id) => query(() => {
        const record = state.products.get(String(id));
        return record ? clone(record) : null;
    }));
    t.mock.method(Product, "updateOne", async (filter, update, { session } = {}) => {
        assert.equal(session?.active, true, "stock writes must share the transaction");
        const id = String(filter._id);
        stockWrites.push({ id, filter: clone(filter), update: clone(update), session });
        const record = state.products.get(id);
        if (!record || (filter.stock_quantity && record.stock_quantity < filter.stock_quantity.$gte)
            || rejectStockUpdate === id) return { modifiedCount: 0, matchedCount: 0 };
        assert.equal(typeof update.$inc.stock_quantity, "number");
        record.stock_quantity += update.$inc.stock_quantity;
        return { modifiedCount: 1, matchedCount: 1 };
    });
    const request = async (controller, body = {}, id = saleId) => {
        const response = {
            statusCode: 200, body: null,
            status(code) { this.statusCode = code; return this; },
            json(value) { this.body = value; return this; },
        };
        await controller({ body, params: { id }, user: { _id: userId } }, response);
        assert.equal(sessions.at(-1).ended, true, "controller must always end its session");
        return response;
    };
    return {
        request, stockWrites, saleWrites, sessions,
        sale: (id = saleId) => state.sales.get(String(id)),
        stock: (id = productId) => state.products.get(String(id))?.stock_quantity,
    };
}

test("direct approval records aggregated actual deductions and cancellation restores them once", async (t) => {
    const db = database(t, { products: [storedProduct(), storedProduct({
        _id: otherProductId, product_name: "Untracked", stock_quantity: 0, stock_tracking: false,
    })] });
    const approved = await db.request(createSale, payload({ sale_items: [
        item(productId, 1.25), item(productId, 0.75), item(otherProductId, 3),
    ] }));
    assert.equal(approved.statusCode, 201);
    assert.equal(db.stock(), 8);
    assert.equal(db.stock(otherProductId), 0);
    assert.deepEqual(db.sale(approved.body._id).stock_deductions, [{ product: productId, quantity: 2 }]);
    assert.ok(approved.body.approved_at instanceof Date);
    assert.equal(db.stockWrites.length, 1);

    const cancelled = await db.request(cancelSale, {}, String(approved.body._id));
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.status, "iptal");
    assert.equal(cancelled.body.stock_restoration_pending, false);
    assert.equal(String(cancelled.body.cancelled_by), userId);
    assert.equal(db.stock(), 10);
    const cancelledAt = cancelled.body.cancelled_at.getTime();
    const saveCount = db.saleWrites.length;

    const repeated = await db.request(cancelSale, {}, String(approved.body._id));
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.cancelled_at.getTime(), cancelledAt);
    assert.equal(db.stock(), 10);
    assert.equal(db.stockWrites.length, 2, "one deduction and one restoration only");
    assert.equal(db.saleWrites.length, saveCount, "repeat cancellation must not rewrite its timestamp");
});

test("pending approval records submitted quantities and cannot accept a client-supplied ledger", async (t) => {
    const db = database(t, { sales: [storedSale({ status: "beklemede" })], products: [storedProduct()] });
    const approved = await db.request(updateSale, payload({
        sale_items: [item(productId, 1.5), item(productId, 0.5)],
        stock_deductions: [{ product: productId, quantity: 999 }],
        stock_restoration_pending: true, cancelled_at: "2000-01-01T00:00:00.000Z",
    }));
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.body.status, "tamamlandi");
    assert.equal(db.stock(), 8);
    assert.deepEqual(db.sale().stock_deductions, [{ product: productId, quantity: 2 }]);
    assert.equal(approved.body.stock_restoration_pending, false);
    assert.equal(approved.body.cancelled_at, null);
    assert.ok(approved.body.approved_at instanceof Date);
});

test("cancellation restores recorded quantity even when tracking is now disabled", async (t) => {
    const db = database(t, {
        sales: [storedSale({ sale_items: [item(productId, 5)], stock_deductions: [{ product: productId, quantity: 1.5 }] })],
        products: [storedProduct({ stock_tracking: false, stock_quantity: 4 })],
    });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 200);
    assert.equal(db.stock(), 5.5, "restore ledger quantity, not sale item quantity or current tracking policy");
    assert.equal(response.body.stock_restoration_pending, false);
    assert.deepEqual(db.stockWrites[0].filter, { _id: productId });
});

test("an explicitly empty ledger needs no stock refund or manual warning", async (t) => {
    const db = database(t, { sales: [storedSale({ stock_deductions: [] })], products: [storedProduct({ stock_tracking: false })] });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "iptal");
    assert.equal(response.body.stock_restoration_pending, false);
    assert.equal(db.stock(), 10);
    assert.equal(db.stockWrites.length, 0);
    assert.deepEqual(db.sale().stock_deductions, []);
});

for (const stockTracking of [true, false]) {
    test(`legacy approved order has no automatic refund when current tracking is ${stockTracking}`, async (t) => {
        const legacy = storedSale();
        delete legacy.stock_deductions;
        const db = database(t, { sales: [legacy], products: [storedProduct({ stock_tracking: stockTracking })] });
        const response = await db.request(cancelSale);
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.status, "iptal");
        assert.equal(response.body.stock_deductions, null, "legacy missing field remains distinct from a known empty ledger");
        assert.equal(response.body.stock_restoration_pending, true);
        assert.equal(db.stock(), 10);
        assert.equal(db.stockWrites.length, 0);
    });
}

test("missing ledger product defers the whole restoration without a partial refund", async (t) => {
    const db = database(t, {
        sales: [storedSale({ stock_deductions: [
            { product: productId, quantity: 2 }, { product: missingProductId, quantity: 3 },
        ] })], products: [storedProduct({ stock_quantity: 8 })],
    });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "iptal");
    assert.equal(response.body.stock_restoration_pending, true);
    assert.equal(db.stock(), 8);
    assert.equal(db.stockWrites.length, 0, "preflight must find all ledger products before any refund");
    assert.equal(db.sale().stock_deductions.length, 2, "preserve ledger for manual review");
});

test("pending cancellation changes only order state without touching stock", async (t) => {
    const db = database(t, { sales: [storedSale({ status: "beklemede" })], products: [storedProduct()] });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "iptal");
    assert.equal(response.body.stock_restoration_pending, false);
    assert.ok(response.body.cancelled_at instanceof Date);
    assert.equal(db.stock(), 10);
    assert.equal(db.stockWrites.length, 0);
});

test("cancelled orders reject reopening and item edits with 409", async (t) => {
    const cancelledAt = "2020-01-01T00:00:00.000Z";
    const db = database(t, { sales: [storedSale({ status: "iptal", cancelled_at: cancelledAt })], products: [storedProduct()] });
    for (const body of [{ status: "tamamlandi" }, { status: "beklemede" }, { sale_items: [item()] }]) {
        const response = await db.request(updateSale, body);
        assert.equal(response.statusCode, 409);
        assert.match(response.body.message, /İptal edilmiş sipariş/);
    }
    assert.equal(db.sale().status, "iptal");
    assert.equal(db.sale().cancelled_at, cancelledAt);
    assert.equal(db.stock(), 10);
    assert.equal(db.stockWrites.length, 0);
    assert.equal(db.saleWrites.length, 0);
});

test("cancel request body cannot spoof refund quantities, state, timestamp or cancelling user", async (t) => {
    const db = database(t, {
        sales: [storedSale({ stock_deductions: [{ product: productId, quantity: 2 }] })],
        products: [storedProduct({ stock_quantity: 8 })],
    });
    const response = await db.request(cancelSale, {
        stock_deductions: [{ product: productId, quantity: 999 }],
        sale_items: [item(productId, 999)], status: "tamamlandi",
        stock_restoration_pending: true, cancelled_at: "2000-01-01T00:00:00.000Z",
        cancelled_by: otherProductId, refund_quantity: 999,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "iptal");
    assert.equal(db.stock(), 10);
    assert.equal(response.body.sale_items[0].quantity, 2);
    assert.deepEqual(db.sale().stock_deductions, [{ product: productId, quantity: 2 }]);
    assert.equal(response.body.stock_restoration_pending, false);
    assert.equal(String(response.body.cancelled_by), userId);
    assert.notEqual(response.body.cancelled_at.toISOString(), "2000-01-01T00:00:00.000Z");
});

test("failed stock restoration returns 409 and rolls back earlier refunds and cancellation", async (t) => {
    const db = database(t, {
        sales: [storedSale({ stock_deductions: [
            { product: productId, quantity: 2 }, { product: otherProductId, quantity: 3 },
        ] })], products: [storedProduct({ stock_quantity: 8 }), storedProduct({ _id: otherProductId, stock_quantity: 7 })],
        rejectStockUpdate: otherProductId,
    });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 409);
    assert.equal(db.stock(), 8);
    assert.equal(db.stock(otherProductId), 7);
    assert.equal(db.sale().status, "tamamlandi");
    assert.equal(db.sale().cancelled_at, null);
    assert.equal(db.stockWrites.length, 2);
    assert.equal(db.saleWrites.length, 0);
});

test("a missing order returns 404 without a stock mutation", async (t) => {
    const db = database(t, { products: [storedProduct()] });
    const response = await db.request(cancelSale);
    assert.equal(response.statusCode, 404);
    assert.equal(db.stock(), 10);
    assert.equal(db.stockWrites.length, 0);
    assert.equal(db.saleWrites.length, 0);
});
