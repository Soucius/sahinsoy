import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionPreparation, preparationPreview, preparationReceipt } from './productionPreparation.js';
import { fingerprint, visibleOrder, stageChoices } from './productionWorkflow.js';
import productionRoutes from '../routes/production.route.js';
import { productionAdminOnly } from '../middlewares/production.middleware.js';

const ids = { sale: '100000000000000000000001', product: '200000000000000000000001', cutter: '300000000000000000000001', tailor: '300000000000000000000002', installer: '300000000000000000000003', other: '300000000000000000000004' };
const staff = [
  { _id: ids.cutter, active: true, duties: ['cutting', 'installation'] },
  { _id: ids.tailor, active: true, duties: ['sewing'] },
  { _id: ids.installer, active: true, duties: ['installation'] },
  { _id: ids.other, active: true, duties: ['sewing'] },
];
function sale() {
  return { _id: ids.sale, status: 'tamamlandi', measurement_status: 'confirmed', measurement_revision: 2, delivery_method: 'store',
    grand_total: 28000, payments: [{ amount: 5000, method: 'Nakit' }],
    sale_items: [1, 2].map(n => ({ _id: `40000000000000000000000${n}`, product: ids.product })),
    pos_details: { cart: [1, 2].map(n => ({ product_id: ids.product, product_name: `Perde ${n}`, mode: 'textile', width: 200, height: 260, quantity: 6.4, unit_label: 'm', variant: 'VR1', base_unit_price: 1200 })) } };
}
function input(s, record = null, patch = {}) {
  return { request_id: '12345678-1234-4567-8901-123456789abc', expected_fingerprint: fingerprint(s), expected_revision: record?.revision ?? null,
    cutting: ids.cutter, sewing: ids.tailor, installation: null,
    materials: preparationPreview(s, record).jobs.map(j => ({ line_id: j.line_id, supply: 'received' })), confirm_changed_work: false, ...patch };
}
function recordFor(s) {
  const req = input(s), plan = buildProductionPreparation(s, null, req, staff);
  return { _id: '500000000000000000000001', sale: s._id, revision: 0, source_fingerprint: plan.source_fingerprint,
    jobs: plan.jobs, sewing_default: plan.sewing_default, history: [{ after: { preparation_request: plan.receipt } }] };
}

test('single preparation assigns all textile rows but leaves work waiting and financial values unchanged', () => {
  const s = sale(), before = structuredClone(s), people = structuredClone(staff);
  const result = buildProductionPreparation(s, null, input(s), staff);
  assert.equal(result.sewing_default, ids.tailor);
  assert.ok(result.jobs.every(j => j.cutting === ids.cutter && j.sewing === ids.tailor && j.stage === 'waiting' && j.supply === 'received'));
  assert.deepEqual(s, before); assert.deepEqual(staff, people);
  assert.equal(JSON.stringify(result).includes('grand_total'), false);
});

test('pending materials are queued without allowing a worker to begin cutting', () => {
  const s = sale(), req = input(s); req.materials[0].supply = 'in_transit';
  const result = buildProductionPreparation(s, null, req, staff);
  assert.equal(result.jobs[0].supply, 'in_transit');
  assert.deepEqual(stageChoices(result.jobs[0], { _id: ids.cutter, kind: 'staff', duties: ['cutting'] }, s), []);
  assert.deepEqual(stageChoices(result.jobs[1], { _id: ids.cutter, kind: 'staff', duties: ['cutting'] }, s), ['cutting']);
});

test('mechanical products never receive cutting or sewing assignments, and installation is independent', () => {
  const s = sale(); s.pos_details.cart.forEach(j => { j.mode = 'mechanical'; }); s.delivery_method = 'installation';
  const result = buildProductionPreparation(s, null, input(s, null, { cutting: null, sewing: null, installation: ids.installer }), staff);
  assert.ok(result.jobs.every(j => j.cutting === null && j.sewing === null && j.installation === ids.installer && j.stage === 'waiting'));
  assert.throws(() => buildProductionPreparation(s, null, input(s, null, { cutting: null, sewing: null }), staff), /Montaj sorumlusunu/);
});

test('no confirmed measurements or unapproved/closed order can be prepared', () => {
  for (const status of ['preliminary', 'scheduled']) {
    const s = sale(); s.measurement_status = status;
    assert.throws(() => buildProductionPreparation(s, null, input(s), staff), /son ölçüleri/);
  }
  for (const status of ['beklemede', 'teslim_edildi', 'iptal', 'kaybedildi']) {
    const s = sale(); s.status = status;
    assert.throws(() => buildProductionPreparation(s, null, input(s), staff), /siparişi onaylayın/);
  }
});

test('stale source fingerprints and concurrent production revisions reject the entire plan', () => {
  const s = sale(), record = recordFor(s), before = structuredClone(record);
  assert.throws(() => buildProductionPreparation(s, record, input(s, record, { expected_revision: null, request_id: '12345678-1234-4567-8901-123456789abd' }), staff), /bilgileri değişti/);
  const old = input(s, record, { request_id: '12345678-1234-4567-8901-123456789abd' }); s.pos_details.cart[0].width = 201;
  assert.throws(() => buildProductionPreparation(s, record, old, staff), /bilgileri değişti/);
  assert.deepEqual(record, before);
});

test('inactive, wrong-duty and missing workers cannot receive a new assignment', () => {
  const s = sale();
  for (const changes of [{ sewing: ids.installer }, { cutting: ids.tailor }, { sewing: null }, { cutting: null }]) assert.throws(() => buildProductionPreparation(s, null, input(s, null, changes), staff));
  const inactive = staff.map(p => ({ ...p, active: false }));
  assert.throws(() => buildProductionPreparation(s, null, input(s), inactive), /giriş izni/);
});

test('missing, duplicate, unknown and prototype material names fail without mutating an existing record', () => {
  const s = sale(), record = recordFor(s), before = structuredClone(record);
  for (const mutate of [req => req.materials.pop(), req => { req.materials[1] = req.materials[0]; }, req => { req.materials[1].line_id = 'unknown'; }, req => { req.materials[1].supply = '__proto__'; }, req => { req.stage = 'ready'; }]) {
    const req = input(s, record, { request_id: '12345678-1234-4567-8901-123456789abd' }); mutate(req);
    assert.throws(() => buildProductionPreparation(s, record, req, staff));
    assert.deepEqual(record, before);
  }
});

test('a retry with the same receipt is idempotent; changing its payload is rejected', () => {
  const s = sale(), req = input(s), record = recordFor(s), before = structuredClone(record);
  assert.deepEqual(buildProductionPreparation(s, record, req, staff), { existing: true });
  assert.equal(preparationReceipt(record, req.request_id).id, req.request_id);
  assert.throws(() => buildProductionPreparation(s, record, { ...req, sewing: ids.other }, staff), /farklı bilgilerle/);
  assert.deepEqual(record, before);
});

test('measurement changes on started work require explicit review and reset only changed rows', () => {
  const s = sale(), record = recordFor(s); record.jobs[0].stage = 'sewing'; record.jobs[1].stage = 'ready';
  s.pos_details.cart[0].width = 220; s.measurement_revision++;
  const preview = preparationPreview(s, record);
  assert.deepEqual(preview.changed_started.map(j => j.line_id), [record.jobs[0].line_id]);
  const req = input(s, record, { request_id: '12345678-1234-4567-8901-123456789abd' });
  assert.throws(() => buildProductionPreparation(s, record, req, staff), /Başlamış ürünlerin/);
  const result = buildProductionPreparation(s, record, { ...req, confirm_changed_work: true }, staff);
  assert.equal(result.jobs[0].stage, 'waiting'); assert.equal(result.jobs[1].stage, 'ready');
  assert.equal(record.jobs[0].stage, 'sewing');
});

test('existing product-specific workers and completed assignments survive preparation', () => {
  const s = sale(), record = recordFor(s); record.jobs[0].sewing = ids.other; record.jobs[0].sewing_override = true; record.jobs[1].stage = 'ready';
  s.measurement_revision++;
  const req = input(s, record, { request_id: '12345678-1234-4567-8901-123456789abd' });
  const result = buildProductionPreparation(s, record, req, staff);
  assert.equal(result.jobs[0].sewing, ids.other); assert.equal(result.jobs[0].sewing_override, true);
  assert.equal(result.jobs[1].stage, 'ready');
  req.materials[1].supply = 'ordered';
  assert.throws(() => buildProductionPreparation(s, record, req, staff), /malzemesi beklemeye/);
});

test('the existing staff boundary still exposes only assigned jobs and excludes prices', () => {
  const s = sale(), record = recordFor(s); record.jobs[1].sewing = ids.other;
  const result = visibleOrder(record, s, { _id: ids.tailor, kind: 'staff', duties: ['sewing'] });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].line_id, record.jobs[0].line_id);
  assert.equal(JSON.stringify(result).includes('grand_total'), false); assert.equal(result.sewing_default, undefined);
});

test('both preparation endpoints remain behind the existing admin boundary', () => {
  for (const method of ['get', 'post']) {
    const route = productionRoutes.stack.find(layer => layer.route?.path === '/preparation/:saleId' && layer.route.methods[method]);
    assert.ok(route); assert.equal(route.route.stack[0].handle, productionAdminOnly);
  }
});

// Exercise the actual controller and transaction boundary as well as the pure plan.
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import ProductionOrder from '../models/ProductionOrder.js';
import ProductionStaff from '../models/ProductionStaff.js';
import { getProductionPreparation, saveProductionPreparation } from '../controllers/production.controller.js';
const admin = { kind: 'admin', _id: '600000000000000000000001', name: 'TEST Yönetici' };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; } });
function query(read) { return { select() { return this; }, populate() { return this; }, session() { return this; }, sort() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } }; }
function database(t) {
  const state = { sale: sale(), record: null, creates: 0, updates: 0, fail: false };
  t.mock.method(mongoose, 'startSession', async () => ({ async withTransaction(work) { const before = structuredClone(state); try { await work(); } catch (error) { Object.assign(state, before); throw error; } }, async endSession() {} }));
  t.mock.method(Sale, 'findById', () => query(() => state.sale));
  t.mock.method(Sale, 'updateOne', async (_filter, change, options) => { assert.equal(options.timestamps, false); assert.deepEqual(Object.keys(change), ['$inc']); state.sale.production_guard = (state.sale.production_guard || 0) + 1; });
  t.mock.method(ProductionOrder, 'findOne', () => query(() => state.record && structuredClone(state.record)));
  t.mock.method(ProductionStaff, 'find', () => query(() => staff));
  t.mock.method(ProductionOrder, 'create', async ([data]) => {
    if (state.fail) throw Error('Simulated write failure');
    const model = new ProductionOrder(data); model._id = '500000000000000000000001';
    const error = model.validateSync(); if (error) throw error;
    state.record = model.toObject(); state.creates++;
    return [model];
  });
  t.mock.method(ProductionOrder, 'findOneAndUpdate', (filter, change) => query(() => {
    if (state.fail) throw Error('Simulated update failure');
    if (state.record.revision !== filter.revision) return null;
    state.record = { ...state.record, ...structuredClone(change.$set), revision: state.record.revision + 1, history: [...state.record.history, structuredClone(change.$push.history)] };
    state.updates++; return structuredClone(state.record);
  }));
  return state;
}
const req = (s, payload = input(s)) => ({ params: { saleId: s._id }, body: payload, productionActor: admin });

test('controller creates a schema-valid assigned production order in one commit and reconciles a lost response', async t => {
  const state = database(t), original = structuredClone(state.sale), request = req(state.sale), res = response();
  await saveProductionPreparation(request, res);
  assert.equal(res.statusCode, 200); assert.equal(state.creates, 1); assert.equal(state.updates, 0);
  assert.equal(res.body.sale_id, original._id); assert.equal(res.body.needs_refresh, false);
  assert.ok(res.body.jobs.every(j => String(j.cutting) === ids.cutter && String(j.sewing) === ids.tailor && j.stage === 'waiting'));
  assert.equal(res.body.history.length, 1); assert.ok(res.body.history[0].after.preparation_request.id);
  assert.equal(state.sale.grand_total, original.grand_total); assert.deepEqual(state.sale.payments, original.payments);
  const retry = response(); await saveProductionPreparation(request, retry);
  assert.equal(retry.statusCode, 200); assert.equal(state.creates, 1); assert.equal(state.updates, 0); assert.equal(retry.body.history.length, 1);
  const preview = response(); await getProductionPreparation(request, preview);
  assert.equal(preview.statusCode, 200); assert.equal(preview.body.order.history[0].after.preparation_request.id, request.body.request_id);
});

test('controller failure and missing assignments roll back the sale lock and leave no partial order', async t => {
  const state = database(t), before = structuredClone(state.sale);
  const missing = response(); await saveProductionPreparation(req(state.sale, input(state.sale, null, { sewing: null })), missing);
  assert.equal(missing.statusCode, 400); assert.deepEqual(state.sale, before); assert.equal(state.record, null); assert.equal(state.creates, 0);
  state.fail = true;
  const failure = response(); await saveProductionPreparation(req(state.sale), failure);
  assert.equal(failure.statusCode, 500); assert.deepEqual(state.sale, before); assert.equal(state.record, null); assert.equal(state.creates, 0);
});

test('preparation controllers reject a worker before any database access', async t => {
  t.mock.method(Sale, 'findById', () => { throw Error('Must not read a sale'); });
  t.mock.method(mongoose, 'startSession', () => { throw Error('Must not start a transaction'); });
  for (const handler of [getProductionPreparation, saveProductionPreparation]) {
    const res = response(); await handler({ ...req(sale()), productionActor: { kind: 'staff', _id: ids.cutter, duties: ['cutting'] } }, res);
    assert.equal(res.statusCode, 403);
  }
});

test('a concurrent production update rejects stale preparation and rolls back the sale lock', async t => {
  const state = database(t);
  const first = response(); await saveProductionPreparation(req(state.sale), first);
  assert.equal(first.statusCode, 200);
  const payload = input(state.sale, state.record, { request_id: '12345678-1234-4567-8901-123456789abd' });
  state.record.revision++;
  const before = structuredClone(state), stale = response();
  await saveProductionPreparation(req(state.sale, payload), stale);
  assert.equal(stale.statusCode, 409); assert.deepEqual(state, before);
});

test('preparation does not silently replace a deliberately cleared product-specific tailor', () => {
  const s = sale(), record = recordFor(s); record.jobs[0].sewing_override = true; record.jobs[0].sewing = null;
  const before = structuredClone(record);
  assert.throws(() => buildProductionPreparation(s, record, input(s, record, { request_id: '12345678-1234-4567-8901-123456789abd' }), staff), /Ürüne özel/);
  assert.deepEqual(record, before);
});

test('editing existing preparation updates materials atomically without a second import or financial entry', async t => {
  const state = database(t), first = response();
  const pending = input(state.sale); pending.materials.forEach(j => { j.supply = 'in_transit'; });
  await saveProductionPreparation(req(state.sale, pending), first); assert.equal(first.statusCode, 200);
  const beforeMoney = structuredClone({ total: state.sale.grand_total, payments: state.sale.payments });
  const patch = input(state.sale, state.record, { request_id: '12345678-1234-4567-8901-123456789abd' });
  const saved = response(); await saveProductionPreparation(req(state.sale, patch), saved);
  assert.equal(saved.statusCode, 200); assert.equal(state.creates, 1); assert.equal(state.updates, 1); assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.history.length, 2); assert.ok(saved.body.jobs.every(j => j.supply === 'received' && j.stage === 'waiting'));
  assert.deepEqual({ total: state.sale.grand_total, payments: state.sale.payments }, beforeMoney);
  const replay = response(); await saveProductionPreparation(req(state.sale, patch), replay);
  assert.equal(replay.statusCode, 200); assert.equal(state.updates, 1); assert.equal(replay.body.history.length, 2);
});
