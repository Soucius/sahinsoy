import test from 'node:test';
import assert from 'node:assert/strict';
import { currentCashEntries, currentCashRows, makeCashResetHandlers, resetInput } from './cashTestReset.js';
import { cashReceipts, officeSummary } from './cashPersonnelRules.js';
import { testArchiveEnabled } from './testSaleArchive.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { ENV } from './env.js';
import { cashPersonnelRouter } from './cashPersonnel.js';
const op = '11111111-2222-4333-8444-555555555555';
const undo = '11111111-2222-4333-8444-555555555556';
const cash = amount => ({ cash: String(amount), bank: '0', pos: '0' });
const person = { _id: 'PERSON' };
function fixture() {
  const state = { config: { _id: 'store', revision: 0, openings: { cash: '500000', bank: '500000', pos: '500000' }, excluded_payment_keys: ['older'], start_date: '2026-10-28', test_cash_resets: [] }, entries: [{ _id: 'entry1', cash: cash('-50000'), person: 'PERSON', person_delta_minor: '-50000', type: 'payout', amount_minor: '50000' }], sales: [{ _id: 'SALE', payments: [{ request_id: 'old', method: 'Nakit', amount: 1000, kind: 'Kapora', paid_date: '2026-10-29' }] }], active: 0, enabled: true, fail: false };
  const query = get => ({ session() { return this; }, select() { return this; }, limit() { return this; }, lean() { return Promise.resolve(structuredClone(get())); }, then(resolve, reject) { return Promise.resolve(get()).then(resolve, reject); } });
  const deps = {
    office: { findById: () => query(() => state.config), findOneAndUpdate: filter => query(() => { if (state.config.revision !== filter.revision) return null; state.config.revision++; return state.config; }), updateOne: async (filter, update, options) => { assert.ok(options.session); if (state.fail) throw Error('DB FAILED'); if (filter.revision !== state.config.revision) return { modifiedCount: 0 }; Object.assign(state.config, structuredClone(update.$set)); return { modifiedCount: 1 }; } },
    entries: { find: () => query(() => state.entries) }, sales: { countDocuments: () => query(() => state.active), find: () => query(() => state.sales) }, include: q => q, enabled: () => state.enabled,
    transaction: async fn => { const before = structuredClone(state); try { return await fn({ transaction: true }); } catch (error) { Object.assign(state, before); throw error; } },
  };
  const handlers = makeCashResetHandlers(deps);
  const call = async (restoring = false, input = {}) => { const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } }; await handlers[restoring ? 'restore' : 'reset']({ user: { _id: 'ADMIN' }, body: { operation_id: restoring ? undo : op, expected_revision: restoring ? 1 : 0, ...(restoring ? { reset_id: op } : { confirmation: 'SIFIRLA' }), ...input } }, res); return res; };
  return { state, call };
}
test('reset zeroes all three cash balances while retaining personnel balances and immutable originals', async () => {
  const { state, call } = fixture(), originals = structuredClone({ entries: state.entries, sales: state.sales });
  const before = officeSummary(state.entries, cashReceipts(state.sales, state.config), state.config, [person]);
  assert.equal((await call()).code, 200);
  const after = officeSummary(currentCashEntries(state.entries, state.config), cashReceipts(state.sales, state.config), state.config, [person]);
  for (const row of Object.values(after.accounts)) assert.equal(row.balance_minor, '0');
  assert.deepEqual(after.people, before.people); assert.deepEqual({ entries: state.entries, sales: state.sales }, originals);
  assert.deepEqual(currentCashRows(state.entries, state.config), []);
  state.entries.push({ _id: 'new', cash: cash('23000'), person_delta_minor: '0' });
  state.sales[0].payments.push({ request_id: 'new', method: 'Havale / EFT', amount: 500, kind: 'Kapora', paid_date: '2026-10-29' });
  const next = officeSummary(currentCashEntries(state.entries, state.config), cashReceipts(state.sales, state.config), state.config, [person]);
  assert.equal(next.accounts.cash.balance_minor, '23000'); assert.equal(next.accounts.bank.balance_minor, '50000');
});
test('reset is idempotent, cannot run with active orders, stale revision or outside exact TEST environment', async () => {
  const { state, call } = fixture(); assert.equal((await call()).code, 200); assert.equal((await call()).code, 200); assert.equal(state.config.test_cash_resets.length, 1);
  assert.equal((await call(false, { operation_id: undo, expected_revision: 0 })).code, 409);
  const other = fixture(); other.state.active = 1; assert.equal((await other.call()).code, 409); assert.equal(other.state.config.revision, 0);
  other.state.enabled = false; assert.equal((await other.call()).code, 404);
  for (const [env, database] of [[{}, 'sahinsoy_test'], [{ RENDER_SERVICE_ID: 'OTHER' }, 'sahinsoy_test'], [{ RENDER_SERVICE_ID: 'srv-db3bk5942hec7397afkg' }, 'production']]) assert.equal(testArchiveEnabled(env, database), false);
  assert.equal(testArchiveEnabled({ RENDER_SERVICE_ID: 'srv-db3bk5942hec7397afkg' }, 'sahinsoy_test'), true);
});
test('restore recovers original cash plus new movements, and retries cannot restore twice', async () => {
  const { state, call } = fixture(), original = structuredClone(state.config);
  await call(); state.entries.push({ _id: 'new', cash: cash('30000'), person_delta_minor: '0' });
  assert.equal((await call(true)).code, 200); assert.equal((await call(true)).code, 200);
  assert.deepEqual(state.config.openings, original.openings); assert.deepEqual(state.config.excluded_payment_keys, original.excluded_payment_keys);
  const result = officeSummary(currentCashEntries(state.entries, state.config), cashReceipts(state.sales, state.config), state.config, [person]);
  assert.equal(result.accounts.cash.balance_minor, '580000'); assert.equal(state.config.revision, 2);
  assert.equal((await call()).code, 409);
});
test('post-reset correction of an old payout changes personnel only, with exact cash recovery on undo', async () => {
  const { state, call } = fixture(); await call();
  state.entries.push({ _id: 'reverse', reverses: 'entry1', cash: cash('50000'), person: 'PERSON', person_delta_minor: '50000', type: 'reversal', reversed_type: 'payout' });
  let result = officeSummary(currentCashEntries(state.entries, state.config), [], state.config, [person]);
  assert.equal(result.accounts.cash.balance_minor, '0'); assert.equal(result.people.PERSON.balance, '0');
  await call(true); result = officeSummary(currentCashEntries(state.entries, state.config), [], state.config, [person]);
  assert.equal(result.accounts.cash.balance_minor, '500000');
});
test('database failure rolls back reset; injected fields and absent explicit confirmation are rejected', async () => {
  const { state, call } = fixture(); state.fail = true; const before = structuredClone(state.config);
  assert.equal((await call()).code, 500); assert.deepEqual(state.config, before);
  const base = { operation_id: op, expected_revision: 0, confirmation: 'SIFIRLA' };
  for (const patch of [{ confirmation: '' }, { openings: {} }, { expected_revision: -1 }, { operation_id: 'bad' }, { cash: '1' }]) assert.throws(() => resetInput({ ...base, ...patch }));
});
test('live reset and restore routes reject anonymous, production staff and non-admin users', async t => {
  const old = ENV.JWT_SECRET; ENV.JWT_SECRET = 'SYNTHETIC_RESET_SECRET'; t.after(() => { ENV.JWT_SECRET = old; });
  t.mock.method(User, 'findById', id => ({ select: () => ({ populate: async () => ({ _id: id, user_role: { role_name: 'Satış Temsilcisi' } }) }) }));
  const app = express(); app.use(express.json(), cashPersonnelRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const token of ['', jwt.sign({ id: '100000000000000000000001' }, ENV.JWT_SECRET), jwt.sign({ id: '100000000000000000000001', scope: 'production', aud: 'sahinsoy-production' }, ENV.JWT_SECRET)]) {
    for (const path of ['/test-reset', '/test-reset/restore']) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: '{}' });
      assert.equal(response.status, token ? 403 : 401);
    }
  }
});
