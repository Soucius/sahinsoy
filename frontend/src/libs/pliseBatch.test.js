import test from "node:test";
import assert from "node:assert/strict";
import { calculateMeasurementBatch, createMeasurementRow, supportsMeasurementBatch } from "./pliseBatch.js";
import { calculateCurtainLine, defaultMeasurement, restoreSaleDraft, salePayload } from "./curtainCalculation.js";
import { normalizeSale } from "../../../backend/src/libs/sale-validation.js";
import { buildMeasurementRevision, measurementFormForLine } from "../../../backend/src/libs/orderMeasurement.js";
import { createCustomerOrderHtml, createManufacturingHtml, manufacturingBoxes } from "./curtainPrint.js";

const product = {
  _id: "507f1f77bcf86cd799439011", product_name: "OBA Plise", category_name: "Plise", brand_name: "OBA Perdesan",
  calculation_type: "m2", sale_price: 100, min_m2: 1, dimension_rounding_cm: 10, stock_tracking: false,
  extra_options: [{ option_name: "Profil", price_impact: 10, pricing_basis: "mt" }],
};
const header = { first_name: "Deneme", last_name: "Müşteri", delivery_date: "2026-10-20", delivery_method: "magaza", payment_method: "Nakit" };
const common = (p = product, overrides = {}) => ({
  ...defaultMeasurement(p), room_name: "Balkon", area: "Doğu kanadı", facade: "Doğu Cephe", window_name: "Sürgülü Cam",
  variant: "VR100 · Ekru", item_note: "Montajda kontrol edin", extra_indices: [0], ...overrides,
});
const row = (width, height, count = 1, overrides = {}) => createMeasurementRow({ width, height, count, ...overrides });
const thirtyRows = () => Array.from({ length: 30 }, (_, index) => {
  const sizes = [[40, 50, 1], [110, 101, 2], [155, 205, 1]][index % 3];
  return row(...sizes, { label: `Cam ${index + 1}`, ...(index === 29 ? { variant: "VR999 · Antrasit" } : {}) });
});
const savedOrder = (lines, discount = 0, fee = 0) => normalizeSale({
  _id: "507f1f77bcf86cd799439099",
  ...salePayload(lines.map((line, index) => ({ ...line, id: `batch-line-${index + 1}` })), header, discount, "tamamlandi", "plise-batch-test", fee),
});

test("batch eligibility includes Plise and Honeycomb m² products without enabling other curtain modes", () => {
  for (const category of ["Plise", "PLİSE", "Honeycomb", "Honeycomb / Duet"]) {
    assert.equal(supportsMeasurementBatch({ ...product, category_name: category }), true, category);
    assert.equal(supportsMeasurementBatch({ ...product, category_name: "Other", product_category: { category_name: category } }), true, category);
  }
  for (const category of ["Stor", "Zebra", "Jaluzi", "Dikey", "Tül", "Fon", "Motorlu Ray"]) {
    assert.equal(supportsMeasurementBatch({ ...product, category_name: category }), false, category);
  }
  assert.equal(supportsMeasurementBatch({ ...product, calculation_type: "adet" }), false);
  assert.equal(supportsMeasurementBatch({ ...product, calculation_type: "mt" }), false);
  assert.equal(supportsMeasurementBatch(null), false);
});

test("30 mixed rows apply per-piece minimums and rounding, then add actual-width profiles", () => {
  const result = calculateMeasurementBatch(product, common(), thirtyRows());
  assert.equal(result.lines.length, 30);
  assert.equal(result.pieces, 40);
  assert.equal(result.quantity, 67.8);
  assert.equal(result.total, 7195);
  for (let index = 0; index < result.lines.length; index++) {
    const line = result.lines[index];
    const expected = [
      { width: 40, height: 50, billable_width: 40, billable_height: 50, count: 1, quantity: 1, material: 100, profileQuantity: 0.4, profileTotal: 4, total: 104 },
      { width: 110, height: 101, billable_width: 110, billable_height: 110, count: 2, quantity: 2.42, material: 242, profileQuantity: 2.2, profileTotal: 22, total: 264 },
      { width: 155, height: 205, billable_width: 160, billable_height: 210, count: 1, quantity: 3.36, material: 336, profileQuantity: 1.55, profileTotal: 15.5, total: 351.5 },
    ][index % 3];
    for (const key of ["width", "height", "billable_width", "billable_height", "count", "quantity"]) assert.equal(line[key], expected[key], `row ${index + 1}: ${key}`);
    assert.equal(line.pieces, expected.count);
    assert.equal(line.material_total, expected.material);
    assert.equal(line.accessories[0].quantity, expected.profileQuantity);
    assert.equal(line.accessories[0].total, expected.profileTotal);
    assert.equal(line.item_total, expected.total);
    assert.equal(line.mode, "mechanical");
    assert.equal(line.mechanical_panels, undefined);
  }
});

test("Honeycomb minimum dimensions and area increments are applied before each row count", () => {
  const honeycomb = { ...product, category_name: "Honeycomb", min_m2: 2, min_width_cm: 100, min_height_cm: 200, rounding_step: 0.25 };
  const result = calculateMeasurementBatch(honeycomb, common(honeycomb, { extra_indices: [] }), [row(40, 50, 3), row(155, 205, 2)]);
  assert.deepEqual(result.lines.map((line) => [line.billable_width, line.billable_height, line.quantity, line.pieces]), [[100, 200, 6, 3], [160, 210, 7, 2]]);
  assert.equal(result.quantity, 13);
  assert.equal(result.pieces, 5);
  assert.equal(result.total, 1300);
});

test("shared location and VR copy to each independent row while explicit row labels and VR override them", () => {
  const result = calculateMeasurementBatch(product, common(), [row(100, 200), row(120, 210, 2, { label: "  Kapı yanı  ", variant: "  VR200 · Beyaz  " })]);
  assert.deepEqual(result.lines.map((line) => line.area), ["Doğu kanadı / Cam 1", "Doğu kanadı / Kapı yanı"]);
  assert.deepEqual(result.lines.map((line) => line.variant), ["VR100 · Ekru", "VR200 · Beyaz"]);
  for (const line of result.lines) {
    assert.equal(line.room_name, "Balkon");
    assert.equal(line.facade, "Doğu Cephe");
    assert.equal(line.window_name, "Sürgülü Cam");
    assert.equal(line.item_note, "Montajda kontrol edin");
    assert.deepEqual(line.pricing_snapshot.extra_options, [{ option_name: "Profil", pricing_basis: "mt", pricing_scope: "parca" }]);
  }
  assert.notEqual(result.lines[0], result.lines[1]);
  assert.notEqual(result.lines[0].accessories, result.lines[1].accessories);
  assert.notEqual(result.lines[0].pricing_snapshot, result.lines[1].pricing_snapshot);
});

test("blank row metadata falls back after trimming, while oversized combined labels or VR reject the affected row", () => {
  const result = calculateMeasurementBatch(product, common(), [row(100, 200, 1, { label: "   ", variant: "   " })]);
  assert.equal(result.lines[0].area, "Doğu kanadı / Cam 1");
  assert.equal(result.lines[0].variant, "VR100 · Ekru");
  assert.throws(() => calculateMeasurementBatch(product, common(), [row(100, 200), row(100, 200, 1, { variant: "v".repeat(151) })]), /2\. ölçü satırı:.*çok uzun/);
  assert.throws(() => calculateMeasurementBatch(product, common(product, { area: "a".repeat(199) }), [row(100, 200)]), /1\. ölçü satırı:.*çok uzun/);
});

test("separate entered rows preserve line-level monetary rounding instead of merging equal dimensions", () => {
  const fractional = { ...product, sale_price: 33.33 };
  const form = common(fractional, { extra_indices: [] });
  const separate = calculateMeasurementBatch(fractional, form, [row(95, 150), row(95, 150)]);
  const repeated = calculateMeasurementBatch(fractional, form, [row(95, 150, 2)]);
  assert.deepEqual(separate.lines.map((line) => line.quantity), [1.5, 1.5]);
  assert.deepEqual(separate.lines.map((line) => line.item_total), [50, 50]);
  assert.equal(separate.quantity, repeated.quantity);
  assert.equal(separate.pieces, repeated.pieces);
  assert.equal(separate.total, 100);
  assert.equal(repeated.total, 99.99);
  assert.equal(separate.lines[0].unit_price, 50 / 1.5);
  assert.doesNotThrow(() => normalizeSale(savedOrder(separate.lines)));
});

test("a bad final row rejects the complete pure calculation without changing input or exposing a partial result", () => {
  const rows = thirtyRows();
  rows[29].width = "";
  const form = common();
  const before = JSON.stringify({ rows, form, product });
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  Object.freeze(form.extra_indices);
  Object.freeze(form);
  let result;
  assert.throws(() => { result = calculateMeasurementBatch(product, form, rows); }, /^Error: 30\. ölçü satırı: En/);
  assert.equal(result, undefined);
  assert.equal(JSON.stringify({ rows, form, product }), before);
});

test("invalid counts and missing or nonpositive dimensions report the affected row", () => {
  for (const count of ["1.5", "0", "-1", "", "NaN", "Infinity"]) {
    assert.throws(() => calculateMeasurementBatch(product, common(), [row(100, 200), row(100, 200, count)]), /2\. ölçü satırı:.*pozitif tam sayı/, `count ${count}`);
  }
  for (const dimensions of [["", 200], [100, ""], [0, 200], [100, -1], ["NaN", 200], [100, "Infinity"]]) {
    assert.throws(() => calculateMeasurementBatch(product, common(), [row(...dimensions)]), /1\. ölçü satırı:.*geçerli bir ölçü/, `dimensions ${dimensions}`);
  }
  assert.throws(() => calculateMeasurementBatch(product, common(), []), /En az bir ölçü satırı/);
  assert.throws(() => calculateMeasurementBatch(product, common(), [null]), /1\. ölçü satırı:/);
  assert.throws(() => calculateMeasurementBatch({ ...product, category_name: "Stor" }, common(), [row(100, 200)]), /çoklu ölçü listesi kullanılamaz/);
});

test("technical dimension limits are checked for each actual row before price rounding", () => {
  const bounded = { ...product, technical_limits: { max_width_cm: 155, max_height_cm: 205, max_m2: 3.2 } };
  const result = calculateMeasurementBatch(bounded, common(bounded), [row(155, 205)]);
  assert.equal(result.lines[0].billable_width, 160);
  assert.equal(result.lines[0].billable_height, 210);
  assert.equal(result.quantity, 3.36);
  assert.throws(() => calculateMeasurementBatch(bounded, common(bounded), [row(40, 50), row(156, 205)]), /2\. ölçü satırı:.*ölçü sınırının dışında/);
  assert.throws(() => calculateMeasurementBatch({ ...bounded, technical_limits: { max_m2: 3 } }, common(bounded), [row(155, 205)]), /1\. ölçü satırı:.*maksimum m²/);
});

test("every row retains automatic USD FX metadata and converts product and accessory prices at the same saved rate", () => {
  const usd = { ...product, currency: "USD", sale_price: 12.5, extra_options: [{ option_name: "Profil", price_impact: 1.25, pricing_basis: "mt", currency: "USD" }] };
  const fx = { currency_rate: "40", currency_rate_mode: "automatic", currency_rate_source: "TCMB", currency_rate_type: "ForexSelling", currency_rate_date: "2026-10-15", currency_rate_fetched_at: "2026-10-15T13:00:00.000Z" };
  const result = calculateMeasurementBatch(usd, common(usd, fx), [row(40, 50, 2), row(155, 205)]);
  assert.equal(result.total, 2797.5);
  assert.deepEqual(result.lines.map((line) => line.item_total), [1040, 1757.5]);
  for (const line of result.lines) {
    assert.equal(line.original_currency, "USD");
    assert.equal(line.original_unit_price, 12.5);
    assert.equal(line.currency_rate, 40);
    assert.equal(line.base_unit_price, 500);
    assert.equal(line.accessories[0].unit_price, 50);
    for (const key of Object.keys(fx).filter((key) => key !== "currency_rate")) assert.equal(line[key], fx[key]);
  }
  const saved = savedOrder(result.lines);
  const measurements = saved.pos_details.cart.map((line) => ({ ...measurementFormForLine(line), width: line.width === 155 ? 165 : line.width }));
  const revised = buildMeasurementRevision(saved, { measurements }, [{ ...usd, sale_price: 999, min_m2: 50, dimension_rounding_cm: 100 }]);
  assert.equal(revised.pos_details.cart[1].quantity, 3.57);
  assert.equal(revised.pos_details.cart[1].item_total, 1867.5);
  for (const line of revised.pos_details.cart) {
    assert.equal(line.base_unit_price, 500);
    assert.equal(line.currency_rate, 40);
    assert.equal(line.accessories[0].unit_price, 50);
    assert.equal(line.currency_rate_source, "TCMB");
    assert.equal(line.currency_rate_fetched_at, fx.currency_rate_fetched_at);
  }
});

test("30 normal batch lines save, restore, and revise individually with original rules, prices, count and ordering flags", () => {
  const result = calculateMeasurementBatch(product, common(), thirtyRows());
  const saved = JSON.parse(JSON.stringify(savedOrder(result.lines, 10, 25)));
  saved.sale_items[29].is_ordered = true;
  assert.equal(saved.sale_items.length, 30);
  assert.equal(saved.sub_total, 7195);
  assert.equal(saved.grand_total, 6500.5);
  const restored = restoreSaleDraft(saved);
  assert.deepEqual(restored.cart, saved.pos_details.cart);
  assert.equal(restored.discount, 10);
  const measurements = restored.cart.map((line, index) => ({ ...measurementFormForLine(line), ...(index === 29 ? { width: 165 } : {}) }));
  const revised = buildMeasurementRevision(saved, { measurements }, [{ ...product, sale_price: 999, min_m2: 50, dimension_rounding_cm: 100, extra_options: [] }]);
  assert.equal(revised.sale_items.length, 30);
  assert.equal(revised.sub_total, 7217);
  assert.equal(revised.discount_amount, 721.7);
  assert.equal(revised.credit_card_fee, 25);
  assert.equal(revised.grand_total, 6520.3);
  assert.deepEqual(revised.pos_details.cart.slice(0, 29), restored.cart.slice(0, 29));
  const changed = revised.pos_details.cart[29];
  assert.equal(changed.id, "batch-line-30");
  assert.equal(changed.width, 165);
  assert.equal(changed.height, 205);
  assert.equal(changed.billable_width, 170);
  assert.equal(changed.quantity, 3.57);
  assert.equal(changed.count, 1);
  assert.equal(changed.base_unit_price, 100);
  assert.equal(changed.accessories[0].quantity, 1.65);
  assert.equal(changed.accessories[0].unit_price, 10);
  assert.equal(changed.variant, "VR999 · Antrasit");
  assert.equal(changed.area, "Doğu kanadı / Cam 30");
  assert.equal(revised.sale_items[29].is_ordered, true);
  assert.equal(saved.pos_details.cart[29].width, 155);
  assert.doesNotThrow(() => normalizeSale({ ...saved, ...revised }));
});

test("customer and manufacturing output retain all 30 row labels, actual dimensions, counts, VR and accessories across pages", () => {
  const result = calculateMeasurementBatch(product, common(), thirtyRows());
  const saved = savedOrder(result.lines);
  const customer = createCustomerOrderHtml(saved);
  const manufacturing = createManufacturingHtml(saved);
  const boxes = manufacturingBoxes(saved.pos_details.cart);
  assert.equal(boxes.length, 30);
  assert.equal((customer.match(/<tr><td>/g) || []).length, 30);
  assert.equal((manufacturing.match(/class="sheet plan-sheet"/g) || []).length, 4);
  assert.equal((manufacturing.match(/class="plan-box"/g) || []).length, 30);
  for (let index = 0; index < 30; index++) {
    assert.ok(customer.includes(`Doğu kanadı / Cam ${index + 1} ·`));
    assert.ok(manufacturing.includes(`Doğu kanadı / Cam ${index + 1} ·`));
    assert.equal(boxes[index].line.id, `batch-line-${index + 1}`);
  }
  assert.ok(customer.includes("Ölçü: 155,00 × 205,00 cm"));
  assert.ok(customer.includes("Hesap ölçüsü: 160,00 × 210,00 cm"));
  assert.ok(customer.includes("Profil: 1,55 m × ₺10,00 = ₺15,50"));
  assert.ok(customer.includes("VR999 · Antrasit"));
  assert.ok(manufacturing.includes("VR999 · Antrasit"));
  assert.ok(manufacturing.includes("2 adet · En 110,00 cm"));
  assert.ok(manufacturing.includes("En 155,00 cm"));
  assert.ok(manufacturing.includes("Boy 205,00 cm"));
  assert.ok(manufacturing.includes("Profil"));
  assert.ok(!manufacturing.includes("₺"));
});

test("batch output preserves the normal calculator result for a row with comma decimals and ignores stale case-builder state", () => {
  const form = common(product, { case_mode: "ortak", mechanical_panels: [{ width: "999", height: "999" }] });
  const result = calculateMeasurementBatch(product, form, [row("155,5", "205,5", 2, { label: "Özel cam" })]);
  const normal = calculateCurtainLine(product, { ...form, width: "155,5", height: "205,5", count: "2", area: "Doğu kanadı / Özel cam", case_mode: "ayri", mechanical_panels: [] });
  assert.deepEqual(result.lines[0], normal);
  assert.equal(result.quantity, 6.72);
  assert.equal(result.pieces, 2);
  assert.equal(result.lines[0].accessories[0].quantity, 3.11);
  assert.equal(result.total, 703.1);
});
