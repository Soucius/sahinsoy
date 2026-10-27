import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Staff from '../models/ProductionStaff.js';
import LedgerAccount from '../models/LedgerAccount.js';
import { ENV } from './env.js';
import router from '../routes/accounting.route.js';
import { newLedgerAccount, reverseLedgerMovement } from './accountLedger.js';
import { invoiceAutoPlan, invoiceAccountMatch, invoiceDocumentKey, invoiceFingerprint, invoiceOperation, readAutoInvoiceSnapshot, postAutomaticInvoice, invoiceAutoPublic, configureInvoiceAuto, InvoiceAutoState } from './invoiceAutoLedger.js';

const now = new Date('2026-10-28T09:00:00Z'), actor = { _id: '111111111111111111111111', name: 'TEST_ADMIN' };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const invoice = changes => ({ id: id(2), number: 'TEST2026000000001', supplier_identifier: '1234567890', supplier: 'OBA PERDESAN TEKNİK TEKSTİL ANONİM ŞİRKETİ', date: '2026-10-28', currency: 'TRY', amount: '1168.20', tax: '106.20', tax_exclusive: '1062.00', status: 'Approved', type: 'Sales', ...changes });
const account = changes => ({ _id: '222222222222222222222222', ...newLedgerAccount({ operation_id: id(1), name: 'OBA', category: 'supplier', currency: 'TRY', opening_date: '2026-10-27', opening_amount: '10000', opening_direction: 'owe', ...changes }, actor, now) });
const apply = (a, plan) => ({ ...a, revision: a.revision + 1, balance_minor: plan.balance_minor, entries: [...a.entries, plan.entry] });
const page = (invoices, index = 0, count = invoices.length, pages = count ? 1 : 0) => ({ invoices, page: index, total_count: count, total_pages: pages });

test('cutover includes 28 October but never re-adds 27 October or an opening-day invoice', () => {
  const a = account(), plan = invoiceAutoPlan(invoice(), a, '2026-10-28', actor, now);
  assert.equal(plan.balance_minor, '1116820'); assert.equal(plan.entry.type, 'invoice');
  assert.equal(plan.entry.source_invoice_id, id(2)); assert.equal(plan.entry.source_invoice_number, invoice().number);
  assert.equal(new LedgerAccount(apply(a, plan)).validateSync(), undefined);
  assert.throws(() => invoiceAutoPlan(invoice({ date: '2026-10-27' }), a, '2026-10-28', actor, now), /başlangıç/);
  assert.throws(() => invoiceAutoPlan(invoice(), account({ opening_date: '2026-10-28' }), '2026-10-28', actor, now), /açılış tarihinde/);
  assert.equal(a.balance_minor, '1000000');
});
test('only approved, positive ordinary sales with exact currency and confirmed opening can post', () => {
  for (const changes of [{ status: 'WaitingForAprovement' }, { status: 'Canceled' }, { status: 'Declined' }, { type: 'Return' }, { type: 'Tax' }, { amount: '-1.00' }, { amount: '0' }, { amount: '1.234' }, { amount: 'NaN' }, { currency: 'USD' }, { date: '2026-10-29' }, { supplier_identifier: '' }, { id: '' }]) assert.throws(() => invoiceAutoPlan(invoice(changes), account(), '2026-10-28', actor, now));
  for (const changes of [{ opening_known: false, opening_amount: '' }, { category: 'personal' }, { currency: 'GOLD_GRAM' }]) assert.throws(() => invoiceAutoPlan(invoice(), account(changes), '2026-10-28', actor, now));
  assert.equal(invoiceAutoPlan(invoice({ amount: '1.23000000' }), account(), '2026-10-28', actor, now).entry.amount_minor, '123');
});
test('identities are stable, cross-currency duplicate invoice numbers cannot post twice, altered totals change fingerprint', () => {
  assert.equal(invoiceOperation(invoice().id), invoiceOperation(invoice().id));
  assert.notEqual(invoiceOperation(id(2)), invoiceOperation(id(3)));
  assert.equal(invoiceDocumentKey(invoice()), invoiceDocumentKey(invoice({ id: id(3), currency: 'USD' })));
  assert.notEqual(invoiceFingerprint(invoice()), invoiceFingerprint(invoice({ amount: '99.00' })));
  assert.equal(invoiceFingerprint(invoice()), invoiceFingerprint(invoice({ supplier: 'NEW DISPLAY TITLE' })));
});
test('supplier aliases are exact and ambiguity, another currency or personal accounts never silently match', () => {
  const i = invoice(), a = account();
  assert.equal(invoiceAccountMatch(i, [a], [i]), a);
  assert.equal(invoiceAccountMatch(i, [a, { ...a, _id: '333333333333333333333333', name: 'OBA Perdesan' }], [i]), null);
  assert.equal(invoiceAccountMatch(i, [a], [i, invoice({ id: id(3), supplier_identifier: '0987654321' })]), null);
  assert.equal(invoiceAccountMatch(i, [{ ...a, name: 'KOBA' }], [i]), null);
  assert.equal(invoiceAccountMatch(i, [{ ...a, currency: 'USD' }], [i]), null);
  assert.equal(invoiceAccountMatch(i, [{ ...a, category: 'personal' }], [i]), null);
  assert.equal(invoiceAccountMatch(invoice({ supplier: 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.' }), [{ ...a, name: 'Lilium' }], [invoice({ supplier: 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.' })]).name, 'Lilium');
});
test('full snapshot scans every page and retains late documents, with future cutover making no provider request', async () => {
  const seen = [];
  const rows = await readAutoInvoiceSnapshot('2026-10-28', '2026-10-30', async q => { seen.push(q); return q.page === '0' ? page([invoice({ date: '2026-10-30' })], 0, 2, 2) : page([invoice({ id: id(3), number: 'TEST2' })], 1, 2, 2); });
  assert.equal(rows.length, 2); assert.equal(seen[1].page, '1'); assert.equal(rows[1].date, '2026-10-28');
  assert.deepEqual(await readAutoInvoiceSnapshot('2026-10-28', '2026-10-27', () => { throw Error('must not call'); }), []);
  const ranges = [];
  await readAutoInvoiceSnapshot('2026-10-28', '2027-11-01', async q => { ranges.push(q); return page([]); });
  assert.equal(ranges[0].end_date, '2027-10-28'); assert.equal(ranges[1].start_date, '2027-10-29');
});
test('pagination changes, missing pages, duplicate UUID/number, out-of-range invoices or network errors stop before any write', async () => {
  for (const fetcher of [async () => page([], 0, 1, 1), async () => page([invoice(), invoice()], 0, 2, 1), async () => page([invoice(), invoice({ id: id(3) })], 0, 2, 1), async () => page([invoice({ date: '2026-10-27' })]), async q => q.page === '0' ? page([invoice()], 0, 2, 2) : page([], 1, 3, 2), async () => { throw Error('network'); }]) await assert.rejects(readAutoInvoiceSnapshot('2026-10-28', '2026-10-28', fetcher));
  await assert.rejects(readAutoInvoiceSnapshot('2026-10-28', '2026-10-28', async () => page([invoice()]), async () => { throw Error('lease lost'); }), /lease lost/);
});

function memoryDb() {
  let db = { account: account(), receipt: null, enabled: true }, tail = Promise.resolve();
  const chain = value => ({ session: () => ({ lean: async () => value() }) });
  const deps = {
    State: { updateOne: async () => ({ matchedCount: db.enabled ? 1 : 0 }) },
    Posting: {
      findOne: () => chain(() => db.receipt),
      create: async ([receipt]) => { if (db.receipt) throw Error('duplicate'); db.receipt = structuredClone(receipt); },
    },
    Accounts: {
      find: () => chain(() => [structuredClone(db.account)]),
      updateOne: async (filter, change) => { if (filter.revision !== db.account.revision) return { modifiedCount: 0 }; db.account.entries.push(change.$push.entries); db.account.balance_minor = change.$set.balance_minor; db.account.revision++; return { modifiedCount: 1 }; },
    },
    transaction: fn => {
      const run = tail.then(async () => { const previous = structuredClone(db); try { return await fn({}); } catch (error) { db = previous; throw error; } }); tail = run.catch(() => {}); return run;
    },
  };
  return { deps, state: () => db, syncState: { starts_on: '2026-10-28', actor_id: actor._id, lease_token: 'test' } };
}
// Runtime planning uses current Istanbul date. Dates here are actual test dates,
// leaving pure cutoff examples above fixed and deterministic.
const runtimeInvoice = () => invoice({ date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date()) });
function runtimeDb() { const m = memoryDb(); m.state().account.opening_date = '2026-01-01'; m.syncState.starts_on = '2026-01-02'; return m; }
test('two simultaneous workers and repeated runs produce exactly one receipt and one balance change', async () => {
  const m = runtimeDb(), i = runtimeInvoice();
  const results = await Promise.all([postAutomaticInvoice(i, [i], m.syncState, m.deps), postAutomaticInvoice(i, [i], m.syncState, m.deps)]);
  assert.equal(results.filter(r => r.posted).length, 1); assert.equal(results.filter(r => r.existing).length, 1);
  assert.equal(m.state().account.balance_minor, '1116820'); assert.equal(m.state().account.entries.length, 2); assert.ok(m.state().receipt);
});
test('a failed account update rolls back receipt and balance together and the next run can retry', async () => {
  const m = runtimeDb(), i = runtimeInvoice(), original = m.deps.Accounts.updateOne;
  m.deps.Accounts.updateOne = async () => ({ modifiedCount: 0 });
  await assert.rejects(postAutomaticInvoice(i, [i], m.syncState, m.deps), /aynı anda/);
  assert.equal(m.state().receipt, null); assert.equal(m.state().account.balance_minor, '1000000');
  m.deps.Accounts.updateOne = original;
  assert.equal((await postAutomaticInvoice(i, [i], m.syncState, m.deps)).posted, true);
});
test('later cancellation, changed amount/UUID or manual reversal cannot silently recreate or alter a posting', async () => {
  const m = runtimeDb(), i = runtimeInvoice(); await postAutomaticInvoice(i, [i], m.syncState, m.deps);
  for (const changed of [invoice({ ...i, status: 'Canceled' }), invoice({ ...i, amount: '2000' }), invoice({ ...i, id: id(4) })]) assert.ok((await postAutomaticInvoice(changed, [changed], m.syncState, m.deps)).issue);
  const a = m.state().account, reversal = reverseLedgerMovement(a, invoiceOperation(i.id), { operation_id: id(5), expected_revision: a.revision, reason: 'Synthetic correction' }, actor);
  m.state().account = apply(a, reversal);
  assert.equal((await postAutomaticInvoice(i, [i], m.syncState, m.deps)).existing, true);
  assert.equal(m.state().account.balance_minor, '1000000'); assert.equal(m.state().account.entries.length, 3);
});
test('pause/lease loss prevents a write and status does not disclose lease or actor identifiers', async () => {
  const m = runtimeDb(), i = runtimeInvoice(); m.state().enabled = false;
  await assert.rejects(postAutomaticInvoice(i, [i], m.syncState, m.deps), /duraklatıldı/);
  assert.equal(m.state().receipt, null);
  const status = invoiceAutoPublic({ enabled: true, starts_on: '2026-10-28', lease_token: 'PRIVATE_LEASE', actor_id: 'PRIVATE_ACTOR' });
  assert.equal(status.starts_on, '2026-10-28'); assert.equal(status.interval_minutes, 15);
  assert.ok(!JSON.stringify(status).includes('PRIVATE'));
});
test('configuration rejects backdating and cutover changes; pause/resume preserves the original boundary', async t => {
  const previous = { UYUMSOFT_ENABLED: process.env.UYUMSOFT_ENABLED, UYUMSOFT_USERNAME: process.env.UYUMSOFT_USERNAME, UYUMSOFT_PASSWORD: process.env.UYUMSOFT_PASSWORD };
  Object.assign(process.env, { UYUMSOFT_ENABLED: 'true', UYUMSOFT_USERNAME: 'SYNTHETIC', UYUMSOFT_PASSWORD: 'SYNTHETIC' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let state = null;
  t.mock.method(InvoiceAutoState, 'findById', () => ({ lean: async () => state }));
  t.mock.method(InvoiceAutoState, 'findOneAndUpdate', () => ({ lean: async () => null }));
  t.mock.method(InvoiceAutoState, 'updateOne', async (_filter, changes) => { state ||= { ...changes.$setOnInsert }; Object.assign(state, changes.$set); return { matchedCount: 1 }; });
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
  async function call(body) { const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; await configureInvoiceAuto({ body, productionActor: actor }, res); return res; }
  assert.equal((await call({ enabled: true, starts_on: '2000-01-01' })).code, 400);
  assert.equal(state, null);
  assert.equal((await call({ enabled: true, starts_on: date, delta: 1 })).code, 400);
  const saved = await call({ enabled: true, starts_on: date }); assert.equal(saved.code, 200); assert.equal(saved.data.enabled, true); assert.equal(state.starts_on, date);
  assert.equal((await call({ enabled: true, starts_on: '2000-01-01' })).code, 409);
  await call({ enabled: false }); assert.equal(state.enabled, false); assert.equal(state.starts_on, date);
  await call({ enabled: true, starts_on: date }); assert.equal(state.enabled, true); assert.equal(state.starts_on, date);
});
test('new status/configuration/check routes require administrator authorization and reject staff', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'synthetic-auto-invoice-auth'; t.after(() => { ENV.JWT_SECRET = old; });
  t.mock.method(User, 'findById', () => ({ select: () => ({ populate: async () => ({ _id: actor._id, user_role: { role_name: 'Satış Temsilcisi' } }) }) }));
  t.mock.method(Staff, 'findById', () => ({ lean: async () => ({ _id: actor._id, active: true, session_version: 1, duties: ['cutting'] }) }));
  const app = express(); app.use('/accounting', express.json(), router); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  for (const [path, method] of [['/invoice-auto', 'GET'], ['/invoice-auto', 'POST'], ['/invoice-auto/check', 'POST']]) {
    const url = `http://127.0.0.1:${server.address().port}/accounting${path}`;
    assert.equal((await fetch(url, { method })).status, 401);
    for (const payload of [{ id: actor._id }, { id: actor._id, scope: 'production', aud: 'sahinsoy-production', version: 1 }]) assert.equal((await fetch(url, { method, headers: { Authorization: `Bearer ${jwt.sign(payload, ENV.JWT_SECRET)}` } })).status, 403);
  }
});
