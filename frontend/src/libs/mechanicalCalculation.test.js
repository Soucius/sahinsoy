import test from "node:test";
import assert from "node:assert/strict";
import { calculateCurtainLine, defaultMeasurement, mechanicalPanelPosition, needsControlDirection, restoreSaleDraft, salePayload } from "./curtainCalculation.js";

const stor = { _id: "507f1f77bcf86cd799439011", product_name: "MA Serisi", product_brand: { brand_name: "Oba Perdesan" }, product_category: { category_name: "Stor" }, calculation_type: "m2", sale_price: 826, min_width_cm: 100, min_height_cm: 200, dimension_rounding_cm: 10, min_m2: 2, currency: "TRY", stock_tracking: false };
const line = (product, width, height, overrides = {}) => calculateCurtainLine(product, { ...defaultMeasurement(product), width: String(width), height: String(height), ...overrides });

test("OBA list examples round each dimension, without whole-area completion", () => {
  for (const [width, height, billedWidth, billedHeight, quantity] of [[155, 250, 160, 250, 4], [120, 265, 120, 270, 3.24], [101, 201, 110, 210, 2.31]]) {
    const result = line(stor, width, height, { chain_direction: "Sağ" });
    assert.equal(result.quantity, quantity);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    assert.equal(result.billable_width, billedWidth);
    assert.equal(result.billable_height, billedHeight);
    assert.equal(result.material_total, Math.round(quantity * 826 * 100) / 100);
    assert.ok(result.calculation_note.includes("fiyatlandırma ölçüsü"));
  }
});

test("Stor minimum dimensions apply per piece even when raw area exceeds 2m²", () => {
  assert.equal(line(stor, 50, 450, { chain_direction: "Sağ" }).quantity, 4.5);
  assert.equal(line(stor, 250, 90, { chain_direction: "Sağ" }).quantity, 5);
  assert.equal(line(stor, 50, 90, { count: "3", chain_direction: "Sağ" }).quantity, 6);
  assert.equal(line(stor, 160, 250, { chain_direction: "Sağ" }).quantity, 4, "exact dimension boundary must not round again");
});

test("Jaluzi uses 1m² minimum area and 10cm dimension steps without Stor minimum dimensions", () => {
  const jaluzi = { ...stor, product_category: { category_name: "Jaluzi" }, min_width_cm: 0, min_height_cm: 0, min_m2: 1 };
  for (const [width, height, quantity] of [[50, 150, 1], [220, 200, 4.4], [265, 200, 5.4]]) assert.equal(line(jaluzi, width, height, { chain_direction: "Sağ" }).quantity, quantity);
  assert.equal(line(jaluzi, 50, 150, { count: "2", chain_direction: "Sağ" }).quantity, 2);
});

test("existing area-step products keep their former billing rule", () => {
  const legacy = { ...stor, min_width_cm: 0, min_height_cm: 0, dimension_rounding_cm: 0, min_m2: 0.9, rounding_step: 0.25 };
  assert.equal(line(legacy, 50, 100, { count: "3", chain_direction: "Sağ" }).quantity, 3);
  const mixed = { ...stor, rounding_step: 0.5 };
  assert.equal(line(mixed, 120, 265, { count: "2", chain_direction: "Sağ" }).quantity, 7, "area rounding follows dimension rounding per piece");
});

test("metre accessories use actual width, area accessories use billed area and count accessories use pieces", () => {
  const product = { ...stor, extra_options: [
    { option_name: "Kapalı kasa", price_impact: 1148, pricing_basis: "mt", currency: "TRY" },
    { option_name: "Stor etek oyma", price_impact: 84, pricing_basis: "m2", currency: "TRY" },
    { option_name: "Redüktör", price_impact: 980, pricing_basis: "adet", currency: "TRY" },
  ] };
  const result = line(product, 155, 250, { count: "2", extra_indices: [0, 1, 2], chain_direction: "Sağ" });
  assert.equal(result.quantity, 8);
  assert.deepEqual(result.accessories.map((option) => option.quantity), [3.1, 8, 2]);
  assert.deepEqual(result.accessories.map((option) => option.total), [3558.8, 672, 1960]);
  assert.equal(result.item_total, 12798.8);
});

test("percentage differences apply to material only, independently of other extras and labor", () => {
  const product = { ...stor, extra_options: [
    { option_name: "Kapalı kasa", price_impact: 100, pricing_basis: "adet", currency: "TRY" },
    { option_name: "Karışık renk", price_impact: 10, pricing_basis: "yuzde", currency: "TRY" },
    { option_name: "Eğimli perde", price_impact: 100, pricing_basis: "yuzde", currency: "TRY" },
  ] };
  const result = line(product, 155, 250, { count: "2", labor_price: "90", extra_indices: [0, 1, 2], chain_direction: "Sağ" });
  assert.equal(result.material_total, 6608);
  assert.equal(result.labor_total, 0);
  assert.equal(result.accessories[1].quantity, 10, "10% is not multiplied by the sale-price multiplier");
  assert.equal(result.accessories[1].unit, "%");
  assert.equal(result.accessories[1].unit_price, 66.08);
  assert.equal(result.accessories[1].total, 660.8);
  assert.equal(result.accessories[2].total, 6608);
  assert.equal(result.item_total, 14076.8);
  const textile = { ...product, calculation_type: "mt", product_category: { category_name: "Tül" } };
  const withLabor = line(textile, 100, 260, { labor_price: "90", extra_indices: [0, 1] });
  assert.equal(withLabor.accessories[1].total, 280.84, "percent excludes textile labor and flat extras too");
});

test("mechanical metre products round billing width while manufacture and restored order retain actual size", () => {
  const rail = { ...stor, calculation_type: "mt", product_category: { category_name: "Ray" }, min_m2: 0, min_height_cm: 0, sale_price: 100 };
  const result = line(rail, 155, 260, { count: "2" });
  assert.equal(result.quantity, 3.2);
  assert.equal(result.width, 155);
  assert.equal(result.height, 260);
  const payload = salePayload([result], { first_name: "Deneme", last_name: "Müşteri" }, 0, "beklemede", "mechanical-test-key");
  const restored = restoreSaleDraft(payload).cart[0];
  assert.equal(restored.width, 155);
  assert.equal(restored.billable_width, 160);
  assert.equal(payload.sale_items[0].width, 155);
});

test("standalone foreign motors require their rate and reject incompatible foreign accessories", () => {
  const motor = { ...stor, calculation_type: "adet", product_category: { category_name: "Motor" }, currency: "USD", sale_price: 280, extra_options: [{ option_name: "Başka döviz", price_impact: 10, pricing_basis: "adet", currency: "EUR" }] };
  assert.throws(() => line(motor, 0, 0), /kuru/);
  assert.equal(line(motor, 0, 0, { currency_rate: "40", count: "2" }).item_total, 22400);
  assert.throws(() => line(motor, 0, 0, { currency_rate: "40", extra_indices: [0] }), /döviz/);
});

test("Stor, Zebra and Jaluzi require an explicit valid chain direction while textile and motors do not", () => {
  for (const category of ["Stor", "Zebra", "JALUZİ", "Ahşap Jaluzi"]) {
    const product = { ...stor, product_category: { category_name: category } };
    assert.equal(needsControlDirection(product), true);
    assert.equal(defaultMeasurement(product).chain_direction, "", "do not silently choose Sağ");
    for (const direction of [undefined, null, "", "sağ", "Sol ", "Yukarı"]) assert.throws(() => line(product, 155, 250, { chain_direction: direction }), /Zincir \/ ip yönünü seçin/);
    assert.equal(line(product, 155, 250, { chain_direction: "Sağ" }).item_total, line(product, 155, 250, { chain_direction: "Sol" }).item_total);
  }
  const textile = { ...stor, calculation_type: "mt", product_category: { category_name: "Tül" } };
  const motor = { ...stor, calculation_type: "adet", product_category: { category_name: "Stor Motoru" } };
  const rail = { ...stor, calculation_type: "mt", product_category: { category_name: "Ray" } };
  for (const product of [textile, motor, rail]) {
    assert.equal(needsControlDirection(product), false);
    assert.equal(defaultMeasurement(product).chain_direction, undefined);
    assert.doesNotThrow(() => line(product, 100, 260));
  }
});

test("chosen direction survives order save and reload alongside VR and actual manufacture dimensions", () => {
  for (const direction of ["Sağ", "Sol"]) {
    const result = line(stor, 155, 250, { chain_direction: direction, variant: "VR 390 · Ekru", item_note: "Salon camı" });
    const payload = salePayload([result], { first_name: "Deneme", last_name: "Müşteri" }, 10, "beklemede", "direction-test-key");
    const restored = restoreSaleDraft(payload).cart[0];
    assert.equal(restored.chain_direction, direction);
    assert.equal(restored.variant, "VR 390 · Ekru");
    assert.equal(restored.width, 155);
    assert.equal(restored.height, 250);
    assert.equal(restored.billable_width, 160);
    assert.ok(payload.sale_items[0].item_note.includes(`Zincir / ip yönü: ${direction}`));
    assert.ok(payload.sale_items[0].item_note.includes("Renk / VR: VR 390 · Ekru"));
    assert.ok(payload.sale_items[0].item_note.includes("Salon camı"));
    const legacy = restoreSaleDraft({ sale_items: payload.sale_items }).cart[0];
    assert.ok(legacy.item_note.includes(`Zincir / ip yönü: ${direction}`), "legacy note-only print must retain chosen direction");
  }
});

const casePanels = [
  { width: "80", height: "250", chain_direction: "Sağ", variant: "VR390 · Ekru" },
  { width: "120", height: "250", chain_direction: "Sol", variant: "VR389 · Bej" },
  { width: "100", height: "250", chain_direction: "Sağ", variant: "" },
];
const caseOptions = [
  { option_name: "Kapalı kasa", pricing_basis: "mt", pricing_scope: "kasa", price_impact: 100, currency: "TRY" },
  { option_name: "Kasa başı aparat", pricing_basis: "adet", pricing_scope: "kasa", price_impact: 50, currency: "TRY" },
  { option_name: "Parça başı redüktör", pricing_basis: "adet", price_impact: 30, currency: "TRY" },
  { option_name: "Etek oyma", pricing_basis: "m2", price_impact: 10, currency: "TRY" },
];
const caseLine = (mode, overrides = {}) => calculateCurtainLine({ ...stor, extra_options: caseOptions }, { ...defaultMeasurement(stor), case_mode: mode, count: "1", mechanical_panels: casePanels, variant: "VR400 · Beyaz", extra_indices: [0, 1, 2, 3], room_name: "Salon", facade: "Kuzey Cephe", ...overrides });

test("three pieces in one shared case each receive minimum dimensions before their areas are added", () => {
  const result = caseLine("ortak");
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.billable_area), [2.5, 3, 2.5]);
  assert.equal(result.quantity, 8, "80cm piece must bill at100cm, not merge into aggregate7.5m²");
  assert.equal(result.width, 300);
  assert.equal(result.case_width, 300);
  assert.equal(result.height, 250);
  assert.equal(result.case_count, 1);
  assert.equal(result.pieces, 3);
  assert.equal(result.chain_direction, undefined, "shared case uses per-piece directions instead of inventing one global direction");
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.chain_direction), ["Sağ", "Sol", "Sağ"]);
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.variant), ["VR390 · Ekru", "VR389 · Bej", "VR400 · Beyaz"]);
  assert.deepEqual(result.accessories.map((option) => option.quantity), [3, 1, 3, 8]);
  assert.deepEqual(result.accessories.map((option) => option.total), [300, 50, 90, 80]);
  assert.equal(result.item_total, 7128);
});

test("separate cases on one room and facade retain each piece and charge case accessories per case", () => {
  const shared = caseLine("ortak");
  const separate = caseLine("ayri");
  assert.equal(separate.case_count, 3);
  assert.equal(separate.pieces, 3);
  assert.equal(separate.quantity, shared.quantity);
  assert.equal(separate.accessories[0].quantity, 3, "case metres are actual total width, not width multiplied by case count again");
  assert.equal(separate.accessories[1].quantity, 3);
  assert.equal(separate.accessories[2].quantity, 3);
  assert.equal(separate.item_total, shared.item_total + 100);
  assert.equal(separate.room_name, "Salon");
  assert.equal(separate.facade, "Kuzey Cephe");
  assert.equal(separate.mechanical_panels.length, 3);
});

test("count repeats the whole arrangement without multiplying case width by piece count", () => {
  const shared = caseLine("ortak", { count: "2" });
  const separate = caseLine("ayri", { count: "2" });
  assert.equal(shared.case_count, 2);
  assert.equal(separate.case_count, 6);
  for (const result of [shared, separate]) {
    assert.equal(result.pieces, 6);
    assert.equal(result.quantity, 16);
    assert.equal(result.material_total, 13216);
    assert.equal(result.accessories[0].quantity, 6);
    assert.equal(result.accessories[2].quantity, 6);
    assert.equal(result.accessories[3].quantity, 16);
  }
});

test("differing piece heights and widths round independently, preserve manufacture data and do not impose a three-piece limit", () => {
  const panels = [
    { width: 155, height: 250, chain_direction: "Sağ" },
    { width: 80, height: 190, chain_direction: "Sol" },
    { width: 120, height: 265, chain_direction: "Sağ" },
    { width: 50, height: 100, chain_direction: "Sol" },
  ];
  const result = caseLine("ortak", { mechanical_panels: panels, extra_indices: [] });
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.billable_area), [4, 2, 3.24, 2]);
  assert.equal(result.quantity, 11.24);
  assert.equal(result.case_width, 405);
  assert.equal(result.height, 265);
  assert.equal(result.mechanical_panels[0].width, 155);
  assert.equal(result.mechanical_panels[0].billable_width, 160);
  assert.equal(result.mechanical_panels[1].height, 190);
  assert.equal(result.mechanical_panels[1].billable_height, 200);
});

test("piece-level validation rejects missing size or direction, while one valid piece may use shared mode", () => {
  for (const panel of [{ width: 0, height: 250, chain_direction: "Sağ" }, { width: 80, height: -1, chain_direction: "Sağ" }, { width: 80, height: 250 }, null]) assert.throws(() => caseLine("ortak", { mechanical_panels: [panel] }));
  assert.throws(() => caseLine("ortak", { mechanical_panels: [] }), /en az bir parça/);
  assert.throws(() => caseLine("ortak", { mechanical_panels: "wrong" }), /Parça ölçülerini/);
  assert.throws(() => caseLine("invalid"), /Kasa düzenini/);
  assert.throws(() => caseLine("ortak", { count: "1.5" }));
  assert.throws(() => caseLine("ortak", { mechanical_panels: Array.from({ length: 1001 }, () => casePanels[0]) }), /Parça ölçülerini/);
  const single = caseLine("ortak", { mechanical_panels: [casePanels[0]] });
  assert.equal(single.pieces, 1);
  assert.equal(single.case_count, 1);
  assert.equal(single.quantity, 2.5);
});

test("piece-level case, VR and directions survive detailed and legacy order restoration", () => {
  for (const mode of ["ortak", "ayri"]) {
    const result = caseLine(mode);
    const payload = salePayload([result], { first_name: "Deneme", last_name: "Müşteri" }, 0, "beklemede", "case-test-key");
    const restored = restoreSaleDraft(payload).cart[0];
    assert.equal(restored.case_mode, mode);
    assert.equal(restored.case_count, mode === "ortak" ? 1 : 3);
    assert.equal(restored.width, 300);
    assert.deepEqual(restored.mechanical_panels, result.mechanical_panels);
    assert.equal(payload.sale_items[0].quantity, 8);
    assert.equal(payload.sale_items[0].width, 300);
    assert.ok(payload.sale_items[0].item_note.includes("3 parça"));
    assert.ok(payload.sale_items[0].item_note.includes("80,00 × 250,00 cm"));
    assert.ok(payload.sale_items[0].item_note.includes("Renk / VR: VR389 · Bej"));
    assert.ok(payload.sale_items[0].item_note.includes("Zincir / ip yönü: Sol"));
    const legacy = restoreSaleDraft({ sale_items: payload.sale_items }).cart[0];
    assert.ok(legacy.item_note.includes("VR390 · Ekru"));
    assert.ok(legacy.item_note.includes("Zincir / ip yönü: Sol"));
  }
});

test("303cm physical profile is optional manufacture metadata while billing stays8m² and3m of case", () => {
  assert.equal(defaultMeasurement(stor).profile_width_cm, "");
  const withoutProfile = caseLine("ortak");
  const withProfile = caseLine("ortak", { profile_width_cm: "303" });
  assert.equal(withoutProfile.profile_width_cm, 0);
  assert.equal(withProfile.profile_width_cm, 303);
  assert.equal(withProfile.case_width, 300);
  assert.equal(withProfile.width, 300);
  assert.equal(withProfile.quantity, 8);
  assert.equal(withProfile.accessories[0].quantity, 3);
  assert.equal(withProfile.item_total, withoutProfile.item_total);
  const payload = salePayload([withProfile], { first_name: "Deneme", last_name: "Müşteri" }, 0, "beklemede", "profile-test-key");
  assert.equal(restoreSaleDraft(payload).cart[0].profile_width_cm, 303);
  assert.equal(payload.sale_items[0].width, 300);
  assert.throws(() => caseLine("ortak", { profile_width_cm: "-1" }), /profil eni/);
  assert.throws(() => caseLine("ortak", { profile_width_cm: "not-a-number" }), /profil eni/);
});

test("left-to-right factory positions stay independent of chain direction and separate cases remain the default", () => {
  assert.equal(defaultMeasurement(stor).case_mode, "ayri");
  const result = caseLine("ortak", { profile_width_cm: "303" });
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.position), ["Sol", "Orta", "Sağ"]);
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.chain_direction), ["Sağ", "Sol", "Sağ"]);
  assert.deepEqual(result.mechanical_panels.map((panel) => panel.label), ["1. Parça", "2. Parça", "3. Parça"]);
  assert.equal(result.quantity, 8);
  assert.equal(result.accessories[0].quantity, 3);
  assert.equal(result.item_total, 7128);
  assert.ok(result.calculation_note.includes("toplam parça eni 300,00 cm"));
  assert.ok(!result.calculation_note.includes("toplam kasa eni"));
  const payload = salePayload([result], { first_name: "Deneme", last_name: "Müşteri" }, 0, "beklemede", "position-test-key");
  assert.ok(payload.sale_items[0].item_note.includes("1. Parça (Sol)"));
  assert.ok(payload.sale_items[0].item_note.includes("2. Parça (Orta)"));
  assert.ok(payload.sale_items[0].item_note.includes("3. Parça (Sağ)"));
  assert.deepEqual(restoreSaleDraft(payload).cart[0].mechanical_panels.map((panel) => panel.position), ["Sol", "Orta", "Sağ"]);
  for (const [count, expected] of [[1, ["Tek parça"]], [2, ["Sol", "Sağ"]], [5, ["Sol", "Orta 1", "Orta 2", "Orta 3", "Sağ"]]]) assert.deepEqual(Array.from({ length: count }, (_, index) => mechanicalPanelPosition(index, count)), expected);
});

test("a single separate case may keep a manual right position independently of its left chain", () => {
  const panel = { width: "80", height: "250", chain_direction: "Sol", variant: "VR390 · Ekru" };
  const automatic = caseLine(defaultMeasurement(stor).case_mode, { mechanical_panels: [panel] });
  const manual = caseLine(defaultMeasurement(stor).case_mode, { mechanical_panels: [{ ...panel, position_override: "Sağ" }] });
  assert.equal(automatic.case_mode, "ayri");
  assert.equal(automatic.mechanical_panels[0].position, "Tek parça");
  assert.equal(automatic.mechanical_panels[0].position_override, "", "automatic position remains automatic when editing");
  assert.equal(manual.mechanical_panels[0].position, "Sağ");
  assert.equal(manual.mechanical_panels[0].position_override, "Sağ");
  assert.equal(manual.mechanical_panels[0].chain_direction, "Sol");
  assert.equal(manual.quantity, automatic.quantity);
  assert.equal(manual.item_total, automatic.item_total);
  const payload = salePayload([manual], { first_name: "Deneme", last_name: "Müşteri" }, 0, "beklemede", "manual-position-test-key");
  const restored = restoreSaleDraft(payload).cart[0].mechanical_panels[0];
  assert.equal(restored.position_override, "Sağ");
  assert.equal(restored.position, "Sağ");
  assert.equal(restored.chain_direction, "Sol");
  assert.ok(payload.sale_items[0].item_note.includes("1. Parça (Sağ)"));
  for (const value of [null, "sol", "Sağ kasa", "Orta 1", "Yukarı"]) assert.throws(() => caseLine("ayri", { mechanical_panels: [{ ...panel, position_override: value }] }), /konumunu seçin/);
});
