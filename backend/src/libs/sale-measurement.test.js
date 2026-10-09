import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { createSale, updateSale, cancelSale, planSaleMeasurement, reviseSaleMeasurements } from "../controllers/sale.controller.js";

const userId = "000000000000000000000001";
const saleId = "000000000000000000000002";
const productId = "000000000000000000000003";
const secondProductId = "000000000000000000000004";
const clone = (value) => JSON.parse(JSON.stringify(value));
const line = (id = "curtain-1", product = productId) => ({
    id, product_id: product, product_name: "Ölçü TEST Tül", brand_name: "TEST", category_name: "Tül",
    mode: "textile", calc_type: "mt", width: 400, height: 260, pieces: 1, count: 1,
    order_mode: "adet", panels: [{ label: "Perde", width: 400, height: 260, cut_width: 1240 }],
    quantity: 12.4, unit_label: "m", pleat_name: "Sık pile", pleat_factor: 3,
    base_unit_price: 500, material_total: 6200, labor_unit_price: 90, labor_total: 1116,
    accessories: [], accessories_total: 0, unit_price: 590, item_total: 7316,
    original_currency: "TRY", original_unit_price: 500, currency_rate: 1,
    calculation_note: "4 m × 3 + 0,40 m dikiş payı", room_name: "Salon", area: "Pencere 1",
    facade: "Kuzey Cephe", window_name: "Standart Pencere", variant: "V01 · Beyaz", item_note: "Not korunur",
    stock_tracked: true, stock_available: 50,
});
const item = (entry) => ({
    product: entry.product_id, quantity: entry.quantity, width: entry.width, height: entry.height,
    unit_price: entry.unit_price, total_price: entry.item_total, room_name: "Salon / Pencere 1",
    facade: entry.facade, window_name: entry.window_name, item_note: "Renk / VR: V01 · Beyaz", is_ordered: true,
});
const storedSale = (overrides = {}, lines = [line()]) => {
    const subtotal = lines.reduce((sum, entry) => sum + entry.item_total, 0);
    const record = clone(new Sale({
        _id: saleId, sold_by: userId, client_request_id: "initial-order-123", approved_at: "2026-10-01T10:00:00.000Z",
        sale_items: lines.map(item), pos_details: { version: 1, cart: lines, header: { first_name: "TEST", last_name: "Ölçü", customer_phone: "05550000000", delivery_method: "montaj", payment_method: "Nakit", sale_note: "Kapora alındı" }, discount_percent: 10, delivery_method: "montaj" },
        sub_total: subtotal, discount_amount: Math.round(subtotal * 10) / 100, discount_percent: 10,
        credit_card_fee: 100, grand_total: Math.round(subtotal * 90) / 100 + 100,
        status: "tamamlandi", payment_method: "Nakit", customer_name: "TEST Ölçü", customer_phone: "05550000000",
        customer_address: "TEST adres", delivery_date: "2026-10-20", delivery_method: "montaj", sale_note: "Kapora alındı",
        stock_deductions: [{ product: productId, quantity: 12.4 }], ...overrides,
    }).toObject());
    // Unknown payment fields on a historic record must not be reset by this narrow operation.
    record.deposit_paid = 3000;
    return record;
};
const storedProduct = (id = productId, stock = 30) => ({
    _id: id, product_name: "Ölçü TEST Tül", stock_quantity: stock, stock_tracking: true,
    calculation_type: "mt", sale_price: 9999, labor_price: 9999, product_category: { category_name: "Tül" },
});
const confirm = (width = 500, expected = 0, request = "measurement-request-001", id = "curtain-1") => ({
    measurements: [{ line_id: id, width, height: 265 }], measurement_date: "2026-10-09",
    measurement_master: "TEST Usta", measurement_note: "Evde alınan ölçü", expected_revision: expected, client_request_id: request,
});

// Use real model casting/validation and shared price calculations. Only durable I/O
// is mocked; snapshot rollback models transaction failure, not MongoDB concurrency.
function database(t, { sales = [storedSale()], products = [storedProduct()], rejectStockUpdate = null } = {}) {
    const state = { sales: new Map(sales.map((sale) => [String(sale._id), clone(sale)])), products: new Map(products.map((product) => [String(product._id), clone(product)])) };
    const stockWrites = [], saleWrites = [], sessions = [];
    const query = (read) => {
        let selectedSession;
        return {
            session(session) { selectedSession = session; return this; }, populate() { return this; },
            then(resolve, reject) { if (selectedSession) assert.equal(selectedSession.active, true); return Promise.resolve().then(read).then(resolve, reject); },
        };
    };
    t.mock.method(mongoose, "startSession", async () => {
        const session = {
            active: false, ended: false,
            async withTransaction(callback) {
                const beforeSales = new Map([...state.sales].map(([id, record]) => [id, clone(record)]));
                const beforeProducts = new Map([...state.products].map(([id, record]) => [id, clone(record)]));
                this.active = true;
                try { return await callback(); }
                catch (error) { state.sales = beforeSales; state.products = beforeProducts; throw error; }
                finally { this.active = false; }
            }, async endSession() { this.ended = true; },
        };
        sessions.push(session); return session;
    });
    t.mock.method(Sale, "findById", (id) => query(() => {
        const record = state.sales.get(String(id)); return record ? Sale.hydrate(clone(record)) : null;
    }));
    t.mock.method(Sale, "findOne", (filter) => query(() => {
        const record = [...state.sales.values()].find((sale) => sale.client_request_id === filter.client_request_id && sale.sold_by === String(filter.sold_by));
        return record ? Sale.hydrate(clone(record)) : null;
    }));
    t.mock.method(Sale.prototype, "save", async function ({ session } = {}) {
        assert.equal(session?.active, true, "sale write shares stock transaction"); await this.validate();
        const record = clone(this.toObject()); saleWrites.push(record); state.sales.set(String(this._id), record); return this;
    });
    t.mock.method(Product, "findById", (id) => query(() => clone(state.products.get(String(id)) || null)));
    t.mock.method(Product, "updateOne", async (filter, update, { session } = {}) => {
        assert.equal(session?.active, true, "stock write shares sale transaction");
        const id = String(filter._id), record = state.products.get(id);
        stockWrites.push({ id, filter: clone(filter), update: clone(update) });
        if (!record || (filter.stock_quantity && record.stock_quantity < filter.stock_quantity.$gte) || id === rejectStockUpdate) return { modifiedCount: 0 };
        record.stock_quantity = Math.round((record.stock_quantity + update.$inc.stock_quantity) * 1000000) / 1000000;
        return { modifiedCount: 1 };
    });
    return {
        async request(controller, body = {}, id = saleId) {
            const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
            await controller({ body, params: { id }, user: { _id: userId } }, response);
            assert.equal(sessions.at(-1).ended, true); return response;
        },
        sale: (id = saleId) => state.sales.get(String(id)), stock: (id = productId) => state.products.get(String(id))?.stock_quantity,
        stockWrites, saleWrites,
    };
}

test("planning an already approved order records appointment only, preserving prices, payment and stock", async (t) => {
    const original = storedSale(), db = database(t, { sales: [original] });
    const response = await db.request(planSaleMeasurement, { measurement_date: "2026-10-11", measurement_master: "Ömer Usta", measurement_note: "Saat 14.00", expected_revision: 0 });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.measurement_status, "scheduled");
    assert.equal(response.body.measurement_date.toISOString(), "2026-10-11T00:00:00.000Z");
    assert.equal(response.body.measurement_master, "Ömer Usta"); assert.equal(response.body.measurement_revision, 1);
    for (const key of ["sale_items", "pos_details", "sub_total", "discount_amount", "credit_card_fee", "grand_total", "status", "approved_at", "deposit_paid", "stock_deductions", "customer_name", "delivery_date"])
        assert.deepEqual(db.sale()[key], original[key], `${key} survives appointment planning`);
    assert.equal(db.stock(), 30); assert.equal(db.stockWrites.length, 0);
    const history = db.sale().measurement_history[0];
    assert.equal(history.kind, "plan"); assert.equal(history.changed_by, userId);
    assert.equal(history.before.measurement_status, "preliminary"); assert.equal(history.after.measurement_status, "scheduled");
    assert.deepEqual(history.before.sale_items, original.sale_items); assert.ok(Number.isFinite(Date.parse(history.changed_at)));
});

test("site measurement reprices quantity using saved material/labor prices, preserves approval and deducts only difference", async (t) => {
    const original = storedSale(), db = database(t, { sales: [original] });
    const response = await db.request(reviseSaleMeasurements, confirm());
    assert.equal(response.statusCode, 200, response.body?.message);
    assert.equal(response.body.status, "tamamlandi"); assert.equal(response.body.approved_at.toISOString(), original.approved_at);
    assert.equal(response.body.measurement_status, "confirmed"); assert.equal(response.body.measurement_revision, 1);
    assert.equal(response.body.sale_items[0].quantity, 15.4); assert.equal(response.body.sale_items[0].width, 500); assert.equal(response.body.sale_items[0].height, 265);
    assert.equal(response.body.pos_details.cart[0].base_unit_price, 500); assert.equal(response.body.pos_details.cart[0].labor_unit_price, 90);
    assert.equal(response.body.sub_total, 9086); assert.equal(response.body.discount_amount, 908.6); assert.equal(response.body.credit_card_fee, 100); assert.equal(response.body.grand_total, 8277.4);
    for (const key of ["payment_method", "customer_name", "customer_phone", "customer_address", "sale_note", "delivery_date", "deposit_paid", "client_request_id"])
        assert.deepEqual(db.sale()[key], original[key], `${key} remains untouched`);
    assert.equal(db.stock(), 27); assert.deepEqual(db.stockWrites[0].update, { $inc: { stock_quantity: -3 } });
    assert.deepEqual(db.sale().stock_deductions, [{ product: productId, quantity: 15.4 }]);
    const history = db.sale().measurement_history[0];
    assert.equal(history.request_id, "measurement-request-001"); assert.equal(history.before.sale_items[0].quantity, 12.4); assert.equal(history.after.sale_items[0].quantity, 15.4);
    assert.equal(history.before.grand_total, 6684.4); assert.equal(history.after.grand_total, 8277.4);
    assert.deepEqual(history.before.pos_details.cart, original.pos_details.cart);
});

test("smaller confirmed measurement returns the reduction and cancellation refunds revised ledger once", async (t) => {
    const db = database(t);
    const revised = await db.request(reviseSaleMeasurements, confirm(300));
    assert.equal(revised.statusCode, 200, revised.body?.message); assert.equal(db.stock(), 33);
    assert.equal(db.sale().sale_items[0].quantity, 9.4); assert.equal(db.sale().stock_deductions[0].quantity, 9.4);
    const cancelled = await db.request(cancelSale); assert.equal(cancelled.statusCode, 200); assert.equal(db.stock(), 42.4);
    await db.request(cancelSale); assert.equal(db.stock(), 42.4); assert.equal(db.stockWrites.length, 2);
});

test("a retry returns saved current revision without duplicate history, totals or stock writes", async (t) => {
    const db = database(t);
    const first = await db.request(reviseSaleMeasurements, confirm()); assert.equal(first.statusCode, 200);
    const firstTimestamp = db.sale().measurement_history[0].changed_at;
    await db.request(planSaleMeasurement, { measurement_date: "2026-10-12", expected_revision: 1 });
    const repeat = await db.request(reviseSaleMeasurements, confirm());
    assert.equal(repeat.statusCode, 200); assert.equal(repeat.body.measurement_revision, 2); assert.equal(repeat.body.measurement_status, "scheduled");
    assert.equal(db.sale().measurement_history.length, 2); assert.equal(db.sale().measurement_history[0].changed_at, firstTimestamp);
    assert.equal(db.stockWrites.length, 1); assert.equal(db.stock(), 27); assert.equal(db.saleWrites.length, 2);
});

test("stale expected revision rejects both planning and geometry without overwriting latest work", async (t) => {
    const db = database(t);
    await db.request(planSaleMeasurement, { measurement_date: "2026-10-11", expected_revision: 0 });
    const current = clone(db.sale());
    for (const [controller, body] of [[planSaleMeasurement, { measurement_date: "2026-10-12", expected_revision: 0 }], [reviseSaleMeasurements, confirm()]]) {
        const response = await db.request(controller, body); assert.equal(response.statusCode, 409); assert.match(response.body.message, /başka bir ekranda/);
        assert.deepEqual(db.sale(), current);
    }
    assert.equal(db.stockWrites.length, 0);
});

test("insufficient extra stock rolls back all product deltas and geometry history", async (t) => {
    const lines = [line(), line("curtain-2", secondProductId)];
    const original = storedSale({ stock_deductions: [{ product: productId, quantity: 12.4 }, { product: secondProductId, quantity: 12.4 }] }, lines);
    const db = database(t, { sales: [original], products: [storedProduct(), storedProduct(secondProductId, 1)] });
    const body = confirm(); body.measurements.push({ line_id: "curtain-2", width: 500, height: 265 });
    const response = await db.request(reviseSaleMeasurements, body);
    assert.equal(response.statusCode, 409); assert.match(response.body.message, /ek stok yetersiz/);
    assert.equal(db.stock(), 30); assert.equal(db.stock(secondProductId), 1); assert.deepEqual(db.sale(), original);
    assert.equal(db.stockWrites.length, 2); assert.equal(db.saleWrites.length, 0);
});

test("two room lines of one product update a single aggregate deduction by changed-line quantity only", async (t) => {
    const lines = [line(), line("curtain-2")];
    const db = database(t, { sales: [storedSale({ stock_deductions: [{ product: productId, quantity: 24.8 }] }, lines)] });
    const body = confirm(); body.measurements.push({ line_id: "curtain-2", width: 400, height: 260 });
    const response = await db.request(reviseSaleMeasurements, body);
    assert.equal(response.statusCode, 200, response.body?.message); assert.equal(db.stock(), 27); assert.equal(db.stockWrites.length, 1);
    assert.equal(db.sale().stock_deductions[0].quantity, 27.8); assert.equal(db.sale().sale_items[1].quantity, 12.4);
});

test("known untracked approval ledger stays empty even if tracking later becomes enabled", async (t) => {
    const db = database(t, { sales: [storedSale({ stock_deductions: [] })] });
    const response = await db.request(reviseSaleMeasurements, confirm()); assert.equal(response.statusCode, 200, response.body?.message);
    assert.equal(db.stock(), 30); assert.equal(db.stockWrites.length, 0); assert.deepEqual(db.sale().stock_deductions, []);
});

test("legacy unknown deduction rejects quantity change but permits boy-only manufacturing correction", async (t) => {
    const original = storedSale({ stock_deductions: null }), db = database(t, { sales: [original] });
    const quantityChange = await db.request(reviseSaleMeasurements, confirm()); assert.equal(quantityChange.statusCode, 409); assert.match(quantityChange.body.message, /stok düşüm kaydı bilinmiyor/);
    assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0);
    const heightOnly = await db.request(reviseSaleMeasurements, confirm(400)); assert.equal(heightOnly.statusCode, 200, heightOnly.body?.message);
    assert.equal(db.sale().sale_items[0].height, 265); assert.equal(db.sale().sale_items[0].quantity, 12.4); assert.equal(db.stockWrites.length, 0);
});

test("ambiguous historical partial deduction rejects quantity change rather than guessing a stock delta", async (t) => {
    const original = storedSale({ stock_deductions: [{ product: productId, quantity: 5 }] }), db = database(t, { sales: [original] });
    const response = await db.request(reviseSaleMeasurements, confirm()); assert.equal(response.statusCode, 409); assert.match(response.body.message, /stok düşüm miktarı/);
    assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0);
});

test("pending offer measurement changes amount with no stock movement and remains pending", async (t) => {
    const db = database(t, { sales: [storedSale({ status: "beklemede", approved_at: null, stock_deductions: null })] });
    const response = await db.request(reviseSaleMeasurements, confirm()); assert.equal(response.statusCode, 200, response.body?.message);
    assert.equal(response.body.status, "beklemede"); assert.equal(response.body.approved_at, null); assert.equal(response.body.grand_total, 8277.4);
    assert.equal(db.stock(), 30); assert.equal(db.stockWrites.length, 0);
});

for (const status of ["teslim_edildi", "iptal", "kaybedildi"]) {
    test(`${status} order blocks appointment and measurement changes`, async (t) => {
        const original = storedSale({ status }), db = database(t, { sales: [original] });
        for (const [controller, body] of [[planSaleMeasurement, { measurement_date: "2026-10-11", expected_revision: 0 }], [reviseSaleMeasurements, confirm()]]) {
            const response = await db.request(controller, body); assert.equal(response.statusCode, 409); assert.match(response.body.message, /değiştirilemez/);
        }
        assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0); assert.equal(db.saleWrites.length, 0);
    });
}

test("metadata and request validation reject invalid date, stale shape, spoofed price and absent IDs", async (t) => {
    const original = storedSale(), db = database(t, { sales: [original] });
    const invalidPlans = [
        { expected_revision: 0, measurement_date: "2026-02-30" }, { expected_revision: 0, measurement_date: "09.10.2026" },
        { expected_revision: "0", measurement_date: "2026-10-11" }, { expected_revision: 0, measurement_master: "x".repeat(121) },
        { expected_revision: 0, measurement_note: "x".repeat(2001) }, { expected_revision: 0, grand_total: 1 },
    ];
    for (const body of invalidPlans) assert.equal((await db.request(planSaleMeasurement, body)).statusCode, 400);
    for (const body of [{ ...confirm(), client_request_id: "" }, { ...confirm(), sale_items: [] }, { ...confirm(), grand_total: 1 }])
        assert.equal((await db.request(reviseSaleMeasurements, body)).statusCode, 400);
    assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0); assert.equal(db.saleWrites.length, 0);
});

test("initial order supports preliminary or confirmed measurement flags but cannot forge an appointment/history", async (t) => {
    const db = database(t, { sales: [], products: [{ ...storedProduct(), stock_tracking: false }] });
    const original = storedSale({ status: "beklemede" });
    const payload = { ...original, client_request_id: "initial-flag-001", measurement_status: "confirmed", measurement_date: "2020-01-01", measurement_revision: 999, measurement_history: [{ request_id: "spoof" }] };
    const saved = await db.request(createSale, payload); assert.equal(saved.statusCode, 201, saved.body?.message);
    assert.equal(saved.body.measurement_status, "confirmed"); assert.equal(saved.body.measurement_date, null); assert.equal(saved.body.measurement_revision, 0); assert.deepEqual(saved.body.measurement_history.toObject(), []);
    const invalid = await db.request(createSale, { ...payload, client_request_id: "initial-flag-002", measurement_status: "scheduled" }); assert.equal(invalid.statusCode, 400);
});

test("ordinary pending edit retains scheduled flag while dedicated geometry API controls measured confirmation", async (t) => {
    const db = database(t, { sales: [storedSale({ status: "beklemede", approved_at: null, measurement_status: "scheduled", measurement_date: "2026-10-11" })] });
    const response = await db.request(updateSale, { customer_phone: "05550000001" });
    assert.equal(response.statusCode, 200, response.body?.message); assert.equal(response.body.measurement_status, "scheduled");
    assert.equal(response.body.customer_phone, "05550000001"); assert.equal(response.body.measurement_revision, 0); assert.equal(db.stockWrites.length, 0);
});

test("missing measurement order returns 404 and ends session", async (t) => {
    const db = database(t, { sales: [] });
    assert.equal((await db.request(planSaleMeasurement, { expected_revision: 0, measurement_date: "2026-10-11" })).statusCode, 404);
    assert.equal((await db.request(reviseSaleMeasurements, confirm())).statusCode, 404);
    assert.equal(db.stockWrites.length, 0);
});

test("missing tracked product aborts revision and leaves history and stock unchanged", async (t) => {
    const original = storedSale(), db = database(t, { sales: [original], products: [] });
    const response = await db.request(reviseSaleMeasurements, confirm());
    assert.equal(response.statusCode, 409); assert.match(response.body.message, /stok ürünü bulunamıyor/);
    assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0); assert.equal(db.saleWrites.length, 0);
});

test("confirmation replay after cancellation returns cancelled record without reopening or repeated stock mutation", async (t) => {
    const db = database(t);
    await db.request(reviseSaleMeasurements, confirm()); await db.request(cancelSale);
    const current = clone(db.sale()), writes = db.stockWrites.length;
    const repeat = await db.request(reviseSaleMeasurements, confirm());
    assert.equal(repeat.statusCode, 200); assert.equal(repeat.body.status, "iptal");
    assert.deepEqual(db.sale(), current); assert.equal(db.stockWrites.length, writes); assert.equal(db.stock(), 42.4);
});

test("geometry DTO cannot spoof stored unit prices, count, chain choice, or private stock ledger", async (t) => {
    const original = storedSale(), db = database(t, { sales: [original] });
    for (const extra of [{ base_unit_price: 1 }, { count: 9 }, { chain_direction: "Sol" }, { stock_deductions: [] }]) {
        const body = confirm(); Object.assign(body.measurements[0], extra);
        const response = await db.request(reviseSaleMeasurements, body); assert.equal(response.statusCode, 400);
    }
    assert.deepEqual(db.sale(), original); assert.equal(db.stockWrites.length, 0); assert.equal(db.saleWrites.length, 0);
});
