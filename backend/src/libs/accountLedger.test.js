import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Staff from '../models/ProductionStaff.js';
import LedgerAccount from '../models/LedgerAccount.js';
import router from '../routes/accounting.route.js';
import { ENV } from './env.js';
import { ledgerMinor, ledgerNameKey, newLedgerAccount, ledgerMovement, reverseLedgerMovement, confirmLedgerOpening, ledgerPublic } from './accountLedger.js';

const now = new Date('2026-10-24T00:30:00Z');
const actor = { _id: '111111111111111111111111', name: 'TEST_ADMIN' };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const opening = changes => ({ operation_id: id(1), name: 'SYNTHETIC ACCOUNT', currency: 'TRY', opening_date: '2026-10-23', opening_amount: '25000,50', opening_direction: 'owe', description: 'Synthetic net opening', ...changes });
const account = changes => ({ _id: '222222222222222222222222', ...newLedgerAccount(opening(changes), actor, now) });
const movement = changes => ({ operation_id: id(2), expected_revision: 0, type: 'payment_sent', date: '2026-10-23', amount: '5000,25', method: 'Nakit', description: 'Synthetic payment', ...changes });
const applied = (a, change) => ({ ...a, revision: a.revision + 1, balance_minor: change.balance_minor, entries: [...a.entries, change.entry] });

test('ledger money is exact in kuruş, rejects ambiguous separators and never accepts float input', () => {
  assert.equal(ledgerMinor('0.01'), '1'); assert.equal(ledgerMinor('9999999999,99'), '999999999999');
  assert.equal(ledgerMinor('0', true), '0'); assert.equal(ledgerMinor('1,5'), '150');
  for (const value of ['0', '-1', '1.000', '1.000,50', '1e3', ' 10', 'NaN', '00.50', '10000000000', 0.1, null, []]) assert.throws(() => ledgerMinor(value));
});
test('opening records a net balance once, with direction and provenance, without replaying old payments', () => {
  const a = account();
  assert.equal(a.balance_minor, '2500050'); assert.equal(a.entries.length, 1); assert.equal(a.entries[0].type, 'opening');
  assert.equal(a.entries[0].recorded_by, actor._id); assert.equal(a.entries[0].recorded_at, now);
  assert.equal(account({ opening_direction: 'receivable' }).balance_minor, '-2500050');
  assert.equal(account({ opening_amount: '0' }).balance_minor, '0');
  assert.equal(ledgerNameKey('  ŞAHİN  İŞ  '), ledgerNameKey('sahin is'));
  for (const changes of [{ name: '' }, { name: 'A\nB' }, { currency: 'XXX' }, { opening_date: '2026-02-30' }, { opening_date: '2026-10-25' }, { opening_direction: 'maybe' }, { operation_id: 'bad' }, { balance_minor: '100' }]) assert.throws(() => account(changes));
});
test('payment direction, extra debt and receivables preserve a signed balance including advances', () => {
  const a = account();
  const sent = ledgerMovement(a, movement(), actor, now);
  assert.equal(sent.balance_minor, '2000025'); assert.equal(a.balance_minor, '2500050'); assert.equal(a.entries.length, 1);
  assert.equal(ledgerMovement(a, movement({ type: 'debt', method: '' }), actor, now).balance_minor, '3000075');
  assert.equal(ledgerMovement(a, movement({ type: 'receivable', method: '' }), actor, now).balance_minor, '2000025');
  assert.equal(ledgerMovement(a, movement({ type: 'payment_received' }), actor, now).balance_minor, '3000075');
  assert.equal(ledgerMovement(a, movement({ amount: '30000' }), actor, now).balance_minor, '-499950');
  assert.equal(ledgerMovement(account({ opening_direction: 'receivable' }), movement({ type: 'payment_received' }), actor, now).balance_minor, '-2000025');
});
test('an account with unknown balance is not zero and cannot take payments before its opening is confirmed', () => {
  const a = account({ opening_known: false, opening_amount: '', category: 'supplier' });
  assert.equal(a.balance_minor, null); assert.equal(a.opening_date, null); assert.equal(a.opening_status, 'pending'); assert.equal(a.entries.length, 0);
  assert.equal(new LedgerAccount(a).validateSync(), undefined);
  assert.equal(ledgerPublic(a).balance_minor, null);
  assert.throws(() => ledgerMovement(a, movement(), actor, now), error => error.status === 409);
  assert.throws(() => account({ opening_known: false, opening_amount: '0' }));
  assert.throws(() => account({ category: 'invented' }));
  const request = { operation_id: id(6), expected_revision: 0, opening_date: '2026-10-23', opening_amount: '0', opening_direction: 'owe', description: 'Confirmed zero' };
  const change = confirmLedgerOpening(a, request, actor, now);
  const saved = { ...applied(a, change), opening_date: change.opening_date, opening_status: 'confirmed' };
  assert.equal(saved.balance_minor, '0'); assert.equal(saved.entries.length, 1); assert.equal(saved.opening_status, 'confirmed');
  assert.equal(confirmLedgerOpening(saved, request, actor, now).existing, true);
  assert.throws(() => confirmLedgerOpening(saved, { ...request, operation_id: id(7), expected_revision: 1 }, actor, now), error => error.status === 409);
});
test('before-cutoff and future payments, invalid methods and caller-supplied deltas are rejected', () => {
  for (const changes of [{ date: '2026-10-22' }, { date: '2026-10-25' }, { method: '' }, { method: 'UNKNOWN' }, { description: ' ' }, { delta_minor: '-1' }, { currency: 'EUR' }, { type: 'opening' }, { expected_revision: 1 }]) assert.throws(() => ledgerMovement(account(), movement(changes), actor, now));
  assert.doesNotThrow(() => ledgerMovement(account(), movement({ method: 'Mail Order', description: 'Synthetic\nsecond line' }), actor, now));
});
test('lost-response retry is idempotent even after version changes, but reusing an ID for different money fails', () => {
  const a = account(), change = ledgerMovement(a, movement(), actor, now), saved = applied(a, change);
  const replay = ledgerMovement(saved, movement(), actor, now);
  assert.equal(replay.existing, true); assert.equal(replay.balance_minor, '2000025');
  assert.throws(() => ledgerMovement(saved, movement({ amount: '6000' }), actor, now), error => error.status === 409);
});
test('reversal adds an opposite entry, keeps the original and can run only once', () => {
  const a = account(), paid = applied(a, ledgerMovement(a, movement(), actor, now));
  const request = { operation_id: id(3), expected_revision: 1, reason: 'Synthetic correction' };
  const reversed = reverseLedgerMovement(paid, id(2), request, actor, now), saved = applied(paid, reversed);
  assert.equal(reversed.balance_minor, a.balance_minor); assert.equal(reversed.entry.reverses, id(2)); assert.equal(saved.entries.length, 3);
  assert.equal(reverseLedgerMovement(saved, id(2), request, actor, now).existing, true);
  assert.throws(() => reverseLedgerMovement(saved, id(2), { ...request, operation_id: id(4), expected_revision: 2 }, actor, now), error => error.status === 409);
  assert.throws(() => reverseLedgerMovement(saved, id(3), { ...request, operation_id: id(5), expected_revision: 2 }, actor, now));
  assert.equal(paid.entries[1].type, 'payment_sent'); assert.equal(paid.balance_minor, '2000025');
});
test('large balances stay exact and no public record exposes internal request hashes', () => {
  let a = account({ opening_amount: '9999999999.99' });
  for (let i = 2; i < 25; i++) a = applied(a, ledgerMovement(a, movement({ operation_id: id(i), expected_revision: a.revision, type: 'debt', method: '', amount: '9999999999.99' }), actor, now));
  assert.equal(a.balance_minor, (999999999999n * 24n).toString());
  const result = ledgerPublic(a, true);
  assert.equal(result.entries.length, 24); assert.equal(JSON.stringify(result).includes('fingerprint'), false); assert.equal(JSON.stringify(result).includes('create_operation'), false);
  assert.equal(Object.hasOwn(ledgerPublic(a), 'entries'), false);
});
test('Mongo ledger schema stores individual kuruş strings without floating-point conversion', () => {
  const doc = new LedgerAccount(account());
  assert.equal(doc.validateSync(), undefined); assert.equal(doc.balance_minor, '2500050');
  doc.entries[0].delta_minor = '0.1'; assert.ok(doc.validateSync());
});
test('ledger API atomically protects concurrent writes, duplicate retries and administrator-only access', async t => {
  const oldSecret = ENV.JWT_SECRET; ENV.JWT_SECRET = 'synthetic-ledger-route-secret'; t.after(() => { ENV.JWT_SECRET = oldSecret; });
  let role = 'Yönetici', stored = account(), barrier = null, firstReads = 0;
  t.mock.method(User, 'findById', () => ({ select: () => ({ populate: async () => ({ _id: actor._id, user_username: actor.name, user_role: { role_name: role } }) }) }));
  t.mock.method(Staff, 'findById', () => ({ lean: async () => ({ _id: actor._id, name: 'TEST_STAFF', active: true, session_version: 1, duties: ['cutting'] }) }));
  t.mock.method(LedgerAccount, 'findById', () => ({ lean: async () => { const snapshot = structuredClone(stored); if (barrier && ++firstReads <= 2) { if (firstReads === 2) barrier.resolve(); await barrier.promise; } return snapshot; } }));
  t.mock.method(LedgerAccount, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
    assert.equal(filter._id, stored._id); assert.equal(update.$inc.revision, 1);
    if (stored.revision !== filter.revision || stored.entries.some(e => e.operation_id === filter['entries.operation_id'].$ne)) return null;
    stored = { ...stored, balance_minor: update.$set.balance_minor, entries: [...stored.entries, update.$push.entries], revision: stored.revision + 1 };
    return structuredClone(stored);
  } }));
  const app = express(); app.use('/accounting', express.json(), router); const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const root = `http://127.0.0.1:${server.address().port}/accounting/accounts`, url = `${root}/${stored._id}/entries`;
  const token = jwt.sign({ id: actor._id }, ENV.JWT_SECRET), headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(root)).status, 401);
  const staffToken = jwt.sign({ id: actor._id, scope: 'production', aud: 'sahinsoy-production', version: 1 }, ENV.JWT_SECRET);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${staffToken}` }, body: JSON.stringify(movement()) })).status, 403);
  role = 'Satış Temsilcisi'; assert.equal((await fetch(`${root}/${stored._id}`, { headers })).status, 403); role = 'Yönetici';
  barrier = {}; barrier.promise = new Promise(resolve => { barrier.resolve = resolve; });
  const responses = await Promise.all([fetch(url, { method: 'POST', headers, body: JSON.stringify(movement()) }), fetch(url, { method: 'POST', headers, body: JSON.stringify(movement({ operation_id: id(7) })) })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(stored.entries.length, 2); assert.equal(stored.balance_minor, '2000025');
  barrier = null;
  const replayInput = stored.entries[1].operation_id === id(2) ? movement() : movement({ operation_id: id(7) });
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(replayInput) })).status, 200);
  assert.equal(stored.entries.length, 2); assert.equal(stored.revision, 1);
  const detail = await fetch(`${root}/${stored._id}`, { headers }); assert.equal(detail.status, 200); assert.match(detail.headers.get('Cache-Control'), /no-store/);
});
