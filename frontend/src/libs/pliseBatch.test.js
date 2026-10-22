import test from "node:test";
import assert from "node:assert/strict";
import { calculateMeasurementBatch, createMeasurementRow, getCaseColorOptions, selectCaseColorIndices, supportsMeasurementBatch } from "./pliseBatch.js";
import { calculateCurtainLine, defaultMeasurement, restoreSaleDraft, salePayload } from "./curtainCalculation.js";
import { normalizeSale } from "../../../backend/src/libs/sale-validation.js";
import { buildMeasurementRevision, measurementFormForLine } from "../../../backend/src/libs/orderMeasurement.js";
import { createCustomerOrderHtml, createManufacturingHtml, manufacturingBoxes } from "./curtainPrint.js";

const product = {
  _id: "507f1f77bcf86cd799439011", product_name: "OBA Plise", category_name: "Plise", brand_name: "OBA Perdesan",
  calculation_type: "m2", sale_price: 100, min_m2: 1, dimension_rounding_cm: 10, stock_tracking: false,
  extra_options: [{ option_name: "Profil", price_impact: 10, pricing_basis: "mt" }],
};
const whiteCase = "Kasa / Donanım Rengi: Beyaz";
const anthraciteCase = "Kasa / Donanım Rengi: Antrasit";
const walnutCase = "KASA / DONANIM RENGİ : Ceviz";
const caseProduct = {
  ...product,
  extra_options: [
    ...product.extra_options,
    { option_name: whiteCase, price_impact: 0, pricing_basis: "adet", pricing_scope: "kasa" },
    { option_name: anthraciteCase, price_impact: 20, pricing_basis: "mt" },
    { option_name: "Kasa bağlantı aparatı", price_impact: 5, pricing_basis: "adet", pricing_scope: "kasa" },
    { option_name: walnutCase, price_impact: 10, pricing_basis: "yuzde" },
  ],
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

test("case-color choices preserve catalog names and replace colors without dropping other accessories", () => {
  assert.deepEqual(getCaseColorOptions(caseProduct), [
    { index: 1, option_name: whiteCase, label: "Beyaz" },
    { index: 2, option_name: anthraciteCase, label: "Antrasit" },
    { index: 4, option_name: walnutCase, label: "Ceviz" },
  ]);
  assert.deepEqual(getCaseColorOptions({ extra_options: [{ option_name: "Kasa / Donanım Rengi:" }, { option_name: "Kasa rengi açıklaması" }] }), []);
  assert.deepEqual(getCaseColorOptions(null), []);
  const padded = { extra_options: [{ option_name: `  ${whiteCase}  ` }] };
  assert.deepEqual(selectCaseColorIndices(padded, [], getCaseColorOptions(padded)[0].option_name), [0]);
  const selected = Object.freeze([0, 1, 2, 3]);
  assert.deepEqual(selectCaseColorIndices(caseProduct, selected, walnutCase), [0, 3, 4]);
  assert.deepEqual(selectCaseColorIndices(caseProduct, selected, ""), [0, 3]);
  assert.deepEqual(selected, [0, 1, 2, 3]);
  for (const invalid of ["Antrasit", "2", "Kasa / Donanım Rengi: Katalogda yok"]) {
    assert.throws(() => selectCaseColorIndices(caseProduct, selected, invalid), /Kasa rengini/);
  }
  for (const invalid of [null, "0,1", {}]) assert.throws(() => selectCaseColorIndices(caseProduct, invalid, whiteCase), /Aksesuar seçimlerini/);
});

test("new and copied measurement rows retain independent case-color choices", () => {
  assert.equal(createMeasurementRow().case_color, "");
  const original = row(100, 200, 2, { label: "Kapı yanı", variant: "VR200", case_color: anthraciteCase });
  const copy = createMeasurementRow(original);
  assert.deepEqual(copy, original);
  assert.notEqual(copy, original);
  copy.case_color = whiteCase;
  copy.width = "120";
  assert.equal(original.case_color, anthraciteCase);
  assert.equal(original.width, "100");
  assert.equal(copy.count, "2");
  assert.equal(copy.variant, "VR200");
});

test("each row applies only its own case color while preserving common accessories, totals and previews", () => {
  for (const category_name of ["Plise", "Honeycomb"]) {
    const p = { ...caseProduct, category_name };
    const form = common(p, { extra_indices: [0, 1, 3] });
    const rows = [
      row(100, 200, 1, { label: "Beyaz cam", case_color: whiteCase }),
      row(120, 210, 2, { label: "Antrasit cam", case_color: anthraciteCase }),
      row(80, 90, 1, { label: "Renksiz cam", case_color: "" }),
    ];
    const before = JSON.stringify({ form, rows, p });
    const result = calculateMeasurementBatch(p, form, rows);
    assert.deepEqual(result.lines.map((line) => line.accessories.map((option) => option.name)), [
      ["Profil", "Kasa bağlantı aparatı", whiteCase],
      ["Profil", "Kasa bağlantı aparatı", anthraciteCase],
      ["Profil", "Kasa bağlantı aparatı"],
    ]);
    assert.deepEqual(result.lines.map((line) => line.item_total), [215, 586, 113]);
    assert.equal(result.total, 914);
    assert.equal(result.quantity, 8.04);
    assert.equal(result.pieces, 4);
    for (let index = 0; index < rows.length; index++) {
      const line = result.lines[index];
      assert.deepEqual(line.pricing_snapshot.extra_options.map((option) => option.option_name), line.accessories.map((option) => option.name));
      assert.deepEqual(calculateMeasurementBatch(p, form, [rows[index]]).lines[0], line);
    }
    assert.notEqual(result.lines[0].accessories, result.lines[1].accessories);
    assert.notEqual(result.lines[0].pricing_snapshot.extra_options, result.lines[1].pricing_snapshot.extra_options);
    assert.equal(JSON.stringify({ form, rows, p }), before);
  }
});

test("legacy rows retain common case colors while an explicit blank removes them only from that row", () => {
  const legacy = { width: "100", height: "200", count: "1", label: "Eski satır", variant: "" };
  const result = calculateMeasurementBatch(caseProduct, common(caseProduct, { extra_indices: [0, 2] }), [legacy, row(100, 200)]);
  assert.deepEqual(result.lines.map((line) => line.accessories.map((option) => option.name)), [["Profil", anthraciteCase], ["Profil"]]);
  assert.deepEqual(result.lines.map((line) => line.item_total), [230, 210]);
  assert.equal(Object.hasOwn(legacy, "case_color"), false);
  assert.throws(() => calculateMeasurementBatch(caseProduct, common(caseProduct), [legacy, row(100, 200, 1, { case_color: "Geçersiz renk" })]), /2\. ölçü satırı:.*Kasa rengini/);
});

test("free, paid and percentage case colors survive saving and measurement revision with original prices and FX", () => {
  const usd = {
    ...caseProduct, currency: "USD", sale_price: 12.5,
    extra_options: caseProduct.extra_options.map((option, index) => index === 0 ? { ...option, price_impact: 1.25, currency: "USD" } : index === 2 ? { ...option, price_impact: 2.5, currency: "USD" } : option),
  };
  const fx = { currency_rate: "40", currency_rate_mode: "automatic", currency_rate_source: "TCMB", currency_rate_type: "ForexSelling", currency_rate_date: "2026-10-15", currency_rate_fetched_at: "2026-10-15T13:00:00.000Z" };
  const result = calculateMeasurementBatch(usd, common(usd, { ...fx, extra_indices: [0, 1] }), [
    row(100, 200, 1, { case_color: whiteCase }),
    row(155, 205, 2, { case_color: anthraciteCase }),
    row(100, 200, 1, { case_color: walnutCase }),
  ]);
  assert.deepEqual(result.lines.map((line) => line.item_total), [1050, 3825, 1150]);
  assert.equal(result.total, 6025);
  assert.deepEqual(result.lines.map((line) => line.accessories[1]), [
    { name: whiteCase, pricing_basis: "adet", pricing_scope: "kasa", unit: "adet", quantity: 1, unit_price: 0, total: 0 },
    { name: anthraciteCase, pricing_basis: "mt", pricing_scope: "parca", unit: "m", quantity: 3.1, unit_price: 100, total: 310 },
    { name: walnutCase, pricing_basis: "yuzde", pricing_scope: "parca", unit: "%", quantity: 10, unit_price: 10, total: 100 },
  ]);
  const saved = JSON.parse(JSON.stringify(savedOrder(result.lines)));
  const restored = restoreSaleDraft(saved);
  assert.deepEqual(restored.cart, saved.pos_details.cart);
  const measurements = restored.cart.map((line, index) => ({ ...measurementFormForLine(line), ...(index === 1 ? { width: 165 } : index === 2 ? { height: 210 } : {}) }));
  const revised = buildMeasurementRevision(saved, { measurements }, [{ ...usd, sale_price: 999, min_m2: 50, dimension_rounding_cm: 100, extra_options: [] }]);
  assert.deepEqual(revised.pos_details.cart.map((line) => line.item_total), [1050, 4065, 1205]);
  assert.equal(revised.sub_total, 6320);
  assert.deepEqual(revised.pos_details.cart[0], restored.cart[0]);
  for (let index = 0; index < result.lines.length; index++) {
    const line = revised.pos_details.cart[index];
    assert.deepEqual(line.pricing_snapshot, result.lines[index].pricing_snapshot);
    assert.deepEqual(line.accessories.map((option) => option.name), result.lines[index].accessories.map((option) => option.name));
    assert.equal(line.base_unit_price, 500);
    assert.equal(line.original_unit_price, 12.5);
    assert.equal(line.currency_rate, 40);
    assert.equal(line.accessories[0].unit_price, 50);
    assert.equal(line.currency_rate_source, "TCMB");
    assert.equal(line.currency_rate_fetched_at, fx.currency_rate_fetched_at);
  }
  assert.deepEqual(revised.pos_details.cart[1].accessories[1], { ...result.lines[1].accessories[1], quantity: 3.3, total: 330 });
  assert.deepEqual(revised.pos_details.cart[2].accessories[1], { ...result.lines[2].accessories[1], unit_price: 10.5, total: 105 });
  assert.doesNotThrow(() => normalizeSale({ ...saved, ...revised }));
});

test("customer output keeps each case color beside its own row without color leakage", () => {
  const rows = [
    row(100, 200, 1, { label: "Beyaz cam", variant: "VR101", case_color: whiteCase }),
    row(120, 210, 2, { label: "Antrasit cam", variant: "VR202", case_color: anthraciteCase }),
    row(80, 90, 1, { label: "Renksiz cam", variant: "VR303", case_color: "" }),
  ];
  const saved = savedOrder(calculateMeasurementBatch(caseProduct, common(caseProduct, { extra_indices: [0, 1] }), rows).lines);
  const customer = createCustomerOrderHtml(saved);
  assert.throws(() => createManufacturingHtml(saved), /atölyede dikilecek ürün bulunmuyor/);
  const customerRows = customer.match(/<tr><td>[\s\S]*?<\/tr>/g) || [];
  assert.equal(customerRows.length, 3);
  for (const rendered of [customerRows]) {
    for (let index = 0; index < rows.length; index++) {
      assert.ok(rendered[index].includes(rows[index].label));
      assert.ok(rendered[index].includes(rows[index].variant));
      assert.ok(rendered[index].includes("Profil"));
      for (const color of [whiteCase, anthraciteCase, walnutCase]) assert.equal(rendered[index].includes(color), rows[index].case_color === color);
    }
  }
  assert.ok(customerRows[0].includes("Ölçü: 100,00 × 200,00 cm"));
  assert.ok(customerRows[1].includes("Ölçü: 120,00 × 210,00 cm"));
  assert.ok(customerRows[2].includes("Ölçü: 80,00 × 90,00 cm"));
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

test("customer output summarizes matching plise colors while retaining all 30 saved measurements", () => {
  const result = calculateMeasurementBatch(product, common(), thirtyRows());
  const saved = savedOrder(result.lines);
  const customer = createCustomerOrderHtml(saved);
  assert.throws(() => createManufacturingHtml(saved), /atölyede dikilecek ürün bulunmuyor/);
  const boxes = manufacturingBoxes(saved.pos_details.cart);
  assert.equal(boxes.length, 0);
  const body = customer.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  assert.equal((body.match(/<tr/g) || []).length, 2);
  assert.equal(saved.pos_details.cart.length, 30);
  for (let index = 0; index < 30; index++) assert.equal(saved.pos_details.cart[index].area, `Doğu kanadı / Cam ${index + 1}`);
  assert.ok(customer.includes('Toplam 39 adet'));
  assert.ok(customer.includes('VR100 · Ekru'));
  assert.ok(customer.includes("Ölçü: 155,00 × 205,00 cm"));
  assert.ok(customer.includes("Hesap ölçüsü: 160,00 × 210,00 cm"));
  assert.ok(customer.includes("Profil: 1,55 m × ₺10,00 = ₺15,50"));
  assert.ok(customer.includes("VR999 · Antrasit"));
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


test('decorative rail rows bill each actual width independently and preserve individual VR through order and measurement revision',()=>{
 const rail={...product,product_name:'Dekoratif Ray',category_name:'Dekoratif Ray',calculation_type:'mt',min_width_cm:100,dimension_rounding_cm:10,extra_options:[]};
 const result=calculateMeasurementBatch(rail,{...defaultMeasurement(rail),room_name:'Salon'},[
  row(79,'',1,{variant:'VR01 · Beyaz',label:'Kuzey'}),row(155,'',2,{variant:'VR02 · Ceviz',label:'Doğu'})]);
 assert.equal(result.quantity,4.2);assert.equal(result.total,420);assert.equal(result.unit_label,'m');
 assert.deepEqual(result.lines.map(l=>l.height),[0,0]);assert.deepEqual(result.lines.map(l=>l.variant),['VR01 · Beyaz','VR02 · Ceviz']);
 const lines=result.lines.map((l,i)=>({...l,id:`rail-test-${i}`}));
 const sale={...salePayload(lines,{...header,measurement_source:'team'},0,'tamamlandi','rail-test-key'),measurement_source:'team'};
 const html=createCustomerOrderHtml(sale);assert.ok(html.includes('VR01 · Beyaz'));assert.ok(html.includes('VR02 · Ceviz'));assert.ok(html.includes('Ekibimiz ölçtü'));assert.ok(html.includes('En 79,00 cm'));assert.ok(!html.includes('× 0,00 cm'));
 const revision=buildMeasurementRevision(sale,{measurements:lines.map((l,i)=>({...measurementFormForLine(l),width:i?185:80}))});
 assert.deepEqual(revision.pos_details.cart.map(l=>l.variant),lines.map(l=>l.variant));assert.equal(revision.pos_details.cart[1].quantity,3.8);
 assert.equal(manufacturingBoxes(lines).length,0);
});
test('rustic size ladder rows use next listed width with independent colors, counts and frozen prices',()=>{
 const rustic={...product,product_name:'Cantara',category_name:'Rustik',calculation_type:'adet',supplier_unit:'Takım',extra_options:[],rustic_size_prices:[{width_cm:100,sale_price:1000},{width_cm:150,sale_price:1500},{width_cm:200,sale_price:2000}]};
 const result=calculateMeasurementBatch(rustic,defaultMeasurement(rustic),[row(79,'',1,{variant:'Ekru'}),row(131,'',2,{variant:'Ceviz'})]);
 assert.equal(result.total,4000);assert.equal(result.quantity,3);assert.equal(result.unit_label,'takım');assert.deepEqual(result.lines.map(l=>l.billable_width),[100,150]);
 assert.deepEqual(result.lines.map(l=>l.height),[0,0]);assert.deepEqual(result.lines.map(l=>l.variant),['Ekru','Ceviz']);
 assert.throws(()=>calculateMeasurementBatch(rustic,defaultMeasurement(rustic),[row(201,'')]),/en fazla/);
 const folding={...rustic,calculation_type:'mt',category_name:'Ray',brand_name:'OBA Perdesan',product_name:'5+1 Katlama Mekanizması'};
 assert.equal(supportsMeasurementBatch(folding),false);assert.equal(defaultMeasurement(folding).height,'260');
});
test('measurement provenance appears on both customer and textile workshop forms without leaking company or costs',()=>{
 const fabric={...product,category_name:'Tül',calculation_type:'mt',extra_options:[]};
 const line={...calculateCurtainLine(fabric,{...defaultMeasurement(fabric),width:400,height:260}),id:'source-paper'};
 const sale={...salePayload([line],{...header,measurement_source:'customer'},0,'tamamlandi','source-paper-key'),measurement_source:'customer'};
 assert.ok(createCustomerOrderHtml(sale).includes('Müşteri ölçüsü'));assert.ok(createManufacturingHtml(sale).includes('Müşteri ölçüsü'));
 delete sale.measurement_source;assert.ok(createCustomerOrderHtml(sale).includes('Belirtilmedi'));
});


test('OBA ADA oval-square single, double and triple decorative rails support width-only rows and independent or duplicate VR entries',()=>{
 for(const name of ['DEKORATİF OVAL-KARE TEKLİ RAY','DEKORATİF İKİLİ RAY','DEKORATİF ÜÇLÜ RAY','KULAKLI TEKLİ RAY','ÜÇLÜ OTEL RAYI']){
  const p={...product,product_name:name,brand_name:'OBA Perdesan',category_name:'ADA',calculation_type:'mt',min_width_cm:0,dimension_rounding_cm:0,extra_options:[]};
  assert.equal(supportsMeasurementBatch(p),true,name);assert.equal(defaultMeasurement(p).height,'');
  const values=[row(155,'',1,{variant:'VR01 · Beyaz'}),row(240,'',1,{variant:'VR02 · Antrasit'}),row(155,'',2,{variant:'VR01 · Beyaz'})];
  const result=calculateMeasurementBatch(p,defaultMeasurement(p),values);
  assert.equal(result.quantity,7.05,name);assert.equal(result.total,705,name);assert.equal(result.pieces,4,name);
  assert.deepEqual(result.lines.map(l=>l.height),[0,0,0]);assert.deepEqual(result.lines.map(l=>l.variant),values.map(r=>r.variant));
  const lines=result.lines.map((l,i)=>({...l,id:`oba-ada-${i}`}));
  const sale=salePayload(lines,header,0,'tamamlandi','oba-ada-test');
  const html=createCustomerOrderHtml(sale);assert.ok(html.includes('VR02 · Antrasit'));assert.ok(!html.includes('× 0,00 cm'));
  const updated=buildMeasurementRevision(sale,{measurements:lines.map((l,i)=>({...measurementFormForLine(l),width:i===0?180:l.width}))});
  assert.equal(updated.pos_details.cart[0].quantity,1.8);assert.deepEqual(updated.pos_details.cart.map(l=>l.variant),values.map(r=>r.variant));
 }
 const other={...product,brand_name:'OBA Perdesan',category_name:'ADA'};
 assert.equal(supportsMeasurementBatch({...other,calculation_type:'adet',product_name:'RAY KAPAĞI'}),false);
 assert.equal(supportsMeasurementBatch({...other,calculation_type:'mt',product_name:'KARE ETEK ÇITASI'}),false);
});
