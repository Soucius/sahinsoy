import test from 'node:test';
import assert from 'node:assert/strict';
import { newLedgerAccount, ledgerPublic, reverseLedgerMovement } from './accountLedger.js';
import { mailOrderLedgerPlan, mailOrderReversalPlan, mailOrderOperation } from './mailOrderLedger.js';
import LedgerAccount from '../models/LedgerAccount.js';

const now = new Date('2026-10-24T09:00:00Z');
const actor = { _id: '111111111111111111111111', name: 'TEST' };
const sale = { _id: '222222222222222222222222' };
const payment = { request_id: 'payment-test-001', amount: 14000, method: 'Mail Order', company: 'SYNTHETIC SUPPLIER', kind: 'Kapora', paid_date: '2026-10-24' };
const account = overrides => ({ _id: '333333333333333333333333', ...newLedgerAccount({ operation_id: '11111111-1111-4111-8111-111111111111', name: 'SYNTHETIC SUPPLIER', category: 'supplier', currency: 'TRY', opening_date: '2026-10-23', opening_amount: '100000', opening_direction: 'owe', ...overrides }, actor, now) });
const apply = (a, plan) => ({ ...a, revision: a.revision + 1, balance_minor: plan.balance_minor, entries: [...a.entries, plan.entry] });

test('14,000 TL mail order is a credit movement: 100,000 debt becomes 86,000 with source links', () => {
  const a = account(), plan = mailOrderLedgerPlan(a, sale, payment, actor, now), saved = apply(a, plan);
  assert.equal(plan.balance_minor, '8600000'); assert.equal(plan.entry.delta_minor, '-1400000');
  assert.equal(plan.entry.type, 'mail_order'); assert.equal(plan.entry.method, 'Mail Order');
  assert.equal(plan.entry.source_sale_id, sale._id); assert.equal(plan.entry.source_payment_id, payment.request_id);
  assert.equal(new LedgerAccount(saved).validateSync(), undefined);
  assert.equal(ledgerPublic(saved, true).entries[1].source_sale_id, sale._id);
  assert.equal(a.balance_minor, '10000000');
});
test('retries never deduct twice, altered amounts fail, and different payments have different postings', () => {
  const a = account(), saved = apply(a, mailOrderLedgerPlan(a, sale, payment, actor, now));
  assert.equal(mailOrderLedgerPlan(saved, sale, payment, actor, now).existing, true);
  assert.throws(() => mailOrderLedgerPlan(saved, sale, { ...payment, amount: 14001 }, actor, now), /farklı/);
  assert.notEqual(mailOrderOperation(sale._id, payment.request_id), mailOrderOperation(sale._id, 'another-payment'));
  assert.notEqual(mailOrderOperation(sale._id, payment.request_id), mailOrderOperation(actor._id, payment.request_id));
  assert.equal(mailOrderLedgerPlan(saved, sale, { ...payment, request_id: 'another-payment' }, actor, now).balance_minor, '7200000');
});
test('exact kuruş, debt clearance and advances become a negative receivable balance', () => {
  assert.equal(mailOrderLedgerPlan(account({ opening_amount: '14000' }), sale, payment, actor, now).balance_minor, '0');
  assert.equal(mailOrderLedgerPlan(account({ opening_amount: '10000' }), sale, payment, actor, now).balance_minor, '-400000');
  assert.equal(mailOrderLedgerPlan(account({ opening_amount: '10000,01' }), sale, { ...payment, amount: .01 }, actor, now).balance_minor, '1000000');
});
test('unknown opening, wrong currency/category, pre-opening and future dates block the posting', () => {
  for (const a of [account({ opening_known: false, opening_amount: '' }), account({ currency: 'EUR' }), account({ category: 'personal' })]) assert.throws(() => mailOrderLedgerPlan(a, sale, payment, actor, now));
  for (const paid_date of ['2026-10-22', '2026-10-25']) assert.throws(() => mailOrderLedgerPlan(account(), sale, { ...payment, paid_date }, actor, now));
});
test('only correcting the linked POS payment reverses the credit, with an idempotent audit entry', () => {
  const a = account(), posted = apply(a, mailOrderLedgerPlan(a, sale, payment, actor, now));
  assert.throws(() => reverseLedgerMovement(posted, posted.entries[1].operation_id, { operation_id: '99999999-1111-4111-8111-111111111111', expected_revision: 1, reason: 'Wrong amount' }, actor, now), /POS tahsilatına/);
  const plan = mailOrderReversalPlan(posted, sale, payment, 'Wrong payment', actor, now), corrected = apply(posted, plan);
  assert.equal(corrected.balance_minor, a.balance_minor); assert.equal(corrected.entries.length, 3);
  assert.equal(plan.entry.delta_minor, '1400000'); assert.equal(plan.entry.source_payment_id, payment.request_id);
  assert.equal(mailOrderReversalPlan(corrected, sale, payment, 'Wrong payment', actor, now).existing, true);
  assert.throws(() => mailOrderReversalPlan(posted, sale, { ...payment, request_id: 'missing' }, 'Wrong payment', actor, now), /bulunamadı/);
});
