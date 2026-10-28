import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { ENV } from './env.js';
import { CashOffice, OfficeEntry } from './cashPersonnel.js';
import { orderProfitRouter, OrderProfit } from './orderProfit.js';
import { profitLines, profitSource, automaticSewing, normalizeProfit, calculateProfit, scaledAmount } from './orderProfitRules.js';
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa', lineId = 'bbbbbbbbbbbbbbbbbbbbbbbb', product = 'cccccccccccccccccccccccc';
const sale = () => ({ _id: id, sale_items: [{ _id: lineId, product, quantity: 6.4, width: 200, height: 260 }], pos_details: { cart: [{ product_id: product, product_name: 'Tül', brand_name: 'Lilium', quantity: 6.4, mode: 'textile', unit_label: 'm', accessories: [] }] }, sub_total: 22000, discount_amount: 2000, grand_total: 20000, delivery_method: 'montaj' });
const products = [{ _id: product, purchase_price: 100, currency: 'TRY' }];
const input = (lines, extra = {}) => ({ operation_id: 'dd5fd81d-c61f-4548-813c-7692617e4b05', expected_revision: 0, view_token: 'd'.repeat(64), lines: lines.map(row => ({ id: row.id, unit_cost: '100', extra_cost: '0' })), labor_mode: 'manual', labor_amount: '320', installation_amount: '500', other_amount: '0', estimate: true, note: '', ...extra });
function result(s, changes = {}, productRows = products) { const lines = profitLines(s, productRows), costs = normalizeProfit(input(lines, changes), lines); return calculateProfit(s, lines, { source: profitSource(s), costs }, automaticSewing(s, lines)); }
test('uses discounted order revenue once, not deposits; fabric includes seam allowance', () => {
  const s = sale(); s.payments = [{ amount: 7000 }]; const r = result(s);
  assert.equal(r.revenue_minor, '2000000'); assert.equal(r.fabric_minor, '64000'); assert.equal(r.profit_minor, '1854000'); assert.equal(r.margin_percent, 92.7); assert.equal(r.brands[0].name, 'Lilium'); assert.equal(r.brands[0].known_minor, '64000');
});
test('VAT-inclusive 1000 purchase / 2500 sale leaves 1500; no VAT added again', () => {
  const s = sale(); s.sale_items[0].quantity = 1; s.pos_details.cart[0].quantity = 1; s.grand_total = 2500;
  const r = result(s, { lines: [{ id: lineId, unit_cost: '1000', extra_cost: '0' }], labor_amount: '0', installation_amount: '0' }); assert.equal(r.profit_minor, '150000');
});
test('partial costs never become exact profit; explicit zero differs from unknown', () => {
  const s = sale(), r = result(s, { labor_amount: '', installation_amount: '', other_amount: '' });
  assert.equal(r.complete, false); assert.equal(r.profit_minor, null); assert.ok(r.missing.includes('Montaj')); assert.equal(result(s, { labor_amount: '0', installation_amount: '0' }).complete, true);
});
test('retains loss and zero revenue without divide-by-zero', () => { const s = sale(); s.grand_total = 0; const r = result(s); assert.equal(r.profit_minor, '-146000'); assert.equal(r.margin_percent, null); });
test('unit cost and quantity use four decimals then round once to cents', () => { const s = sale(); s.sale_items[0].quantity = 1.2345; s.pos_details.cart[0].quantity = 1.2345; assert.equal(result(s, { lines: [{ id: lineId, unit_cost: '12,3456', extra_cost: '0' }] }).fabric_minor, '1524'); });
test('catalog zero is unknown, foreign purchase without matching saved rate is unknown', () => {
  const s = sale(); assert.equal(profitLines(s, [{ ...products[0], purchase_price: 0 }])[0].suggestion_units, null);
  assert.equal(profitLines(s, [{ ...products[0], currency: 'USD' }])[0].suggestion_units, null);
  s.pos_details.cart[0].original_currency = 'USD'; s.pos_details.cart[0].currency_rate = 40; assert.equal(profitLines(s, [{ ...products[0], currency: 'USD' }])[0].suggestion_units, '40000000');
});
test('rustic size ladder never uses another size purchase suggestion', () => { const s = sale(); s.pos_details.cart[0].rustic_pricing = { list_width_cm: 200 }; assert.equal(profitLines(s, products)[0].suggestion_units, null); });
test('saved purchase costs stay frozen when catalog price changes', () => {
  const s = sale(), lines = profitLines(s, products), costs = normalizeProfit(input(lines), lines), sheet = { source: profitSource(s), costs };
  const changed = profitLines(s, [{ ...products[0], purchase_price: 900 }]); assert.equal(calculateProfit(s, changed, sheet, automaticSewing(s, changed)).fabric_minor, '64000');
});
test('quantity or discount changes invalidate saved profit; payment changes do not', () => {
  const s = sale(), source = profitSource(s), lines = profitLines(s, products), sheet = { source, costs: normalizeProfit(input(lines), lines) };
  s.payments = [{ amount: 20000 }]; assert.equal(profitSource(s), source);
  s.sale_items[0].quantity = 7; assert.equal(calculateProfit(s, profitLines(s, products), sheet, automaticSewing(s, lines)).profit_minor, null);
});
const journal = () => ({ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', type: 'sewing', person_delta_minor: '32000', sewing: { sale_id: id, line_id: lineId, meter_units: 64000 } });
test('automatic labor takes earned sewing once, excludes salary, advances and payouts', () => {
  const s = sale(), lines = profitLines(s, products), entries = [journal(), { ...journal(), type: 'payout', person_delta_minor: '-32000' }, { ...journal(), type: 'salary', person_delta_minor: '3000000' }];
  assert.equal(automaticSewing(s, lines, entries).amount_minor, '32000');
  const costs = normalizeProfit(input(lines, { labor_mode: 'auto', labor_amount: '' }), lines); assert.equal(calculateProfit(s, lines, { source: profitSource(s), costs }, automaticSewing(s, lines, entries)).labor_minor, '32000');
});
test('reversed or stale-meter sewing does not claim complete labor', () => {
  const s = sale(), lines = profitLines(s, products), entry = journal();
  assert.equal(automaticSewing(s, lines, [entry, { ...entry, _id: 'ffffffffffffffffffffffff', type: 'reversal', reversed_type: 'sewing', person_delta_minor: '-32000' }]).complete, false);
  entry.sewing.meter_units = 60000; assert.equal(automaticSewing(s, lines, [entry]).amount_minor, null);
  assert.equal(automaticSewing(s, lines, [journal()], true).complete, false);
});
test('mechanical motor lines are separate costs and do not create sewing expense', () => {
  const s = sale(); s.pos_details.cart[0].mode = 'mechanical'; const lines = profitLines(s, products); assert.equal(automaticSewing(s, lines).amount_minor, '0');
  s.pos_details.cart[0].accessories = [{ name: 'Kasa', total: 5000 }]; const r = result(s, { lines: [{ id: lineId, unit_cost: '100', extra_cost: '' }] }); assert.equal(r.complete, false); assert.equal(r.extras_minor, '0');
});
test('rejects duplicate/forged lines, negative/locale ambiguity, silent fractional cents and dual labor', () => {
  const lines = profitLines(sale(), products);
  for (const amount of ['-1', '1.000,50', 'NaN', '1e5', '1.001', undefined]) assert.throws(() => scaledAmount(amount));
  assert.throws(() => normalizeProfit(input(lines, { lines: [{ id: 'forged', unit_cost: '100', extra_cost: '0' }] }), lines));
  assert.throws(() => normalizeProfit(input(lines, { labor_mode: 'auto', labor_amount: '200' }), lines));
  assert.throws(() => normalizeProfit({ ...input(lines), grand_total: 1 }, lines));
});
async function httpProfit(t) {
  const db = { sale: { ...sale(), status: 'tamamlandi' }, sheet: null }, previous = ENV.JWT_SECRET; ENV.JWT_SECRET = 'SYNTHETIC_PROFIT_SECRET'; t.after(() => { ENV.JWT_SECRET = previous; });
  const query = fn => { const q = { select: () => q, populate: () => q, session: () => q, sort: () => q, limit: () => q, lean: async () => structuredClone(fn()) }; return q; };
  t.mock.method(User, 'findById', value => ({ select: () => ({ populate: async () => ({ _id: value, user_username: 'SYNTHETIC_ADMIN', user_role: { role_name: value === id ? 'Admin' : 'Satış Temsilcisi' } }) }) }));
  t.mock.method(Sale, 'findById', () => query(() => db.sale));
  t.mock.method(Sale, 'findOneAndUpdate', (_filter, update, options) => { assert.deepEqual(update, { $inc: { production_guard: 1 } }); assert.equal(options.timestamps, false); return query(() => db.sale); });
  t.mock.method(Product, 'find', () => query(() => products));
  t.mock.method(CashOffice, 'findOneAndUpdate', () => query(() => null));
  t.mock.method(OfficeEntry, 'find', () => query(() => []));
  t.mock.method(OrderProfit, 'init', async () => {});
  t.mock.method(OrderProfit, 'findOne', () => query(() => db.sheet));
  t.mock.method(OrderProfit, 'create', async rows => { db.sheet = { ...structuredClone(rows[0]), _id: product }; return [db.sheet]; });
  t.mock.method(OrderProfit, 'updateOne', async (_filter, update) => { Object.assign(db.sheet, update.$set); db.sheet.revision++; db.sheet.history.push(update.$push.history); });
  t.mock.method(mongoose.connection, 'transaction', async callback => { const old = structuredClone(db); try { return await callback({}); } catch (e) { Object.assign(db, old); throw e; } });
  const app = express(); app.use(express.json()); app.use('/profit', orderProfitRouter); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const admin = jwt.sign({ id }, ENV.JWT_SECRET);
  return { db, call: async (body, auth = admin) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/profit/${id}`, { method: body ? 'POST' : 'GET', headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; } };
}
test('profit API blocks staff, sales representative and anonymous reads/writes', async t => {
  const app = await httpProfit(t);
  assert.equal((await app.call(null, '')).status, 401);
  for (const token of [jwt.sign({ id: product }, ENV.JWT_SECRET), jwt.sign({ id: product, scope: 'production', aud: 'sahinsoy-production' }, ENV.JWT_SECRET)]) {
    assert.equal((await app.call(null, token)).status, 403); assert.equal((await app.call({}, token)).status, 403);
  }
  assert.equal(app.db.sheet, null);
});
test('profit save is idempotent and rejects stale edits without touching order or finance', async t => {
  const app = await httpProfit(t), before = structuredClone(app.db.sale), view = await app.call(); assert.equal(view.status, 200);
  const payload = { ...input(view.data.lines), view_token: view.data.view_token };
  assert.equal((await app.call(payload)).status, 200); assert.equal((await app.call(payload)).status, 200); assert.equal(app.db.sheet.history.length, 1);
  assert.equal((await app.call({ ...payload, note: 'DIFFERENT' })).status, 409);
  assert.equal((await app.call({ ...payload, operation_id: 'dd5fd81d-c61f-4548-813c-7692617e4b06' })).status, 409);
  const next = await app.call(); assert.equal(next.data.summary.profit_minor, '1854000');
  assert.deepEqual(app.db.sale, before);
  app.db.sale.grand_total = 19000; assert.equal((await app.call()).data.summary.stale, true);
});
