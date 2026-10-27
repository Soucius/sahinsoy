import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHaremLedgerRateEvent, haremLedgerRateService } from './haremExchangeRates.js';
import { getLedgerValuationRates } from '../controllers/goldRate.controller.js';
import { ledgerValuation } from '../../../frontend/src/libs/goldLedger.js';

const now = Date.parse('2026-10-27T15:00:00Z');
const quote = (code, buying, selling, date = '27-10-2026 18:00:00') => ({ code, alis: String(buying), satis: String(selling), tarih: date });
const rates = () => ({ source: 'Harem', rate_type: 'Selling', rates: { USD: 50.25, EUR: 57.12, GOLD_GRAM: 6500.15, GOLD_QUARTER_OLD: 10450 }, rate_times: Object.fromEntries(['USD', 'EUR', 'GOLD_GRAM', 'GOLD_QUARTER_OLD'].map(code => [code, new Date(now).toISOString()])) });
const account = (currency, amount, other = {}) => ({ currency, balance_minor: amount, opening_status: 'confirmed', ...other });

test('ledger quotes use selling for USD/EUR and gold independently, without changing payment buying rates', () => {
  const fx = parseHaremLedgerRateEvent({ data: { USDTRY: quote('USDTRY', 50, 50.25), EURTRY: quote('EURTRY', 57, 57.12) } }, { now });
  assert.deepEqual(fx.rates, { USD: 50.25, EUR: 57.12 });
  const gold = parseHaremLedgerRateEvent({ data: { KULCEALTIN: quote('KULCEALTIN', 6450, 6500.15) } }, { now });
  assert.equal(gold.rates.GOLD_GRAM, 6500.15); assert.equal(gold.rates.USD, undefined);
  assert.throws(() => parseHaremLedgerRateEvent({ data: {} }, { now }));
});

test('missing, incorrect, old and future currencies never get a substituted or zero quote', () => {
  const data = { USDTRY: quote('USDTRY', 50, 50.25, '27-10-2026 17:54:59'), EURTRY: quote('USDTRY', 57, 57.12), KULCEALTIN: quote('KULCEALTIN', 6450, 6500) };
  const result = parseHaremLedgerRateEvent({ data }, { now });
  assert.equal(result.rates.USD, undefined); assert.equal(result.rates.EUR, undefined); assert.equal(result.rates.GOLD_GRAM, 6500);
  for (const q of [quote('USDTRY', 50, 49), quote('USDTRY', 50, 50.25, '27-10-2026 18:02:01'), quote('USDTRY', 50, 'NaN')]) assert.throws(() => parseHaremLedgerRateEvent({ data: { USDTRY: q } }, { now }));
});

test('one gross TL debt includes TRY + USD + gold once and retains an auditable breakdown', () => {
  const accounts = [account('TRY', '100000'), account('USD', '20000'), account('GOLD_GRAM', '150'), account('GOLD_QUARTER_OLD', '200')];
  const original = structuredClone(accounts), summary = ledgerValuation(accounts, rates(), now);
  assert.equal(summary.debt.complete, true);
  assert.equal(summary.debt.total_minor, '4170023'); // 1000 + 10050 + 9750.23 + 20900 TL
  assert.equal(summary.debt.parts.length, 4); assert.equal(summary.receivable.total_minor, '0');
  assert.deepEqual(accounts, original);
});

test('different people with debt and receivable never cancel each other out in the total', () => {
  const result = ledgerValuation([account('USD', '10000'), account('USD', '-4000'), account('TRY', '-50000'), account('EUR', '0'), account('TRY', null, { opening_status: 'pending' })], rates(), now);
  assert.equal(result.debt.total_minor, '502500'); assert.equal(result.receivable.total_minor, '251000');
  assert.equal(result.pending_count, 1); assert.equal(result.receivable.parts.length, 2);
});

test('unavailable or stale rates label the total incomplete while retaining the computed TL portion', () => {
  const accounts = [account('TRY', '12345'), account('USD', '100'), account('GOLD_GRAM', '200')];
  for (const data of [null, { ...rates(), rate_type: 'Buying' }, { ...rates(), rate_times: {} }]) {
    const result = ledgerValuation(accounts, data, now);
    assert.equal(result.debt.complete, false); assert.equal(result.debt.total_minor, '12345');
    assert.equal(result.debt.parts.filter(part => part.try_minor === null).length, 2);
  }
  const stale = ledgerValuation(accounts, rates(), now + 300001);
  assert.equal(stale.debt.complete, false); assert.equal(stale.debt.total_minor, '12345');
  const unsupported = ledgerValuation([account('GBP', '100')], rates(), now);
  assert.equal(unsupported.debt.complete, false); assert.equal(unsupported.debt.parts[0].try_minor, null);
});

test('revaluation changes only the displayed sum, including exact kuruş on aggregated currency amounts', () => {
  const accounts = [account('USD', '1'), account('USD', '1')], before = structuredClone(accounts);
  assert.equal(ledgerValuation(accounts, rates(), now).debt.total_minor, '101');
  const changed = rates(); changed.rates.USD = 60;
  assert.equal(ledgerValuation(accounts, changed, now).debt.total_minor, '120');
  assert.deepEqual(accounts, before);
  assert.equal(ledgerValuation([], null, now).debt.complete, true);
});

test('valuation endpoint returns explicit provider failure without inventing a total or revealing errors', async t => {
  t.mock.method(haremLedgerRateService, 'getRates', async () => { throw new Error('synthetic private error'); });
  const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(data) { this.body = data; return this; } };
  await getLedgerValuationRates({}, res);
  assert.equal(res.code, 503); assert.match(res.headers['Cache-Control'], /no-store/);
  assert.equal(res.body.rates, undefined); assert.equal(JSON.stringify(res.body).includes('private error'), false);
});
