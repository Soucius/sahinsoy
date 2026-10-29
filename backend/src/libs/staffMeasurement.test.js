import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { VisitPlan } from './visitPlanning.js';
import { staffMeasurementView, staffMeasurementInput, requireAssignedMeasurement, getStaffMeasurement, saveStaffMeasurement } from './staffMeasurement.js';
const ids = { sale: '100000000000000000000001', user: '200000000000000000000001', staff: '300000000000000000000001', other: '300000000000000000000002', product: '400000000000000000000001', plan: '500000000000000000000001' };
const actor = { _id: ids.staff, kind: 'staff', name: 'SYNTHETIC_NEVZAT', duties: ['installation'] }, clone = value => JSON.parse(JSON.stringify(value));
function storedSale() {
  const line = { id: 'curtain-1', product_id: ids.product, product_name: 'TEST_TUL', brand_name: 'TEST', category_name: 'Tül', mode: 'textile', calc_type: 'mt', width: 400, height: 260, pieces: 1, count: 1, order_mode: 'adet', panels: [{ label: 'Perde', width: 400, height: 260, cut_width: 1240 }], quantity: 12.4, unit_label: 'm', pleat_name: 'Sık pile', pleat_factor: 3, base_unit_price: 500, material_total: 6200, labor_unit_price: 90, labor_total: 1116, accessories: [], accessories_total: 0, unit_price: 590, item_total: 7316, original_currency: 'TRY', original_unit_price: 500, currency_rate: 1, calculation_note: 'PRIVATE_PRICE', room_name: 'Salon', variant: 'V1 · Ekru', item_note: 'PUBLIC_WORK_NOTE', stock_tracked: true, stock_available: 50 };
  return clone(new Sale({ _id: ids.sale, sold_by: ids.user, approved_at: '2026-10-01T10:00:00Z', status: 'tamamlandi', sale_items: [{ product: ids.product, quantity: 12.4, width: 400, height: 260, unit_price: 590, total_price: 7316, room_name: 'Salon' }], pos_details: { version: 1, cart: [line], header: { first_name: 'TEST', delivery_method: 'montaj', payment_method: 'Nakit', sale_note: 'PRIVATE_FINANCE' } }, sub_total: 7316, discount_percent: 10, discount_amount: 731.6, credit_card_fee: 100, grand_total: 6684.4, payment_method: 'Nakit', customer_name: 'TEST_CUSTOMER', customer_phone: 'PRIVATE_PHONE', customer_address: 'PRIVATE_ADDRESS', sale_note: 'PRIVATE_FINANCE', delivery_method: 'montaj', measurement_status: 'scheduled', measurement_date: '2026-10-29', stock_deductions: [{ product: ids.product, quantity: 12.4 }], payments: [{ request_id: 'old-payment', amount: 3000, method: 'Nakit', kind: 'Kapora', paid_date: '2026-10-28', recorded_at: new Date(), recorded_by: ids.user }] }).toObject());
}
const planFor = s => ({ _id: ids.plan, sale: String(s._id), assigned_to: ids.staff, kind: 'measurement', date: '2026-10-29', revision: 0 });
const payload = s => { const view = staffMeasurementView(s, planFor(s), actor); return { request_id: '11111111-2222-4333-8444-555555555555', expected_revision: view.expected_revision, expected_visit_revision: view.expected_visit_revision, expected_fingerprint: view.expected_fingerprint, measurements: view.lines.map(line => ({ ...line.form, width: '500', height: '265' })), note: 'Yerinde ölçü alındı' }; };
const response = () => ({ code: 200, body: null, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function database(t, { insufficient = false, failSave = false } = {}) {
  const db = { sale: storedSale(), plan: planFor(storedSale()), product: { _id: ids.product, product_name: 'TEST_TUL', stock_tracking: true, stock_quantity: 30, calculation_type: 'mt', category_name: 'Tül' }, writes: 0 };
  const query = read => ({ session() { return this; }, lean: async () => clone(read()), then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } });
  t.mock.method(VisitPlan, 'findOne', filter => query(() => db.plan && db.plan.assigned_to === filter.assigned_to ? db.plan : null));
  t.mock.method(VisitPlan, 'updateOne', async filter => { if (db.plan.revision !== filter.revision || db.plan.assigned_to !== filter.assigned_to) return { modifiedCount: 0 }; db.plan.revision++; return { modifiedCount: 1 }; });
  t.mock.method(Sale, 'findById', () => query(() => Sale.hydrate(clone(db.sale))));
  t.mock.method(Sale, 'updateOne', async (_filter, update, options) => { assert.deepEqual(update, { $inc: { production_guard: 1 } }); assert.equal(options.timestamps, false); db.sale.production_guard++; return { modifiedCount: 1 }; });
  t.mock.method(Product, 'findById', () => query(() => clone(db.product)));
  t.mock.method(Product, 'updateOne', async (_filter, update) => { if (insufficient) return { modifiedCount: 0 }; db.product.stock_quantity += update.$inc.stock_quantity; return { modifiedCount: 1 }; });
  t.mock.method(Sale.prototype, 'save', async function () { await this.validate(); if (failSave) throw new Error('SYNTHETIC_STORAGE_FAILURE'); db.sale = clone(this.toObject()); db.writes++; return this; });
  t.mock.method(mongoose.connection, 'transaction', async callback => { const before = clone(db); try { return await callback({}); } catch (e) { Object.assign(db, before); throw e; } });
  return db;
}
test('staff DTO includes only own visit geometry and no POS, price, stock, contacts or financial notes', () => {
  const s = storedSale(), view = staffMeasurementView(s, planFor(s), actor), text = JSON.stringify(view);
  assert.equal(view.lines[0].form.width, 400);
  for (const forbidden of ['unit_price', 'grand_total', 'labor_total', 'currency_rate', 'stock_', 'payments', 'PRIVATE_', 'sale_items', 'pos_details']) assert.ok(!text.includes(forbidden), forbidden);
});
test('only active own measurement visits can be read/edited, including later corrections', () => {
  const s = storedSale(), plan = planFor(s); s.measurement_status = 'confirmed'; assert.doesNotThrow(() => requireAssignedMeasurement(actor, plan, s));
  for (const a of [{ ...actor, _id: ids.other }, { ...actor, duties: ['sewing'] }, { ...actor, kind: 'admin' }]) assert.throws(() => requireAssignedMeasurement(a, plan, s));
  assert.throws(() => requireAssignedMeasurement(actor, { ...plan, kind: 'installation' }, s));
  s.status = 'teslim_edildi'; assert.throws(() => requireAssignedMeasurement(actor, plan, s));
});
test('input rejects financial fields, actor spoofing, invalid revisions and oversized notes', () => {
  const value = payload(storedSale());
  for (const extra of [{ grand_total: 1 }, { staff_id: ids.other }, { expected_revision: -1 }, { expected_visit_revision: 0.5 }, { note: 'a'.repeat(2001) }, { request_id: 'bad' }]) assert.throws(() => staffMeasurementInput({ ...value, ...extra }));
});
test('new dimensions reprice by saved rates, update stock and PDF cart, preserve deposit and source choices', async t => {
  const db = database(t), before = clone(db.sale), result = response(); await saveStaffMeasurement({ productionActor: actor, params: { saleId: ids.sale }, body: payload(db.sale) }, result);
  assert.equal(result.code, 200); assert.deepEqual(Object.keys(result.body).sort(), ['measurement_revision', 'measurement_status', 'saved']);
  assert.equal(db.sale.sale_items[0].quantity, 15.4); assert.equal(db.sale.pos_details.cart[0].width, 500); assert.equal(db.sale.pos_details.cart[0].height, 265); assert.equal(db.sale.grand_total, 8277.4); assert.equal(db.product.stock_quantity, 27);
  assert.equal(db.sale.pos_details.cart[0].base_unit_price, 500); assert.equal(db.sale.pos_details.cart[0].labor_unit_price, 90); assert.deepEqual(db.sale.payments, before.payments); assert.equal(db.sale.discount_percent, before.discount_percent); assert.equal(db.sale.approved_at, before.approved_at);
  assert.equal(db.sale.measurement_status, 'confirmed'); assert.equal(db.sale.measurement_master, actor.name); assert.equal(db.sale.measurement_source, 'team'); assert.equal(db.plan.revision, 1);
  const audit = db.sale.measurement_history[0]; assert.equal(audit.changed_by, null); assert.equal(audit.changed_by_staff, ids.staff); assert.equal(audit.changed_name, actor.name); assert.equal(audit.before.grand_total, 6684.4); assert.equal(audit.after.grand_total, 8277.4);
});
test('same request cannot double-write or double-deduct; conflicting reuse is rejected', async t => {
  const db = database(t), body = payload(db.sale), req = { productionActor: actor, params: { saleId: ids.sale }, body };
  for (let i = 0; i < 2; i++) { const res = response(); await saveStaffMeasurement(req, res); assert.equal(res.code, 200); }
  assert.equal(db.writes, 1); assert.equal(db.product.stock_quantity, 27);
  const bad = response(); await saveStaffMeasurement({ ...req, body: { ...body, note: 'DIFFERENT' } }, bad); assert.equal(bad.code, 409); assert.equal(db.writes, 1);
});
test('changed assignment, canceled order, stale dimensions and injected line prices cannot be written', async t => {
  const db = database(t), body = payload(db.sale), req = { productionActor: actor, params: { saleId: ids.sale }, body };
  const check = async expected => { const res = response(); await saveStaffMeasurement(req, res); assert.equal(res.code, expected); assert.equal(db.writes, 0); };
  db.plan.assigned_to = ids.other; await check(403); db.plan.assigned_to = ids.staff;
  db.sale.status = 'iptal'; await check(409); db.sale.status = 'tamamlandi';
  db.sale.measurement_revision++; await check(409); db.sale.measurement_revision--;
  req.body = { ...body, measurements: body.measurements.map(row => ({ ...row, unit_price: 1 })) }; await check(409);
});
test('insufficient stock rolls back order and visit, with no financial details in staff error', async t => {
  const db = database(t, { insufficient: true }), before = clone(db), res = response(); await saveStaffMeasurement({ productionActor: actor, params: { saleId: ids.sale }, body: payload(db.sale) }, res); assert.equal(res.code, 409); assert.deepEqual(db, before); assert.ok(!JSON.stringify(res.body).includes('8277'));
});
test('failed sale write rolls back stock and assignment revision', async t => {
  const db = database(t, { failSave: true }), before = clone(db), res = response(); await saveStaffMeasurement({ productionActor: actor, params: { saleId: ids.sale }, body: payload(db.sale) }, res); assert.equal(res.code, 409); assert.deepEqual(db, before);
});
test('expired/reassigned visit cannot be fetched; valid read has no mutations', async t => {
  const db = database(t), before = clone(db), req = { productionActor: actor, params: { saleId: ids.sale }, query: {} }, res = response(); await getStaffMeasurement(req, res); assert.equal(res.code, 200); assert.deepEqual(db, before);
  db.plan.assigned_to = ids.other; const denied = response(); await getStaffMeasurement(req, denied); assert.equal(denied.code, 403);
});
test('staff routes stay behind production auth and never expose general sale endpoints', async () => {
  const route = await readFile(new URL('../routes/production.route.js', import.meta.url), 'utf8'); assert.ok(route.indexOf('router.use(productionAuth)') < route.indexOf("router.get('/visits/:saleId/measurements'"));
  const code = await readFile(new URL('./staffMeasurement.js', import.meta.url), 'utf8'); assert.ok(code.includes("assigned_to: actor._id")); assert.ok(code.includes('applySaleMeasurementRevision'));
});
