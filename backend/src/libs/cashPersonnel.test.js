import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';
import Sale from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import User from '../models/User.js';
import { ENV } from './env.js';
import { calculateCurtainLine, defaultMeasurement } from './curtainCalculation.js';
import { cashPersonnelRouter, CashOffice, PayPerson, OfficeEntry, SewingWork, startCashOffice, captureSewingWork, postSewingPrice } from './cashPersonnel.js';
import { personInput, sewingMeter, priceSewing, officeEntry, officeReverse, cashReceipts, officeSummary, officeHash, officeToday } from './cashPersonnelRules.js';
const ids = { admin: '100000000000000000000001', person: '200000000000000000000001', salary: '200000000000000000000002', staff: '300000000000000000000001', sale: '400000000000000000000001', line: '500000000000000000000001', product: '600000000000000000000001', order: '700000000000000000000001' };
const operation = '11111111-2222-4333-8444-555555555555', otherOperation = '11111111-2222-4333-8444-555555555556';
const admin = { _id: ids.admin, name: 'SYNTHETIC_ADMIN', user_username: 'SYNTHETIC_ADMIN', user_role: { role_name: 'Test Yöneticisi' } }, now = new Date('2026-10-28T10:00:00Z');
const config = () => ({ _id: 'store', start_date: '2026-10-28', openings: { cash: '10000000', bank: '20000000', pos: '0' }, excluded_payment_keys: [], revision: 0 });
const salaryPerson = () => ({ _id: ids.salary, name: 'SYNTHETIC_SALARY', kind: 'salary', revision: 0, monthly_minor: '3000000', rates: [] });
const piecePerson = () => ({ _id: ids.person, name: 'SYNTHETIC_PIECE', kind: 'piece', staff_id: ids.staff, rates: [{ key: 'tul:*', minor: '2000' }, { key: 'tul:sik', minor: '2500' }, { key: 'fon:*', minor: '3000' }], revision: 0 });
const lineSale = line => ({ _id: ids.sale, customer_name: 'SYNTHETIC CUSTOMER', status: 'tamamlandi', measurement_revision: 2, sale_items: [{ _id: ids.line, product: ids.product, quantity: line.quantity }], pos_details: { cart: [{ ...line, product_id: ids.product }] } });
const sampleLine = changes => ({ mode: 'textile', unit_label: 'm', quantity: 6.4, pleat_name: 'Sık pile', ...changes });
const job = changes => ({ line_id: ids.line, stage: 'sewing', sewing: ids.staff, snapshot: { kind: 'textile', product_name: 'SYNTHETIC TÜL', room_name: 'SYNTHETIC ROOM' }, ...changes });
const entryInput = changes => ({ operation_id: operation, type: 'payout', date: '2026-10-28', account: 'cash', amount: '5000', person_id: ids.salary, payment_kind: 'advance', description: 'SYNTHETIC ADVANCE', ...changes });

test('salary accrual does not spend cash; one advance changes both cash and personnel balance once', () => {
  const person = salaryPerson(), c = config();
  const wage = officeEntry({ operation_id: operation, type: 'salary', date: '2026-10-28', person_id: person._id, period: '2026-10', expected_person_revision: 0, description: 'SYNTHETIC MONTHLY' }, c, person, now);
  assert.deepEqual(wage.cash, { cash: '0', bank: '0', pos: '0' }); assert.equal(wage.person_delta_minor, '3000000');
  const paid = officeEntry(entryInput(), c, person, now), totals = officeSummary([wage, paid], [], c, [person]);
  assert.equal(totals.accounts.cash.balance_minor, '9500000'); assert.deepEqual(totals.people[person._id], { balance: '2500000', earned: '3000000', paid: '500000', meter_units: '0' });
});
test('unpaid and excessive advances remain explicit; cash/bank/POS transfers do not create income', () => {
  const c = config(), p = salaryPerson(), payment = officeEntry(entryInput(), c, p, now);
  assert.equal(officeSummary([payment], [], c, [p]).people[p._id].balance, '-500000');
  const transfer = officeEntry(entryInput({ type: 'transfer', person_id: undefined, payment_kind: undefined, account: 'pos', to_account: 'bank', amount: '1500' }), c, null, now);
  assert.deepEqual(transfer.cash, { cash: '0', bank: '150000', pos: '-150000' }); assert.equal(transfer.person_delta_minor, '0');
  c.openings.cash = null; assert.equal(officeSummary([payment], [], c, [p]).accounts.cash.balance_minor, null);
});
test('existing receipts are excluded at setup, new split receipts are automatic, mail order never increases cash', () => {
  const c = config(); c.excluded_payment_keys = [`${ids.sale}:old`];
  const make = (request_id, method, amount, changes = {}) => ({ request_id, method, amount, paid_date: '2026-10-28', kind: 'Kapora', ...changes });
  const sales = [{ _id: ids.sale, customer_name: 'SYNTHETIC CUSTOMER', payments: [make('old', 'Nakit', 9000), make('cash', 'Nakit', 5000), make('bank', 'Havale / EFT', 3000), make('pos', 'Kredi Kartı', 2000), make('mo', 'Mail Order', 14000), make('void', 'Nakit', 1000, { voided_at: new Date() }), make('prior', 'Nakit', 100, { paid_date: '2026-10-27' })] }];
  const before = structuredClone(sales), receipts = cashReceipts(sales, c), totals = officeSummary([], receipts, c, []);
  assert.equal(receipts.length, 5); assert.equal(totals.accounts.cash.movement_minor, '500000'); assert.equal(totals.accounts.bank.movement_minor, '300000'); assert.equal(totals.accounts.pos.movement_minor, '200000');
  assert.deepEqual(receipts.find(r => r.type === 'mail_order').cash, { cash: '0', bank: '0', pos: '0' }); assert.deepEqual(sales, before);
});
test('invalid money, dates, privileged fields, wrong personnel and stale salary prices cannot be posted', () => {
  const c = config(), p = salaryPerson();
  for (const patch of [{ amount: '-1' }, { amount: '1.001' }, { amount: '0' }, { date: '2026-02-30' }, { date: '2026-10-27' }, { date: '2026-10-29' }, { account: 'pos' }, { person_id: ids.person }, { payment_kind: 'fake' }, { cash: { cash: '1' } }, { person_delta_minor: '100' }, { operation_id: 'bad' }]) assert.throws(() => officeEntry(entryInput(patch), c, p, now));
  const base = { operation_id: operation, type: 'salary', date: '2026-10-28', person_id: p._id, period: '2026-10', expected_person_revision: 0, description: 'SYNTHETIC' };
  for (const patch of [{ expected_person_revision: 1 }, { period: '2026-11' }, { period: '2026-09' }, { amount: '999999' }]) assert.throws(() => officeEntry({ ...base, ...patch }, c, p, now));
  assert.throws(() => officeEntry(base, c, { ...p, monthly_minor: null }, now));
});
test('actual calculated textile and fon quantities include seam allowance, repeats and every panel exactly once', () => {
  const product = { _id: ids.product, product_name: 'SYNTHETIC', calculation_type: 'mt', product_category: { category_name: 'Tül' }, sale_price: 100, currency: 'TRY', extra_options: [], stock_tracking: false };
  const line = calculateCurtainLine(product, { ...defaultMeasurement(product), width: '200', height: '260', pieces: '1', count: '1', pleat_id: 'sik', labor_price: '99', extra_indices: [] });
  const s = lineSale(line), work = sewingMeter(s, job()); assert.equal(work.meter_units, 64000); assert.equal(work.rate_key, 'tul:sik');
  assert.equal(priceSewing(work, piecePerson()).amount_minor, '16000');
  const special = sewingMeter(lineSale(sampleLine({ quantity: 8.1234, mode: 'fon' })), job()); assert.equal(special.meter_units, 81234); assert.equal(priceSewing(special, piecePerson()).amount_minor, '24370');
  for (const [name, key] of [['Amerikan pile', 'amerikan'], ['Kapama Amerikan pile', 'kapama'], ['S pile', 's']]) assert.equal(sewingMeter(lineSale(sampleLine({ pleat_name: name })), job()).rate_key, `tul:${key}`);
});
test('mechanical, unknown/changed quantity and missing wages never become a false zero payable', () => {
  assert.equal(sewingMeter(lineSale(sampleLine()), job({ snapshot: { kind: 'mechanical' } })).meter_units, null);
  const s = lineSale(sampleLine()); s.sale_items[0].quantity = 9; assert.equal(sewingMeter(s, job()).meter_units, null);
  for (const changes of [{ unit_label: 'adet' }, { quantity: -1 }, { quantity: 1.12345 }, { mode: 'standard' }]) assert.equal(sewingMeter(lineSale(sampleLine(changes)), job()).meter_units, null);
  assert.equal(priceSewing({ meter_units: 64000, rate_key: 'tul:sik' }, { ...piecePerson(), rates: [] }), null);
});
test('separate staff prices have exact kuruş rounding and never use customer selling or labor prices', () => {
  const work = { meter_units: 64000, rate_key: 'tul:sik' };
  assert.equal(priceSewing(work, piecePerson()).amount_minor, '16000');
  assert.equal(priceSewing(work, { ...piecePerson(), rates: [{ key: 'tul:*', minor: '3000' }] }).amount_minor, '19200');
  const input = { operation_id: operation, name: 'TEST PIECE', kind: 'piece', staff_id: '', monthly_salary: '', rates: [{ key: 'tul:*', amount: '25,50' }, { key: 'fon:*', amount: '' }] };
  assert.deepEqual(personInput(input).rates, [{ key: 'tul:*', minor: '2550' }]);
  for (const rates of [[null], [{ key: 'tul:*', amount: '0' }], [{ key: 'bad', amount: '25' }], [{ key: 'tul:*', amount: '25' }, { key: 'tul:*', amount: '30' }]]) assert.throws(() => personInput({ ...input, rates }));
});
test('corrections preserve history and reverse both money and personnel/metre balances without a bank refund', () => {
  const c = config(), p = salaryPerson(), paid = { ...officeEntry(entryInput(), c, p, now), _id: '800000000000000000000001' }, reversal = officeReverse(paid, { operation_id: otherOperation, reason: 'SYNTHETIC CORRECTION' });
  const totals = officeSummary([paid, reversal], [], c, [p]); assert.equal(totals.people[p._id].balance, '0'); assert.equal(totals.people[p._id].paid, '0'); assert.equal(totals.accounts.cash.movement_minor, '0');
  const sewing = { _id: '800000000000000000000002', type: 'sewing', person: ids.person, person_delta_minor: '16000', amount_minor: '16000', cash: { cash: '0', bank: '0', pos: '0' }, sewing: { meter_units: 64000, rate_minor: '2500' } };
  const undone = officeSummary([sewing, officeReverse(sewing, { operation_id: otherOperation, reason: 'SYNTHETIC' })], [], c, [piecePerson()]); assert.equal(undone.people[ids.person].meter_units, '0'); assert.equal(undone.people[ids.person].earned, '0'); assert.throws(() => officeReverse(reversal, { operation_id: operation, reason: 'SYNTHETIC' }));
});

const matches = (record, filter = {}) => Object.entries(filter).every(([key, expected]) => expected === null ? record[key] == null : String(record[key]) === String(expected));
const q = getter => ({ session() { return this; }, select() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return Promise.resolve(structuredClone(getter())); }, then(resolve, reject) { return Promise.resolve(getter()).then(resolve, reject); } });
function mockOffice(t, configured = true) {
  const db = { office: configured ? config() : null, people: [piecePerson(), salaryPerson()], entries: [], works: [], sales: [lineSale(sampleLine())], staff: [{ _id: ids.staff, name: 'Nurten TEST', active: true, duties: ['sewing'] }], calls: [], sequence: 0, failEntry: false };
  const nextId = () => String(++db.sequence).padStart(24, '0');
  for (const model of [CashOffice, PayPerson, OfficeEntry, SewingWork]) t.mock.method(model, 'init', async () => {});
  t.mock.method(CashOffice, 'exists', () => q(() => !!db.office));
  t.mock.method(CashOffice, 'findById', () => q(() => db.office));
  t.mock.method(CashOffice, 'findOneAndUpdate', () => q(() => { if (!db.office) return null; db.office.revision++; return db.office; }));
  t.mock.method(CashOffice, 'create', async ([item]) => { db.office = structuredClone(item); return [db.office]; });
  t.mock.method(CashOffice, 'updateOne', async (_filter, update) => { for (const [key, value] of Object.entries(update.$set || {})) { if (key.startsWith('openings.')) db.office.openings[key.split('.')[1]] = value; } return { modifiedCount: 1 }; });
  for (const [model, key] of [[PayPerson, 'people'], [OfficeEntry, 'entries'], [SewingWork, 'works']]) {
    t.mock.method(model, 'find', filter => q(() => db[key].filter(row => matches(row, filter))));
    t.mock.method(model, 'findOne', filter => q(() => db[key].find(row => matches(row, filter)) || null));
    t.mock.method(model, 'findById', id => q(() => db[key].find(row => String(row._id) === String(id)) || null));
    t.mock.method(model, 'exists', filter => q(() => db[key].some(row => matches(row, filter))));
    t.mock.method(model, 'countDocuments', () => q(() => db[key].length));
    t.mock.method(model, 'create', async ([item], options) => { assert.ok(options.session); if (key === 'entries' && db.failEntry) throw Error('SYNTHETIC FAILURE'); const record = { _id: nextId(), createdAt: new Date(), revision: 0, ...(key === 'works' ? { journal: null } : {}), ...structuredClone(item) }; db[key].push(record); return [record]; });
    t.mock.method(model, 'updateOne', async (filter, update, options) => { assert.ok(options.session); const item = db[key].find(row => matches(row, filter)); if (!item) return { modifiedCount: 0 }; Object.assign(item, structuredClone(update.$set || {})); return { modifiedCount: 1 }; });
  }
  t.mock.method(Staff, 'find', () => q(() => db.staff)); t.mock.method(Staff, 'exists', filter => q(() => db.staff.some(row => matches(row, filter))));
  t.mock.method(Sale, 'find', () => q(() => db.sales)); t.mock.method(Sale, 'exists', filter => q(() => db.sales.some(row => matches(row, filter))));
  t.mock.method(PayPerson, 'findOneAndUpdate', (filter, update) => q(() => { const p = db.people.find(row => matches(row, filter)); if (!p) return null; Object.assign(p, structuredClone(update.$set)); p.revision++; return p; }));
  t.mock.method(mongoose.connection, 'transaction', async fn => { const before = structuredClone(db); try { return await fn({ transaction: true }); } catch (e) { Object.assign(db, before); throw e; } });
  t.after(async () => { db.office = null; await startCashOffice(); });
  return db;
}
test('completion captures and posts one immutable sewing work in the same transaction; replay or rework cannot double-pay', async t => {
  const db = mockOffice(t); await startCashOffice(); const s = db.sales[0], old = job(), next = job({ stage: 'sewn' });
  const capture = () => mongoose.connection.transaction(session => captureSewingWork({ _id: ids.order }, s, old, next, admin, session));
  await capture(); await capture(); assert.equal(db.works.length, 1); assert.equal(db.entries.length, 1); assert.equal(db.entries[0].amount_minor, '16000'); assert.equal(db.entries[0].sewing.meter_units, 64000);
  db.people[0].rates[1].minor = '9999'; await postSewingPrice(db.works[0], db.people[0], admin, {}); assert.equal(db.entries[0].amount_minor, '16000');
  await mongoose.connection.transaction(session => captureSewingWork({ _id: ids.order }, { ...s, measurement_revision: 99 }, old, next, admin, session)); assert.equal(db.entries.length, 1);
});
test('missing price leaves real metraj pending; later pricing completes once and an insert failure rolls everything back', async t => {
  const db = mockOffice(t); await startCashOffice(); db.people[0].rates = [];
  await mongoose.connection.transaction(session => captureSewingWork({ _id: ids.order }, db.sales[0], job(), job({ stage: 'sewn' }), admin, session));
  assert.equal(db.entries.length, 0); assert.equal(db.works[0].meter_units, 64000); assert.equal(db.works[0].journal, null);
  db.people[0].rates = [{ key: 'tul:*', minor: '2500' }]; db.failEntry = true; const before = structuredClone(db.works[0]);
  await assert.rejects(mongoose.connection.transaction(session => postSewingPrice(db.works[0], db.people[0], admin, session))); assert.deepEqual(db.works[0], before); assert.equal(db.entries.length, 0);
  db.failEntry = false; await mongoose.connection.transaction(session => postSewingPrice(db.works[0], db.people[0], admin, session)); assert.equal(db.entries.length, 1); assert.equal(db.entries[0].amount_minor, '16000');
});
test('no historical backfill, no mechanical wages and no piece earnings for salaried sewing staff', async t => {
  const db = mockOffice(t); await startCashOffice();
  await captureSewingWork({ _id: ids.order }, db.sales[0], job({ stage: 'sewn' }), job({ stage: 'ready' }), admin, {});
  await captureSewingWork({ _id: ids.order }, db.sales[0], job(), job({ stage: 'sewn', snapshot: { kind: 'mechanical' } }), admin, {});
  db.people[0].kind = 'salary'; await captureSewingWork({ _id: ids.order }, db.sales[0], job(), job({ stage: 'sewn' }), admin, {});
  assert.equal(db.works.length, 0); assert.equal(db.entries.length, 0);
});
async function httpApp(t, db) {
  const previous = ENV.JWT_SECRET; ENV.JWT_SECRET = 'SYNTHETIC_CASH_TEST_SECRET'; t.after(() => { ENV.JWT_SECRET = previous; });
  t.mock.method(User, 'findById', id => ({ select: () => ({ populate: async () => String(id) === ids.admin ? admin : { _id: id, user_role: { role_name: 'Satış Temsilcisi' } } }) }));
  const app = express(); app.use(express.json()); app.use('/cash-office', cashPersonnelRouter); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const token = jwt.sign({ id: ids.admin }, ENV.JWT_SECRET), base = `http://127.0.0.1:${server.address().port}/cash-office`;
  return { base, call: async (path = '', body, method = body ? 'POST' : 'GET', auth = token) => { const res = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; }, db };
}
test('cash endpoints reject missing/staff/sales-representative credentials before accessing private payroll data', async t => {
  const db = mockOffice(t), app = await httpApp(t, db);
  assert.equal((await app.call('', null, 'GET', '')).status, 401);
  const rep = jwt.sign({ id: ids.person }, ENV.JWT_SECRET), staff = jwt.sign({ id: ids.staff, scope: 'production', aud: 'sahinsoy-production' }, ENV.JWT_SECRET);
  for (const token of [rep, staff]) for (const [path, body] of [['', null], ['/entries', entryInput()], ['/setup', {}], ['/people', {}], ['/reconcile', {}]]) assert.equal((await app.call(path, body, body ? 'POST' : 'GET', token)).status, 403);
  assert.equal(db.entries.length, 0);
});
test('payment, salary duplication and correction endpoints are idempotent and do not modify sale/mail-order records', async t => {
  const db = mockOffice(t), beforeSales = structuredClone(db.sales), app = await httpApp(t, db), day = officeToday();
  const payload = entryInput({ date: day });
  assert.equal((await app.call('/entries', payload)).status, 200); assert.equal((await app.call('/entries', payload)).status, 200); assert.equal(db.entries.length, 1);
  assert.equal((await app.call('/entries', { ...payload, amount: '6000' })).status, 409);
  const wage = { operation_id: otherOperation, type: 'salary', date: day, person_id: ids.salary, period: day.slice(0, 7), expected_person_revision: 0, description: 'SYNTHETIC SALARY' };
  assert.equal((await app.call('/entries', wage)).status, 200); assert.equal((await app.call('/entries', { ...wage, operation_id: '11111111-2222-4333-8444-555555555557' })).status, 409); assert.equal(db.entries.length, 2);
  const correction = { operation_id: '11111111-2222-4333-8444-555555555558', reason: 'SYNTHETIC CORRECTION' }, path = `/entries/${db.entries[0]._id}/reverse`;
  assert.equal((await app.call(path, correction)).status, 200); assert.equal((await app.call(path, correction)).status, 200); assert.equal(db.entries.length, 3); assert.deepEqual(db.sales, beforeSales);
  const view = await app.call(`?date=${day}`); assert.equal(view.status, 200); assert.equal(view.data.summary.people[ids.salary].balance, '3000000'); assert.equal(view.data.summary.accounts.cash.movement_minor, '0');
});
test('setup excludes all existing receipt keys and seeds the stated seven names with no fabricated money', async t => {
  const db = mockOffice(t, false); db.people = []; db.sales[0].payments = [{ request_id: 'OLD_CORRECT_MAIL_ORDER', amount: 13000, method: 'Mail Order' }]; const app = await httpApp(t, db), day = officeToday();
  const setup = { operation_id: operation, start_date: day, cash: '', bank: '', pos: '' };
  assert.equal((await app.call('/setup', setup)).status, 200); assert.equal((await app.call('/setup', setup)).status, 200);
  assert.equal(db.people.length, 7); assert.deepEqual(db.people.filter(p => p.kind === 'piece').map(p => p.name), ['Nurten', 'Hayati']); assert.equal(db.people.filter(p => p.kind === 'salary').length, 5);
  assert.deepEqual(db.office.openings, { cash: null, bank: null, pos: null }); assert.equal(db.entries.length, 0); assert.equal(db.office.excluded_payment_keys.length, 1); assert.equal(db.sales[0].payments[0].amount, 13000);
  assert.equal((await app.call('/opening', { account: 'cash', amount: '1000' })).status, 200); assert.equal((await app.call('/opening', { account: 'cash', amount: '1000' })).status, 200); assert.equal((await app.call('/opening', { account: 'cash', amount: '2000' })).status, 409);
});
test('production hook is inside the existing transaction before notifications, with no supplier-ledger writes', async () => {
  const controller = await readFile(new URL('../controllers/production.controller.js', import.meta.url), 'utf8'), code = await readFile(new URL('./cashPersonnel.js', import.meta.url), 'utf8');
  assert.ok(controller.includes('await captureSewingWork(record, sale, job, jobs.find(line => line.line_id === job.line_id), req.productionActor, session);'));
  for (const bad of ['LedgerAccount', 'postMailOrderLedger', 'Sale.update', 'Product.update', 'sendMessage']) assert.ok(!code.includes(bad));
  assert.ok(code.includes("source_key = `${record._id}:${newJob.line_id}`")); assert.ok(code.includes("source_key: 1 }, { unique: true"));
});
