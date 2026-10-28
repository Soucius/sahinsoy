import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import Sale from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';
import { VisitPlan, visitCards } from './visitPlanning.js';
import { fingerprint, productionLines, visibleOrder } from './productionWorkflow.js';
import { lineAttention, orderAttention, variantEdit } from './orderAttentionRules.js';
import { getOrderAttention, saveOrderVariant, OrderVariantEdit } from './orderAttention.js';
const ids = { sale: '100000000000000000000001', line: '200000000000000000000001', product: '300000000000000000000001', staff: '400000000000000000000001' };
function sale() { return { _id: ids.sale, status: 'tamamlandi', measurement_status: 'preliminary', measurement_revision: 0, customer_name: 'SYNTHETIC', grand_total: 14000, payments: [{ amount: 7000 }], sale_items: [{ _id: ids.line, product: { _id: ids.product, product_name: 'Tül', product_color: 'Belirtilmedi', variants: [] }, quantity: 6.4, width: 200, height: 260, unit_price: 500, total_price: 3200 }], pos_details: { cart: [{ id: 'source', product_id: ids.product, product_name: 'Tül', category_name: 'Tül', mode: 'textile', quantity: 6.4, width: 200, height: 260, unit_price: 500, item_total: 3200, variant: '', accessories: [], panels: [], item_note: 'MÜŞTERİ NOTU' }] } }; }
const record = s => ({ _id: ids.product, sale: s._id, source_fingerprint: fingerprint(s), jobs: productionLines(s).map(line => ({ ...line, supply: 'received', stage: 'waiting', sewing: ids.staff })), revision: 0, history: [] });
const actor = { kind: 'admin', _id: ids.staff, name: 'SYNTHETIC_ADMIN' };
const input = s => ({ request_id: '11111111-2222-4333-8444-555555555555', expected_fingerprint: fingerprint(s), line_id: ids.line, variant: 'V1 · Ekru', panel_variants: [] });
test('unconfirmed measurements need a day; overdue and planned days remain visible until confirmed', () => {
  const s = sale(); assert.ok(orderAttention(s, null, false, '2026-10-28').some(row => row.code === 'measurement_undated'));
  s.measurement_date = '2026-10-27'; assert.ok(orderAttention(s, null, false, '2026-10-28').some(row => row.code === 'measurement_overdue'));
  s.measurement_date = '2026-10-29'; assert.ok(orderAttention(s, null, false, '2026-10-28').some(row => row.code === 'measurement_pending'));
  s.measurement_status = 'confirmed'; assert.ok(!orderAttention(s, null, false).some(row => row.kind === 'measurement'));
});
test('color is required for textiles and variant products but fixed-color products and motor components are exempt', () => {
  const s = sale(); assert.ok(lineAttention(s, s.sale_items[0], 0, null).some(row => row.code === 'variant'));
  s.sale_items[0].product.product_color = 'Beyaz'; assert.ok(!lineAttention(s, s.sale_items[0], 0, null).some(row => row.kind === 'color'));
  s.sale_items[0].product.variants = [{ vr: 'V1', color: 'Beyaz' }]; assert.ok(lineAttention(s, s.sale_items[0], 0, null).some(row => row.kind === 'color'));
  s.pos_details.cart[0].motor_system = { role: 'motor' }; assert.ok(!lineAttention(s, s.sale_items[0], 0, null).some(row => row.kind === 'color'));
});
test('per-panel VR selections take priority; a single missing panel is named, common selection fills the group', () => {
  const s = sale(), line = s.pos_details.cart[0]; line.mechanical_panels = [{ position: 'Sol kasa', variant: 'V1' }, { position: 'Sağ kasa', variant: '' }];
  const missing = lineAttention(s, s.sale_items[0], 0, null).find(row => row.kind === 'color'); assert.match(missing.label, /Sağ kasa/); assert.ok(!missing.label.includes('Sol kasa'));
  line.variant = 'V2 · Krem'; assert.ok(!lineAttention(s, s.sale_items[0], 0, null).some(row => row.kind === 'color'));
});
test('material states stay distinct, drafts do not claim supplies due, stale production is unknown', () => {
  const s = sale(), r = record(s), job = r.jobs[0];
  for (const state of ['awaiting_order', 'ordered', 'in_transit']) { job.supply = state; assert.ok(orderAttention(s, r, true).some(row => row.code === state)); }
  job.supply = 'received'; assert.ok(!orderAttention(s, r, true).some(row => row.kind === 'material'));
  assert.ok(orderAttention(s, r, false).some(row => row.code === 'supply_unknown'));
  s.status = 'beklemede'; assert.ok(!orderAttention(s, null, false).some(row => row.kind === 'material'));
  for (const state of ['iptal', 'teslim_edildi', 'kaybedildi']) { s.status = state; assert.deepEqual(orderAttention(s, r, true), []); }
});
test('staff get warnings for their assigned jobs only and never other lines or financial data', () => {
  const s = sale(), other = structuredClone(s.sale_items[0]); other._id = '200000000000000000000002'; s.sale_items.push(other); s.pos_details.cart.push({ ...s.pos_details.cart[0], product_name: 'PRIVATE_OTHER_LINE' });
  const r = record(s); r.jobs[1].sewing = ids.product;
  const dto = visibleOrder(r, s, { kind: 'staff', _id: ids.staff, duties: ['sewing'] }), text = JSON.stringify(dto);
  assert.equal(dto.jobs.length, 1); assert.ok(dto.jobs[0].warnings.some(row => row.kind === 'measurement')); assert.ok(!text.includes('PRIVATE_OTHER_LINE')); assert.ok(!text.includes('unit_price')); assert.ok(!text.includes('payments'));
});
test('color editing changes only descriptions and preserves every price, quantity and dimension', () => {
  const s = sale(), old = structuredClone(s.pos_details.cart[0]), edit = variantEdit(s, input(s)); assert.equal(edit.next.variant, 'V1 · Ekru'); const { variant, ...rest } = edit.next; const { variant: oldVariant, ...before } = old; assert.deepEqual(rest, before); assert.equal(oldVariant, ''); assert.equal(variant, 'V1 · Ekru');
  s.pos_details.cart[0].mechanical_panels = [{ label: 'Sol', width: 80, height: 200, variant: '' }, { label: 'Sağ', width: 120, height: 250, variant: '' }];
  const pair = variantEdit(s, { ...input(s), panel_variants: ['', 'V2'] }); assert.equal(pair.next.mechanical_panels[0].variant, 'V1 · Ekru'); assert.equal(pair.next.mechanical_panels[1].variant, 'V2'); assert.equal(pair.next.mechanical_panels[1].height, 250);
});
test('color editing rejects price injection, stale line IDs, closed orders, missing colors and panel mismatch', () => {
  const s = sale(); for (const patch of [{ grand_total: 1 }, { variant: '' }, { line_id: ids.staff }, { panel_variants: ['X'] }, { variant: 'x'.repeat(151) }]) assert.throws(() => variantEdit(s, { ...input(s), ...patch }));
  s.status = 'teslim_edildi'; assert.throws(() => variantEdit(s, input(s)));
});
const query = fn => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, session() { return this; }, lean: async () => structuredClone(fn()), then(resolve, reject) { return Promise.resolve().then(fn).then(resolve, reject); } });
const response = () => ({ code: 200, body: null, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('attention reads are admin-only, perform no writes and do not expose price/payment fields', async t => {
  const s = sale(), r = record(s); t.mock.method(Sale, 'find', () => query(() => [s])); t.mock.method(ProductionOrder, 'find', () => query(() => [r])); t.mock.method(VisitPlan, 'find', () => query(() => [])); t.mock.method(Staff, 'find', () => query(() => []));
  t.mock.method(Sale, 'updateOne', () => { throw new Error('GET MUST NOT WRITE'); });
  const blocked = response(); await getOrderAttention({ productionActor: { kind: 'staff' }, query: {} }, blocked); assert.equal(blocked.code, 403);
  const res = response(); await getOrderAttention({ productionActor: actor, query: {} }, res); assert.equal(res.code, 200); assert.equal(res.body.orders.length, 1); const json = JSON.stringify(res.body); assert.ok(!json.includes('grand_total')); assert.ok(!json.includes('unit_price')); assert.ok(!json.includes('payments')); assert.ok(res.body.orders[0].visit);
});
test('color save retries once, records history and keeps financial/stock fields out of updates', async t => {
  const s = sale(), db = { edits: [], writes: [] }, before = structuredClone(s);
  t.mock.method(OrderVariantEdit, 'init', async () => {}); t.mock.method(OrderVariantEdit, 'findOne', filter => query(() => db.edits.find(row => row.request_id === filter.request_id))); t.mock.method(OrderVariantEdit, 'countDocuments', () => query(() => db.edits.length)); t.mock.method(OrderVariantEdit, 'create', async rows => { db.edits.push(...structuredClone(rows)); });
  t.mock.method(Sale, 'findOneAndUpdate', (_filter, update, options) => { assert.deepEqual(update, { $inc: { production_guard: 1 } }); assert.equal(options.timestamps, false); return query(() => s); });
  t.mock.method(Sale, 'updateOne', async (_filter, update, options) => { db.writes.push(update); assert.equal(options.timestamps, false); return { modifiedCount: 1 }; });
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  const req = { productionActor: actor, params: { saleId: ids.sale }, body: input(s) };
  for (let i = 0; i < 2; i++) { const res = response(); await saveOrderVariant(req, res); assert.equal(res.code, 200); }
  assert.equal(db.edits.length, 1); assert.equal(db.writes.length, 1); assert.deepEqual(Object.keys(db.writes[0].$set).sort(), ['pos_details.cart.0.variant', 'sale_items.0.item_note']); assert.ok(db.writes[0].$set['sale_items.0.item_note'].includes('MÜŞTERİ NOTU')); assert.deepEqual(s, before);
  const bad = response(); await saveOrderVariant({ ...req, body: { ...req.body, variant: 'V2' } }, bad); assert.equal(bad.code, 400); assert.equal(db.edits.length, 1);
});
test('all attention routes are guarded and measurement days reuse the existing audited planner', async () => {
  const route = await readFile(new URL('../routes/production.route.js', import.meta.url), 'utf8'); assert.ok(route.includes("router.get('/attention', productionAdminOnly, getOrderAttention)")); assert.ok(route.includes("router.post('/attention/:saleId/variant', productionAdminOnly, saveOrderVariant)"));
  const s = sale(), cards = visitCards([s], [], [], actor); assert.equal(cards.find(row => row.kind === 'measurement').date, '');
});
