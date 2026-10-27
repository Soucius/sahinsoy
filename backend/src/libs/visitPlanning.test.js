import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ENV } from './env.js';
import User from '../models/User.js';
import Sale from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';
import router from '../routes/production.route.js';
import { VisitPlan, visitDay, visitInput, visitCards, visitChange, saveVisitPlan, getVisitPlan } from './visitPlanning.js';

const ids = { admin: '100000000000000000000001', staff: '100000000000000000000002', other: '100000000000000000000003', sale: '200000000000000000000001', otherSale: '200000000000000000000002', visit: '300000000000000000000001' };
const admin = { kind: 'admin', _id: ids.admin, name: 'TEST_ADMIN', duties: [] }, actor = { kind: 'staff', _id: ids.staff, name: 'TEST_STAFF', duties: ['installation'] };
const person = { _id: ids.staff, name: 'TEST_STAFF', active: true, duties: ['installation'] };
const now = new Date('2026-10-27T12:00:00Z');
const sale = changes => ({ _id: ids.sale, status: 'tamamlandi', customer_name: 'TEST_CUSTOMER', customer_phone: 'PRIVATE_PHONE', customer_address: 'PRIVATE_ADDRESS', sale_note: 'PRIVATE_FINANCE_NOTE', grand_total: 28000, payments: [{ amount: 14000 }], stock_deductions: [{ quantity: 5 }], delivery_method: 'montaj', delivery_date: new Date('2026-10-30T00:00:00Z'), measurement_status: 'scheduled', measurement_revision: 3, measurement_date: new Date('2026-10-28T00:00:00Z'), measurement_master: '', measurement_note: '', measurement_history: [], production_guard: 0, updatedAt: new Date('2026-10-23'), pos_details: { header: { delivery_date: '2026-10-30', PRIVATE: 'private' } }, ...changes });
const input = changes => visitInput({ request_id: '11111111-2222-4333-8444-555555555555', kind: 'installation', date: '2026-10-31', assigned_to: ids.staff, note: 'TEST_VISIT_NOTE', expected_revision: -1, expected_date: '2026-10-30', expected_measurement_revision: 3, ...changes });
const saved = (s = sale(), changes = {}) => ({ _id: ids.visit, sale: s._id, kind: 'installation', date: '2026-10-30', assigned_to: ids.staff, note: 'TEST_VISIT_NOTE', revision: 0, history: [], ...changes });
const query = getter => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, session() { return this; }, lean() { return Promise.resolve(getter()); } });
const response = () => ({ statusCode: 200, data: null, set() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } });

test('date-only planning uses Istanbul days and rejects malformed dates, timestamps and financial payloads', () => {
  assert.equal(visitDay('2026-10-27'), '2026-10-27'); assert.equal(visitDay('2026-02-30'), '');
  assert.equal(visitDay(new Date('2026-10-27T21:30:00Z')), '2026-10-28');
  for (const changes of [{ date: '2026-02-30' }, { date: '2026-10-28T00:00:00Z' }, { date: '' }, { assigned_to: 'bad' }, { expected_revision: 0.5 }, { expected_date: 'bad' }, { grand_total: 1 }, { kind: 'bad' }, { kind: 'store' }, { request_id: 'bad' }]) assert.throws(() => input(changes));
});
test('measurement and installation are separate visits, store collection has its own category, closed orders disappear', () => {
  const all = visitCards([sale(), sale({ _id: ids.otherSale, delivery_method: 'store' }), sale({ _id: '200000000000000000000003', status: 'iptal' }), sale({ _id: '200000000000000000000004', status: 'teslim_edildi' })], [], [person], admin);
  assert.equal(all.length, 4); assert.equal(all.filter(card => card.kind === 'measurement').length, 2); assert.equal(all.filter(card => card.kind === 'installation').length, 1); assert.equal(all.filter(card => card.kind === 'store').length, 1);
  assert.equal(all.find(card => card.kind === 'measurement').date, '2026-10-28'); assert.equal(all.find(card => card.kind === 'installation').date, '2026-10-30');
  assert.equal(visitCards([sale({ status: 'beklemede' })], [], [], admin).length, 1);
});
test('staff see only their own assigned measurement/installation visits, with no POS or customer contact/financial data', () => {
  const plans = [saved(), saved(sale(), { kind: 'measurement', assigned_to: ids.other }), saved(sale({ _id: ids.otherSale }), { kind: 'measurement' })];
  const cards = visitCards([sale(), sale({ _id: ids.otherSale, delivery_method: 'store' })], plans, [person], actor);
  assert.equal(cards.length, 2); assert.ok(cards.every(card => card.assigned_to === ids.staff)); assert.ok(cards.every(card => card.kind !== 'store'));
  for (const secret of ['PRIVATE_PHONE', 'PRIVATE_ADDRESS', 'PRIVATE_FINANCE_NOTE', 'grand_total', 'payments', 'stock_deductions', 'pos_details', 'customer_phone', 'customer_address', 'history']) assert.ok(!JSON.stringify(cards).includes(secret), secret);
  assert.equal(visitCards([sale()], [saved(sale(), { assigned_to: ids.other })], [person], actor).length, 0);
});
test('new measurement date returns confirmed work to scheduled without changing dimensions, payments or prices', () => {
  const s = sale({ measurement_status: 'confirmed' }), before = structuredClone(s);
  const change = visitChange(s, null, input({ kind: 'measurement', expected_date: '2026-10-28', date: '2026-10-29' }), admin, person, now);
  assert.equal(change.set.measurement_status, 'scheduled'); assert.equal(change.set.measurement_master, person.name); assert.equal(change.inc.measurement_revision, 1);
  assert.equal(change.push.measurement_history.before.measurement_status, 'confirmed'); assert.equal(change.push.measurement_history.after.measurement_status, 'scheduled');
  for (const forbidden of ['grand_total', 'payments', 'sale_items', 'stock_deductions', 'status', 'updatedAt']) assert.equal(Object.hasOwn(change.set, forbidden), false);
  assert.deepEqual(s, before);
  const assignmentOnly = visitChange(s, null, input({ kind: 'measurement', expected_date: '2026-10-28', date: '2026-10-28' }), admin, person, now);
  assert.deepEqual(assignmentOnly.set, {}); assert.equal(assignmentOnly.inc.measurement_revision, undefined);
});
test('installation/store date updates the canonical order and PDF header together without financial updates', () => {
  for (const kind of ['installation', 'store']) {
    const s = sale({ delivery_method: kind });
    const change = visitChange(s, null, input({ kind, assigned_to: kind === 'store' ? '' : ids.staff }), admin, kind === 'store' ? null : person, now);
    assert.equal(change.set.delivery_date.toISOString(), '2026-10-31T00:00:00.000Z'); assert.equal(change.set['pos_details.header.delivery_date'], '2026-10-31');
    assert.equal(Object.keys(change.set).length, 2); assert.equal(change.inc.production_guard, 1); assert.deepEqual(change.push, {});
  }
});
test('changed revisions/dates, closed orders, wrong delivery method and ineligible assignees are rejected', () => {
  for (const s of [sale({ status: 'iptal' }), sale({ status: 'teslim_edildi' }), sale({ status: 'kaybedildi' }), sale({ status: 'beklemede' }), sale({ delivery_method: 'store' }), sale({ delivery_date: '2026-10-29' })]) assert.throws(() => visitChange(s, null, input(), admin, person));
  for (const p of [{ ...person, active: false }, { ...person, duties: ['sewing'] }, { ...person, _id: ids.other }, null]) assert.throws(() => visitChange(sale(), null, input(), admin, p));
  assert.throws(() => visitChange(sale(), saved(), input(), admin, person), /başka bir ekranda/);
  assert.throws(() => visitChange(sale(), null, input({ kind: 'measurement', expected_date: '2026-10-28', expected_measurement_revision: 2 }), admin, person), /başka bir ekranda/);
});
test('lost-response retries cannot reschedule twice or overwrite a later date', () => {
  const i = input(), change = visitChange(sale(), null, i, admin, person, now), prior = saved(sale(), { date: i.date, history: [change.event] });
  assert.equal(visitChange(sale({ status: 'teslim_edildi' }), prior, i, admin, null).existing, true);
  assert.throws(() => visitChange(sale(), prior, { ...i, date: '2026-11-01' }, admin, person), /Aynı kayıt kimliği/);
});
test('legacy date edits are reflected in the same calendar and completed stages are separated from open work', () => {
  const s = sale({ delivery_date: '2026-11-02', measurement_status: 'confirmed' });
  const cards = visitCards([s], [saved(), saved(s, { kind: 'measurement' })], [person], admin, [{ sale: s._id, jobs: [{ stage: 'installed', supply: 'received' }] }]);
  assert.equal(cards.find(card => card.kind === 'installation').date, '2026-11-02'); assert.equal(cards.find(card => card.kind === 'installation').changed_elsewhere, true);
  assert.ok(cards.every(card => card.completed));
  const incomplete = visitCards([sale()], [saved()], [person], admin, [{ sale: ids.sale, jobs: [{ stage: 'cutting', supply: 'received' }] }]);
  assert.ok(incomplete.find(card => card.kind === 'installation').warnings.some(text => text.includes('tamamlanmamış')));
});
test('visit schema has one measurement and one installation record per order and preserves history', () => {
  assert.ok(VisitPlan.schema.indexes().some(([keys, options]) => keys.sale === 1 && keys.kind === 1 && options.unique));
  const plan = new VisitPlan(saved()); assert.equal(plan.validateSync(), undefined);
  plan.kind = 'cash'; assert.ok(plan.validateSync());
});
function mockDb(t, conflict = false) {
  const db = { sale: sale(), plan: null, writes: 0 };
  t.mock.method(VisitPlan, 'init', async () => {});
  t.mock.method(mongoose.connection, 'transaction', async fn => { const before = structuredClone(db); try { return await fn({}); } catch (e) { Object.assign(db, before); throw e; } });
  t.mock.method(Sale, 'findById', () => query(() => structuredClone(db.sale)));
  t.mock.method(VisitPlan, 'findOne', () => query(() => db.plan));
  t.mock.method(Staff, 'findById', () => query(() => person));
  t.mock.method(Sale, 'updateOne', async (_filter, update, options) => { assert.equal(options.timestamps, false); db.writes++; for (const [key, value] of Object.entries(update.$set || {})) { if (key === 'pos_details.header.delivery_date') db.sale.pos_details.header.delivery_date = value; else db.sale[key] = value; } for (const [key, value] of Object.entries(update.$inc)) db.sale[key] = (db.sale[key] || 0) + value; return { modifiedCount: 1 }; });
  t.mock.method(VisitPlan, 'create', async ([plan]) => { if (conflict) throw Object.assign(Error('duplicate'), { code: 11000 }); db.plan = { _id: ids.visit, ...structuredClone(plan) }; });
  return db;
}
test('controller saves a date atomically with its assignment and replays safely without modifying financial report time', async t => {
  const db = mockDb(t), old = structuredClone(db.sale), req = { params: { saleId: ids.sale }, body: input(), productionActor: admin }, res = response();
  await saveVisitPlan(req, res); assert.equal(res.statusCode, 200); assert.equal(db.writes, 1); assert.equal(db.plan.assigned_to, ids.staff);
  for (const field of ['grand_total', 'payments', 'stock_deductions', 'updatedAt']) assert.deepEqual(db.sale[field], old[field]);
  await saveVisitPlan(req, response()); assert.equal(db.writes, 1); assert.equal(db.plan.history.length, 1);
});
test('failed appointment insert rolls back the changed order date', async t => {
  const db = mockDb(t, true), old = structuredClone(db.sale), res = response();
  await saveVisitPlan({ params: { saleId: ids.sale }, body: input(), productionActor: admin }, res);
  assert.equal(res.statusCode, 409); assert.deepEqual(db.sale, old); assert.equal(db.plan, null); assert.equal(db.writes, 0);
});
test('staff endpoint scopes database reads to their assignments and rejects attempts to broaden the query', async t => {
  let planFilter;
  t.mock.method(VisitPlan, 'find', filter => { planFilter = filter; return query(() => [saved()]); });
  t.mock.method(Sale, 'find', filter => { assert.deepEqual(filter._id.$in, [ids.sale]); return query(() => [sale()]); });
  t.mock.method(Staff, 'find', () => query(() => [person])); t.mock.method(ProductionOrder, 'find', () => query(() => []));
  const res = response(); await getVisitPlan({ query: {}, productionActor: actor }, res); assert.equal(planFilter.assigned_to, ids.staff); assert.equal(res.data.cards.length, 1); assert.equal(res.data.cards[0].customer_phone, undefined);
  const bad = response(); await getVisitPlan({ query: { assigned_to: ids.other }, productionActor: actor }, bad); assert.equal(bad.statusCode, 400);
  const sewing = response(); await getVisitPlan({ query: {}, productionActor: { ...actor, duties: ['sewing'] } }, sewing); assert.deepEqual(sewing.data.cards, []);
});
test('staff cannot write appointments, sales representatives cannot access the calendar, and POS remains isolated', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'synthetic-visit-secret'; t.after(() => { ENV.JWT_SECRET = old; });
  t.mock.method(User, 'findById', () => ({ select: () => ({ populate: async () => ({ _id: ids.admin, user_role: { role_name: 'Satış Temsilcisi' } }) }) }));
  t.mock.method(Staff, 'findById', () => ({ lean: async () => ({ _id: ids.staff, name: person.name, active: true, session_version: 1, duties: ['installation'] }) }));
  const app = express(); app.use('/production', express.json(), router); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/production`;
  assert.equal((await fetch(`${base}/visits`)).status, 401);
  const token = jwt.sign({ id: ids.admin }, ENV.JWT_SECRET); assert.equal((await fetch(`${base}/visits`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  const staffToken = jwt.sign({ id: ids.staff, scope: 'production', aud: 'sahinsoy-production', version: 1 }, ENV.JWT_SECRET);
  assert.equal((await fetch(`${base}/visits/${ids.sale}`, { method: 'POST', headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status, 403);
});
