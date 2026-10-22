import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMeasurement, salePayload } from './curtainCalculation.js';
import { calculateMeasurementBatch } from './pliseBatch.js';
import { calculateDualPliseBatch } from './dualPlise.js';
import { discountedCart } from './discountPresentation.js';
import { createCustomerOrderHtml, customerPrintEntries, hasManufacturingItems } from './curtainPrint.js';

const product = { _id: 'summary-plise', product_name: 'Plise LANTANA Serisi 15mm', category_name: 'Plise', brand_name: 'OBA Perdesan', calculation_type: 'm2', sale_price: 1200, min_m2: 1, dimension_rounding_cm: 10, stock_tracking: false, extra_options: [] };
const common = { ...defaultMeasurement(product), room_name: 'Salon', variant: 'VR01 · Ekru', extra_indices: [] };
const lines = (count = 8) => calculateMeasurementBatch(product, common, Array.from({ length: count }, (_, i) => ({ width: String(60 + i), height: '100', count: '1', label: `Cam ${i + 1}`, variant: 'VR01 · Ekru' }))).lines;
const saved = (cart, discount = 0) => ({ _id: 'summary-order', ...salePayload(cart, { first_name: 'Örnek', last_name: 'Müşteri', customer_phone: '05000000000', delivery_method: 'store' }, discount, 'tamamlandi', 'summary-request') });
const bodyRows = html => html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];

test('matching case colors combine: four white and four anthracite print as two rows', () => {
  const p = { ...product, extra_options: ['Beyaz', 'Antrasit'].map(name => ({ option_name: `Kasa / Donanım Rengi: ${name}`, price_impact: 0, pricing_basis: 'adet', pricing_scope: 'kasa' })) };
  const batch = calculateMeasurementBatch(p, common, Array.from({ length: 8 }, (_, i) => ({ width: `${60 + i}`, height: '100', count: '1', label: `Cam ${i + 1}`, case_color: `Kasa / Donanım Rengi: ${i < 4 ? 'Beyaz' : 'Antrasit'}` })));
  const entries = customerPrintEntries(batch.lines);
  assert.equal(entries.length, 2); assert.deepEqual(entries.map(entry => entry.line.quantity), [4, 4]);
  const html = bodyRows(createCustomerOrderHtml(saved(batch.lines)));
  assert.equal((html.match(/<tr/g) || []).length, 2);
  assert.equal((html.match(/Kasa rengi: Beyaz/g) || []).length, 1);
  assert.equal((html.match(/Kasa rengi: Antrasit/g) || []).length, 1);
});

test('eight different glass measurements print as one 8 m² row at 1200 TL, preserving the saved order', () => {
  const cart = lines(); const before = JSON.stringify(cart);
  const entries = customerPrintEntries(cart);
  assert.equal(entries.length, 1); assert.equal(entries[0].members.length, 8);
  assert.equal(entries[0].line.quantity, 8); assert.equal(entries[0].line.pieces, 8);
  assert.equal(entries[0].line.base_unit_price, 1200); assert.equal(entries[0].line.item_total, 9600);
  const order = saved(cart); const savedBefore = JSON.stringify(order);
  const html = createCustomerOrderHtml(order), rows = bodyRows(html);
  assert.equal((rows.match(/<tr/g) || []).length, 1);
  assert.match(rows, /8,00 m²/); assert.match(rows, /1\.200,00/); assert.match(rows, /9\.600,00/);
  assert.match(rows, /Toplam 8 adet/); assert.match(rows, /VR01 · Ekru/);
  assert.equal(rows.includes('Cam 1'), false); assert.equal(rows.includes('Ölçü: 60,00'), false);
  assert.equal(JSON.stringify(cart), before); assert.equal(JSON.stringify(order), savedBefore);
  assert.equal(hasManufacturingItems(cart), false);
});

test('different products, colors, prices, case colors and notes stay separate', () => {
  const original = lines(2)[0];
  for (const change of [{ product_id: 'other' }, { variant: 'VR02 · Gri' }, { base_unit_price: 1300 }, { case_color: 'Antrasit' }, { item_note: 'Farklı montaj' }, { accessories: [{ name: 'Kasa rengi: Krem', unit: 'adet', quantity: 1, unit_price: 0, total: 0 }] }]) {
    assert.equal(customerPrintEntries([original, { ...original, ...change }]).length, 2, JSON.stringify(change));
  }
  const textile = { ...original, calc_type: 'mt', mode: 'textile', category_name: 'Tül' };
  assert.equal(customerPrintEntries([textile, { ...textile }]).length, 2);
  const motor = { ...original, motor_system: { role: 'curtain' } };
  assert.equal(customerPrintEntries([motor, { ...motor }]).length, 2);
});

test('discounted summary adds exact allocated cents without recomputing unit-price totals', () => {
  const cart = lines(9).map((line, i) => ({ ...line, item_total: 1200.01 + i / 100, material_total: 1200.01 + i / 100 }));
  const display = discountedCart(cart, 17.37), result = customerPrintEntries(display)[0].line;
  const expected = display.reduce((sum, line) => sum + Math.round(line.item_total * 100), 0) / 100;
  assert.equal(result.item_total, expected); assert.equal(result.material_total, expected);
  assert.equal(result.discount_display.original_unit_price, 1200);
  assert.equal(result.base_unit_price, display[0].base_unit_price);
  assert.match(createCustomerOrderHtml(saved(cart, 17.37)), /<del>/);
});

test('same-priced accessories add recorded quantities and amounts; percentage rates never add', () => {
  const cart = lines(2).map((line, i) => ({ ...line, accessories: [
    { name: 'Profil', unit: 'm', quantity: i ? 1.55 : 0.8, unit_price: 100, total: i ? 155 : 80 },
    { name: 'Sistem farkı', unit: '%', quantity: 10, unit_price: 1200, total: 120 },
  ] }));
  const result = customerPrintEntries(cart)[0].line;
  assert.equal(result.accessories[0].quantity, 2.35); assert.equal(result.accessories[0].total, 235);
  assert.equal(result.accessories[1].quantity, 10); assert.equal(result.accessories[1].total, 240);
});

test('matching plise across rooms keeps room names and escapes customer-supplied labels', () => {
  const cart = lines(2); cart[1].room_name = 'Balkon';
  for (const line of cart) line.variant = '<img src=x onerror=alert(1)>';
  const html = bodyRows(createCustomerOrderHtml(saved(cart)));
  assert.equal((html.match(/<tr/g) || []).length, 1);
  assert.match(html, /Salon \/ Balkon/); assert.match(html, /&lt;img/); assert.equal(html.includes('<img src=x'), false);
});

test('dual plise summarizes tül and güneşlik independently without duplicate pair subtotals', () => {
  const tul = { ...product, _id: 'summary-tul', product_name: 'Plise ALIA Serisi 15mm', sale_price: 1400 };
  let index = 0;
  const batch = calculateDualPliseBatch(tul, product, { room_name: 'Salon', variant: 'AL01', shade_variant: 'LA01' }, [
    { width: '60', height: '50', shade_height: '90', count: '1', label: 'Cam 1', case_color: '' },
    { width: '70', height: '60', shade_height: '80', count: '1', label: 'Cam 2', case_color: '' },
  ], () => `summary-${++index}`);
  const entries = customerPrintEntries(batch.lines);
  assert.equal(entries.length, 2); assert.equal(entries[0].line.quantity, 2); assert.equal(entries[1].line.quantity, 2);
  assert.equal(entries[0].line.item_total, 2800); assert.equal(entries[1].line.item_total, 2400);
  const html = bodyRows(createCustomerOrderHtml(saved(batch.lines)));
  assert.equal((html.match(/<tr/g) || []).length, 2);
  assert.match(html, /Çiftli plise · Tül/); assert.match(html, /Çiftli plise · Güneşlik/);
  assert.equal(html.includes('dual-plise-total'), false);
});
