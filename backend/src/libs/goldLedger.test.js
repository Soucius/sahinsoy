import test from 'node:test';
import assert from 'node:assert/strict';
import { GOLD_UNITS } from './goldUnits.js';
import { newLedgerAccount, ledgerMovement, reverseLedgerMovement, confirmLedgerOpening } from './accountLedger.js';
import { createHaremExchangeRateService, parseHaremGoldRateEvent, haremGoldRateService } from './haremExchangeRates.js';
import { getGoldRates } from '../controllers/goldRate.controller.js';
import LedgerAccount from '../models/LedgerAccount.js';
import { GOLD_UNITS as UI_UNITS, freshGoldQuote, goldTryMinor, goldQuantity } from '../../../frontend/src/libs/goldLedger.js';

const now = new Date('2026-10-27T12:00:00Z'), actor = { _id: '012345678901234567890123', name: 'Synthetic' };
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const opening = changes => ({ operation_id: id(1), name: 'Synthetic gold debt', category: 'personal', currency: 'GOLD_GRAM', opening_known: true, opening_date: '2026-10-27', opening_amount: '12.35', opening_direction: 'owe', description: 'Synthetic opening', ...changes });
const change = changes => ({ operation_id: id(2), expected_revision: 0, type: 'payment_sent', date: '2026-10-27', amount: '2.35', method: 'Altın teslimi', description: 'Synthetic gold repayment', ...changes });
const applied = (a, c) => ({ ...a, balance_minor: c.balance_minor, entries: [...a.entries, c.entry], revision: a.revision + 1 });
const fixture = () => ({ data: Object.fromEntries(Object.values(GOLD_UNITS).map(({ provider_code: code }, i) => [code, { code, alis: String(6000 + i), satis: String(6500 + i), tarih: '27-10-2026 15:00:00' }])) });

test('physical units are identical across the UI and ledger, independent of TRY and old/new types', () => {
  assert.deepEqual(GOLD_UNITS, UI_UNITS);
  const a = newLedgerAccount(opening(), actor, now);
  assert.equal(a.balance_minor, '1235');
  assert.equal(new LedgerAccount(a).validateSync(), undefined);
  const quarter = newLedgerAccount(opening({ currency: 'GOLD_QUARTER_OLD', opening_amount: '3' }), actor, now);
  assert.equal(quarter.balance_minor, '300'); assert.equal(new LedgerAccount(quarter).validateSync(), undefined);
  assert.match(goldQuantity('300', quarter.currency), /3 adet Çeyrek altın · eski/);
  assert.match(goldQuantity('1235', a.currency), /12,35 gram/);
  for (const currency of ['GOLD_UNKNOWN', 'XAU']) assert.throws(() => newLedgerAccount(opening({ currency }), actor, now));
});

test('fractional coin quantities are rejected for opening, deferred opening and movement', () => {
  assert.throws(() => newLedgerAccount(opening({ currency: 'GOLD_QUARTER_NEW', opening_amount: '1.5' }), actor, now));
  const pending = newLedgerAccount(opening({ currency: 'GOLD_FULL_OLD', opening_known: false, opening_amount: '' }), actor, now);
  assert.throws(() => confirmLedgerOpening(pending, { operation_id: id(3), expected_revision: 0, opening_date: '2026-10-27', opening_amount: '1.01', opening_direction: 'owe' }, actor, now));
  const coin = newLedgerAccount(opening({ currency: 'GOLD_HALF_NEW', opening_amount: '2' }), actor, now);
  assert.throws(() => ledgerMovement(coin, change({ amount: '0.5' }), actor, now));
  assert.throws(() => ledgerMovement(coin, change({ amount: '1', method: 'Mail Order' }), actor, now));
});

test('gold repayment and reversal retain physical quantity, exact signed balances and idempotent retries', () => {
  const a = newLedgerAccount(opening(), actor, now), c = ledgerMovement(a, change(), actor, now), saved = applied(a, c);
  assert.equal(saved.balance_minor, '1000'); assert.equal(a.balance_minor, '1235');
  assert.equal(ledgerMovement(saved, change(), actor, now).existing, true);
  const undo = reverseLedgerMovement(saved, id(2), { operation_id: id(3), expected_revision: 1, reason: 'Synthetic correction' }, actor, now);
  assert.equal(undo.balance_minor, '1235');
  assert.throws(() => ledgerMovement(newLedgerAccount(opening({ currency: 'TRY' }), actor, now), change(), actor, now));
});

test('gold stream selects explicit selling quotes without requiring USD/EUR or substituting missing products', () => {
  const data = fixture(); data.data.CEYREK_ESKI.satis = '11000'; data.data.TEK_YENI.satis = '44000';
  const result = parseHaremGoldRateEvent(data, { now: +now });
  assert.equal(result.rates.GOLD_QUARTER_OLD, 11000); assert.equal(result.rates.GOLD_FULL_NEW, 44000);
  delete data.data.KULCEALTIN;
  data.data.CEYREK_YENI.code = 'TEK_YENI';
  data.data.YARIM_ESKI.satis = 'NaN';
  data.data.ATA_ESKI.tarih = '27-10-2026 14:54:59';
  const partial = parseHaremGoldRateEvent(data, { now: +now });
  for (const code of ['GOLD_GRAM', 'GOLD_QUARTER_NEW', 'GOLD_HALF_OLD', 'GOLD_ATA_OLD']) assert.equal(partial.rates[code], undefined);
  assert.equal(partial.rates.GOLD_FULL_NEW, 44000);
  assert.throws(() => parseHaremGoldRateEvent({ data: {} }, { now: +now }));
});

test('TL valuation is exact to kuruş, is refreshed without rewriting gold debt, and rejects stale or wrong-side data', () => {
  assert.equal(goldTryMinor('1235', 6500.12), '8027648');
  assert.equal(goldTryMinor('1', 0.5), '1');
  const a = newLedgerAccount(opening(), actor, now), before = structuredClone(a);
  assert.notEqual(goldTryMinor(a.balance_minor, 6500), goldTryMinor(a.balance_minor, 6600));
  assert.deepEqual(a, before);
  const data = { source: 'Harem', rate_type: 'Selling', ...parseHaremGoldRateEvent(fixture(), { now: +now }) };
  assert.ok(freshGoldQuote(data, 'GOLD_GRAM', +now));
  assert.equal(freshGoldQuote(data, 'GOLD_GRAM', +now + 300001), null);
  assert.equal(freshGoldQuote(data, 'GOLD_GRAM', +now - 120001), null);
  assert.equal(freshGoldQuote({ ...data, rate_type: 'Buying' }, 'GOLD_GRAM', +now), null);
  assert.equal(freshGoldQuote(data, 'GOLD_UNKNOWN', +now), null);
});

test('gold service retains selling identity with bounded caching and closes the public socket', async () => {
  let closed = 0, opened = 0;
  class Socket extends EventTarget {
    constructor() { super(); opened++; queueMicrotask(() => {
      for (const data of ['0{"sid":"test"}', '40{"sid":"test"}', `42${JSON.stringify(['price_changed', fixture()])}`]) this.dispatchEvent(new MessageEvent('message', { data }));
    }); }
    send(data) { assert.equal(data, '40'); }
    close() { closed++; }
  }
  const service = createHaremExchangeRateService({ WebSocketImpl: Socket, now: () => +now, parseQuote: parseHaremGoldRateEvent, rateType: 'Selling', maxAgeMs: 300000 });
  const first = await service.getRates(), second = await service.getRates();
  assert.equal(first.rate_type, 'Selling'); assert.equal(second.cached, true);
  assert.equal(opened, 1); assert.equal(closed, 1);
});

test('gold rate failure is explicit and never supplies zero, another currency or old quotations', async t => {
  t.mock.method(haremGoldRateService, 'getRates', async () => { throw new Error('synthetic provider failure'); });
  const response = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(data) { this.body = data; return this; } };
  await getGoldRates({}, response);
  assert.equal(response.statusCode, 503); assert.equal(response.body.rates, undefined);
  assert.match(response.headers['Cache-Control'], /no-store/);
});
