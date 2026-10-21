import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ENV } from './env.js';
import User from '../models/User.js';
import Sale from '../models/Sale.js';
import ProductionStaff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';
import protect from '../middlewares/auth.middleware.js';
import { productionAuth, productionAdminOnly } from '../middlewares/production.middleware.js';
import { isProductionAdmin, STAFF_PRESETS } from './productionAccess.js';
import { applyJobChange, fingerprint, notificationDraft, productionLines, stageChoices, visibleOrder } from './productionWorkflow.js';
import { createProductionOrder, getProductionOrders, updateProductionJob, refreshProductionOrder, createStaff, updateStaff } from '../controllers/production.controller.js';
import { updateUser } from '../controllers/user.controller.js';
import userRoutes from '../routes/user.route.js';
const ids = { admin: '100000000000000000000001', nevzat: '100000000000000000000002', nurten: '100000000000000000000003', hayati: '100000000000000000000004', sale: '200000000000000000000001', order: '300000000000000000000001', first: '400000000000000000000001', second: '400000000000000000000002', product: '500000000000000000000001' };
const clone = x => structuredClone(x);
const admin = { kind: 'admin', _id: ids.admin, name: 'TEST Yönetici', duties: [] };
const nevzat = { kind: 'staff', _id: ids.nevzat, name: 'Nevzat', duties: ['cutting', 'sewing', 'installation'] };
const nurten = { kind: 'staff', _id: ids.nurten, name: 'Nurten', duties: ['sewing'] };
function sale() { return { _id: ids.sale, status: 'tamamlandi', customer_name: 'TEST Müşteri', customer_phone: '05550000000', customer_address: 'Özel adres', delivery_method: 'montaj', measurement_status: 'confirmed', measurement_revision: 0, grand_total: 50000, payments: [{ amount: 10000 }], sale_items: [ids.first, ids.second].map(_id => ({ _id, product: ids.product, width: 200, height: 260, quantity: 6.4, unit_price: 500, total_price: 3200 })), pos_details: { header: { customer_phone: '05550000000', sale_note: 'Finansal özel bilgi' }, cart: [ids.first, ids.second].map(() => ({ product_id: ids.product, product_name: 'TEST Tül', mode: 'textile', category_name: 'Tül', room_name: 'Salon', width: 200, height: 260, quantity: 6.4, pieces: 1, unit_label: 'm', variant: 'V1 · Ekru', item_total: 3200, base_unit_price: 500, labor_total: 800, stock_available: 100, panels: [{ label: 'Perde', width: 200, height: 260, cut_width: 640, secret_price: 500 }], accessories: [{ name: 'Ekstra', color: 'Beyaz', unit_price: 999 }] })) } }; }
function order(s = sale()) { return { _id: ids.order, sale: s._id, revision: 0, source_fingerprint: fingerprint(s), jobs: productionLines(s).map((line, i) => ({ ...line, supply: 'received', stage: 'waiting', cutting: i ? ids.hayati : ids.nevzat, sewing: i ? ids.hayati : ids.nurten, installation: i ? ids.hayati : ids.nevzat, note: '', tracking: '' })), history: [{ at: new Date(), actor_name: 'Yönetici', line_id: ids.second, action: 'Gizli diğer iş', before: {}, after: {} }] }; }
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } });
function query(read) { return { select() { return this; }, populate() { return this; }, session() { return this; }, sort() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } }; }
function database(t, initialSale = sale(), initialOrder = order(initialSale)) {
  const state = { sale: clone(initialSale), order: initialOrder && clone(initialOrder), writes: 0 };
  t.mock.method(mongoose, 'startSession', async () => ({ async withTransaction(work) { const before = clone(state); try { await work(); } catch (e) { Object.assign(state, before); throw e; } }, async endSession() {} }));
  t.mock.method(Sale, 'findById', () => query(() => state.sale));
  t.mock.method(Sale, 'find', () => query(() => [state.sale]));
  t.mock.method(Sale, 'updateOne', async (_filter, _update, options) => { assert.equal(options.timestamps, false, 'production must preserve the financial report date'); state.writes++; return { modifiedCount: 1 }; });
  t.mock.method(ProductionOrder, 'find', () => query(() => state.order ? [state.order] : []));
  t.mock.method(ProductionOrder, 'findOne', () => query(() => state.order));
  t.mock.method(ProductionOrder, 'findById', () => query(() => state.order));
  t.mock.method(ProductionOrder, 'create', async ([data]) => { const actual = new ProductionOrder(data); await actual.validate(); state.order = { ...actual.toObject(), _id: ids.order }; return [{ toObject: () => clone(state.order) }]; });
  t.mock.method(ProductionOrder, 'findOneAndUpdate', (filter, update) => query(() => {
    if (filter.revision !== state.order.revision) return null;
    state.order = { ...state.order, ...clone(update.$set), revision: state.order.revision + 1, history: [...state.order.history, clone(update.$push.history)] };
    return clone(state.order);
  }));
  t.mock.method(ProductionStaff, 'findOne', filter => query(() => ({ _id: filter._id, active: true, duties: ['cutting', 'sewing', 'installation'] })));
  return state;
}
test('admin recognition fails closed; Nevzat supports every duty without POS rights', () => {
  assert.equal(isProductionAdmin({}), false); assert.equal(isProductionAdmin({ user_role: { role_name: 'Satış Temsilcisi' } }), false);
  assert.equal(isProductionAdmin({ user_role: { role_name: 'Test Yöneticisi' } }), true);
  assert.deepEqual(STAFF_PRESETS.find(p => p.name === 'Nevzat').duties, ['cutting', 'sewing', 'installation']);
});
test('worker payload has only assigned lines and allowlisted product details', () => {
  const result = visibleOrder(order(), sale(), nevzat);
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].line_id, ids.first); assert.equal(result.history.length, 0);
  const text = JSON.stringify(result);
  for (const forbidden of ['grand_total', 'unit_price', 'payments', 'stock_available', 'labor_total', 'secret_price', 'customer_phone', 'customer_address', 'Finansal özel']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(result.jobs[0].snapshot.panels[0].cut_width, 640);
  assert.equal(visibleOrder(order(), sale(), { ...nevzat, _id: '900000000000000000000001' }), null);
});
test('each textile stage requires its own assignment; multiple duties alone do not grant access', () => {
  let job = order().jobs[0];
  assert.deepEqual(stageChoices(job, nevzat, sale()), ['cutting']);
  assert.deepEqual(stageChoices(job, nurten, sale()), []);
  job = { ...job, stage: 'cut' };
  assert.deepEqual(stageChoices(job, nevzat, sale()), []);
  assert.deepEqual(stageChoices(job, nurten, sale()), ['sewing']);
  assert.throws(() => applyJobChange(job, { stage: 'sewing' }, nevzat, sale()), /koşulu/);
});
test('Nevzat can complete every assigned step, including sewing, when assigned to it', () => {
  let job = { ...order().jobs[0], sewing: ids.nevzat };
  for (const stage of ['cutting', 'cut', 'sewing', 'sewn', 'ready', 'installation', 'installed']) {
    const patch = applyJobChange(job, { stage }, nevzat, sale()); job = { ...job, ...patch };
  }
  assert.equal(job.stage, 'installed');
});
test('missing materials, unconfirmed measurement and cancelled orders block production', () => {
  const job = order().jobs[0];
  assert.deepEqual(stageChoices({ ...job, supply: 'in_transit' }, admin, sale()), []);
  assert.deepEqual(stageChoices(job, admin, { ...sale(), measurement_status: 'preliminary' }), []);
  assert.throws(() => applyJobChange(job, { stage: 'cutting' }, admin, { ...sale(), status: 'iptal' }), /değiştirilemez/);
  assert.throws(() => applyJobChange({ ...job, stage: 'cutting' }, { supply: 'in_transit' }, admin, sale()), /geri alamaz/);
});
test('workers cannot change assignments, supply, price, or unassigned notes', () => {
  for (const changes of [{ cutting: ids.nevzat }, { supply: 'received' }, { grand_total: 1 }, { tracking: 'Kargo' }]) assert.throws(() => applyJobChange(order().jobs[0], changes, nevzat, sale()), /yetkiniz/);
  assert.throws(() => applyJobChange(order().jobs[1], { note: 'Başkasının işi' }, nevzat, sale()), /atanmamış/);
  assert.throws(() => applyJobChange(order().jobs[0], { note: 'a'.repeat(1001) }, nevzat, sale()), /uzun/);
});
test('mechanical products skip cutting and sewing; collection does not start installation', () => {
  const job = { ...order().jobs[0], snapshot: { kind: 'mechanical' } };
  assert.deepEqual(stageChoices(job, admin, sale()), ['ready']);
  assert.throws(() => applyJobChange(job, { stage: 'cutting' }, admin, sale()), /koşulu/);
  assert.throws(() => applyJobChange(job, { sewing: ids.nurten }, admin, sale()), /atanamaz/);
  assert.deepEqual(stageChoices({ ...job, stage: 'ready' }, nevzat, { ...sale(), delivery_method: 'store' }), []);
});
test('changed measurements invalidate the source but changed prices do not', () => {
  const original = sale(); const before = fingerprint(original);
  original.grand_total = 1; original.sale_items[0].unit_price = 1; original.pos_details.cart[0].base_unit_price = 1;
  assert.equal(fingerprint(original), before);
  original.pos_details.cart[0].width = 201;
  assert.notEqual(fingerprint(original), before);
});
test('message drafts never claim all products ready when only one is complete', () => {
  const record = order(); record.jobs[0].stage = 'ready';
  assert.match(notificationDraft(sale(), record), /devam ediyor/);
  record.jobs[1].stage = 'ready'; assert.match(notificationDraft(sale(), record), /siparişiniz hazırlandı/);
});
test('job update records actor and before/after without changing sale prices or status', async t => {
  const state = database(t); const res = response();
  await updateProductionJob({ params: { id: ids.order, lineId: ids.first }, body: { expected_revision: 0, changes: { stage: 'cutting' } }, productionActor: nevzat }, res);
  assert.equal(res.statusCode, 200); assert.equal(state.order.revision, 1); assert.equal(state.order.jobs[0].stage, 'cutting');
  assert.equal(state.order.history.at(-1).actor_name, 'Nevzat'); assert.equal(state.order.history.at(-1).before.stage, 'waiting');
  assert.equal(state.sale.grand_total, 50000); assert.equal(state.sale.status, 'tamamlandi'); assert.equal(res.body.jobs.length, 1);
});
test('stale revision returns conflict; no partial write survives rollback', async t => {
  const state = database(t); state.order.revision = 1; const res = response();
  await updateProductionJob({ params: { id: ids.order, lineId: ids.first }, body: { expected_revision: 0, changes: { stage: 'cutting' } }, productionActor: nevzat }, res);
  assert.equal(res.statusCode, 409); assert.equal(state.order.jobs[0].stage, 'waiting'); assert.equal(state.writes, 0);
});
test('measurement revision blocks old work; admin refresh resets only changed lines and keeps history', async t => {
  const s = sale(); const record = order(s); record.jobs[0].stage = 'sewing'; record.jobs[1].stage = 'cut';
  s.pos_details.cart[0].width = 220; s.measurement_revision = 1;
  const state = database(t, s, record); let res = response();
  await updateProductionJob({ params: { id: ids.order, lineId: ids.first }, body: { expected_revision: 0, changes: { note: 'Eski ölçü' } }, productionActor: nevzat }, res);
  assert.equal(res.statusCode, 409);
  res = response(); await refreshProductionOrder({ params: { id: ids.order }, body: { expected_revision: 0 }, productionActor: admin }, res);
  assert.equal(res.statusCode, 200); assert.equal(state.order.jobs[0].stage, 'waiting'); assert.equal(state.order.jobs[1].stage, 'cut');
  assert.equal(state.order.jobs[0].snapshot.width, 220); assert.equal(state.order.jobs[0].cutting, ids.nevzat); assert.equal(res.body.needs_refresh, false);
});
test('unassigned worker cannot update a hidden line or retrieve its history', async t => {
  const state = database(t); const res = response();
  await updateProductionJob({ params: { id: ids.order, lineId: ids.second }, body: { expected_revision: 0, changes: { note: 'Yasak' } }, productionActor: nevzat }, res);
  assert.equal(res.statusCode, 403); assert.equal(state.order.revision, 0);
  const read = response(); await getProductionOrders({ productionActor: nevzat }, read);
  assert.equal(read.body[0].jobs.length, 1); assert.equal(read.body[0].history.length, 0);
});
test('import is idempotent and uses real schema without resetting existing jobs', async t => {
  const state = database(t, sale(), null); let res = response();
  await createProductionOrder({ body: { sale_id: ids.sale }, productionActor: admin }, res);
  assert.equal(res.statusCode, 201); assert.equal(state.order.jobs.length, 2); assert.equal(state.order.jobs[0].supply, 'awaiting_order');
  state.order.jobs[0].stage = 'cutting'; res = response();
  await createProductionOrder({ body: { sale_id: ids.sale }, productionActor: admin }, res);
  assert.equal(state.order.jobs[0].stage, 'cutting'); assert.equal(state.order.history.length, 1);
});
test('inactive or wrong-duty assignment is rejected', async t => {
  const state = database(t); t.mock.method(ProductionStaff, 'findOne', () => query(() => null)); const res = response();
  await updateProductionJob({ params: { id: ids.order, lineId: ids.first }, body: { expected_revision: 0, changes: { sewing: ids.nevzat } }, productionActor: admin }, res);
  assert.equal(res.statusCode, 409); assert.equal(state.order.jobs[0].sewing, ids.nurten);
});
test('production JWT cannot access any existing POS protected endpoint', async () => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'test-only-production-signing-key';
  try {
    const token = jwt.sign({ id: ids.nevzat, scope: 'production' }, ENV.JWT_SECRET, { audience: 'sahinsoy-production' });
    const res = response(); let next = false;
    await protect({ headers: { authorization: `Bearer ${token}` } }, res, () => { next = true; });
    assert.equal(res.statusCode, 403); assert.equal(next, false);
  } finally { ENV.JWT_SECRET = old; }
});
test('revocation and role updates invalidate already issued worker tokens', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'test-only-production-signing-key';
  try {
    const token = jwt.sign({ id: ids.nevzat, scope: 'production', version: 0 }, ENV.JWT_SECRET, { audience: 'sahinsoy-production' });
    for (const staff of [{ active: false, session_version: 0 }, { active: true, session_version: 1 }]) {
      t.mock.method(ProductionStaff, 'findById', () => query(() => ({ ...nevzat, ...staff })));
      const res = response(); let next = false;
      await productionAuth({ headers: { authorization: `Bearer ${token}` } }, res, () => { next = true; });
      assert.equal(res.statusCode, 401); assert.equal(next, false);
    }
  } finally { ENV.JWT_SECRET = old; }
});
test('active worker token is accepted only for production; staff management is admin only', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'test-only-production-signing-key';
  try {
    t.mock.method(ProductionStaff, 'findById', () => query(() => ({ ...nevzat, active: true, session_version: 0 })));
    const token = jwt.sign({ id: ids.nevzat, scope: 'production', version: 0 }, ENV.JWT_SECRET, { audience: 'sahinsoy-production' });
    const req = { headers: { authorization: `Bearer ${token}` } }; let next = false;
    await productionAuth(req, response(), () => { next = true; }); assert.equal(next, true);
    const res = response(); productionAdminOnly(req, res, () => assert.fail('staff must not become admin')); assert.equal(res.statusCode, 403);
  } finally { ENV.JWT_SECRET = old; }
});
test('missing legacy POS user cannot pass authentication', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'test-only-production-signing-key';
  try {
    t.mock.method(User, 'findById', () => query(() => null));
    const res = response(); const token = jwt.sign({ id: ids.admin }, ENV.JWT_SECRET);
    await protect({ headers: { authorization: `Bearer ${token}` } }, res, () => assert.fail('deleted user')); assert.equal(res.statusCode, 401);
  } finally { ENV.JWT_SECRET = old; }
});
test('legacy profile update cannot self-promote or edit a different user', async () => {
  let res = response(); await updateUser({ user: { _id: ids.nevzat, user_role: { role_name: 'Satış Temsilcisi' } }, params: { id: ids.nevzat }, body: { user_role: ids.admin } }, res); assert.equal(res.statusCode, 400);
  res = response(); await updateUser({ user: { _id: ids.nevzat }, params: { id: ids.admin }, body: { user_username: 'Saldırı' } }, res); assert.equal(res.statusCode, 403);
});
test('staff creation rejects weak passwords and unexpected privilege fields before database writes', async t => {
  t.mock.method(ProductionStaff, 'create', () => assert.fail('must not persist'));
  for (const body of [{ name: 'Nevzat', username: 'nevzat', password: '123', duties: ['cutting'] }, { name: 'Nevzat', username: 'nevzat', password: 'LongTestPassword', duties: ['admin'] }, { name: 'Nevzat', username: 'nevzat', password: 'LongTestPassword', duties: ['cutting'], user_role: ids.admin }]) {
    const res = response(); await createStaff({ productionActor: admin, body }, res); assert.equal(res.statusCode, 400);
  }
});
test('staff edits revoke old sessions and store only an audit description, never a password', async t => {
  let update;
  t.mock.method(ProductionStaff, 'findOneAndUpdate', async (_filter, change) => { update = change; return { _id: ids.nurten, name: 'Nurten', duties: ['sewing'], active: false, session_version: 1 }; });
  const res = response(); await updateStaff({ productionActor: admin, params: { id: ids.nurten }, body: { active: false, expected_version: 0 } }, res);
  assert.equal(res.statusCode, 200); assert.equal(update.$inc.session_version, 1); assert.equal(update.$set.active, false); assert.equal(JSON.stringify(res.body).includes('password'), false);
});
test('public signup cannot bypass staff isolation by creating a POS account', async () => {
  const res = response();
  await new Promise((resolve, reject) => {
    const send = res.json.bind(res); res.json = value => { send(value); resolve(); return res; };
    userRoutes.handle({ method: 'POST', url: '/', headers: {}, body: { user_username: 'unapproved-account' } }, res, reject);
  });
  assert.equal(res.statusCode, 401);
});
