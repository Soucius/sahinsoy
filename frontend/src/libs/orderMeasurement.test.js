import test from "node:test";
import assert from "node:assert/strict";
import { buildMeasurementRevision, measurementFormForLine, measurementSummary } from "../../../backend/src/libs/orderMeasurement.js";
import { calculateCurtainLine, defaultMeasurement, salePayload } from "./curtainCalculation.js";
import { normalizeSale } from "../../../backend/src/libs/sale-validation.js";

const textile = { _id: "507f1f77bcf86cd799439011", product_name: "Örnek Tül", product_category: { category_name: "Tül" }, product_brand: { brand_name: "Laferra" }, calculation_type: "mt", sale_price: 550, stock_quantity: 32, stock_tracking: true };
const fon = { ...textile, _id: "507f1f77bcf86cd799439012", product_name: "Örnek Fon", product_category: { category_name: "Fon" } };
const stor = { ...textile, _id: "507f1f77bcf86cd799439013", product_name: "OBA Stor", product_category: { category_name: "Stor" }, calculation_type: "m2", sale_price: 100, min_width_cm: 100, min_height_cm: 200, dimension_rounding_cm: 10, min_m2: 2, rounding_step: 0 };
const header = { first_name: "Deneme", last_name: "Müşteri", customer_phone: "05000000001", customer_address: "Örnek adres", delivery_date: "2026-10-20", delivery_method: "montaj", payment_method: "Nakit" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const ruleFields = ["min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm"];

function line(product, overrides = {}, id = "line-1") {
  const form = { ...defaultMeasurement(product), width: "400", height: "260", labor_price: "90", ...overrides };
  const result = { ...calculateCurtainLine(product, form), id };
  result.pricing_snapshot = {
    ...Object.fromEntries(ruleFields.map((key) => [key, product[key] || 0])),
    extra_options: form.extra_indices.map((index) => ({ option_name: product.extra_options[index].option_name, pricing_basis: product.extra_options[index].pricing_basis || product.extra_options[index].calculation_type || "birim", pricing_scope: product.extra_options[index].pricing_scope || "parca" })),
  };
  return result;
}

function sale(cart, discount = 0) {
  const result = { _id: "507f1f77bcf86cd799439099", ...salePayload(cart, header, discount, "tamamlandi", "measurement-example"), approved_at: "2026-10-09T12:00:00.000Z", deposit_amount: 1000 };
  result.sale_items.forEach((item, index) => { item._id = `sale-item-${index}`; item.is_ordered = index === 0; });
  result.pos_details.saved_deposit = 1000;
  result.pos_details.measurement_status = "on_olcu";
  return result;
}

const revise = (saved, edits = {}, products = []) => buildMeasurementRevision(saved, { measurements: saved.pos_details.cart.map((item) => ({ ...measurementFormForLine(item), ...(edits[item.id] || {}) })) }, products);

test("400 → 420 cm recalculates 12.80 → 13.40 m at saved product/labor prices and the same discount/fee", () => {
  const saved = sale([line(textile, { count: "2" })], 10);
  saved.credit_card_fee = 25;
  const revised = revise(saved, { "line-1": { width: "420" } });
  const updated = revised.pos_details.cart[0];
  assert.equal(saved.pos_details.cart[0].quantity, 12.8);
  assert.equal(updated.quantity, 13.4);
  assert.equal(updated.material_total, 7370);
  assert.equal(updated.labor_total, 1206);
  assert.equal(updated.base_unit_price, 550);
  assert.equal(updated.labor_unit_price, 90);
  assert.equal(updated.panels[0].cut_width, 670);
  assert.equal(revised.sub_total, 8576);
  assert.equal(revised.discount_percent, 10);
  assert.equal(revised.discount_amount, 857.6);
  assert.equal(revised.credit_card_fee, 25);
  assert.equal(revised.grand_total, 7743.4);
  assert.deepEqual(revised.pos_details.header, saved.pos_details.header);
  assert.equal(revised.pos_details.saved_deposit, 1000);
  assert.equal(revised.pos_details.measurement_status, "on_olcu");
  assert.ok(!("deposit_amount" in revised), "payments are outside the measurement mutation");
  assert.doesNotThrow(() => normalizeSale({ ...saved, ...revised }));
});

test("textile height-only revisions update manufacturing dimensions without changing price or quantity", () => {
  const saved = sale([line(textile, { count: "2" })]);
  const revised = revise(saved, { "line-1": { height: "275,5" } });
  assert.equal(revised.pos_details.cart[0].height, 275.5);
  assert.equal(revised.pos_details.cart[0].panels[0].height, 275.5);
  assert.equal(revised.pos_details.cart[0].quantity, 12.8);
  assert.equal(revised.grand_total, saved.grand_total);
});

test("fon takım exposes both wings and allows different measured widths/heights without changing set count", () => {
  const saved = sale([line(fon, { width: "80", height: "260", count: "2", order_mode: "takim" })]);
  assert.deepEqual(measurementFormForLine(saved.pos_details.cart[0]), { line_id: "line-1", width: 80, height: 260, right_width: 80, right_height: 260 });
  const revised = revise(saved, { "line-1": { width: 85, height: 270, right_width: 70, right_height: 255 } });
  const item = revised.pos_details.cart[0];
  assert.equal(item.quantity, 10.9);
  assert.equal(item.count, 2);
  assert.equal(item.pieces, 4);
  assert.equal(item.order_mode, "takim");
  assert.deepEqual(item.panels.map((panel) => [panel.width, panel.height, panel.cut_width]), [[85, 270, 295], [70, 255, 250]]);
  assert.equal(item.item_total, 6976);
  assert.match(measurementSummary(item), /Sol: 85,00 × 270,00 cm.*Sağ: 70,00 × 255,00 cm/);
});

test("odd-count single fon retains seven separate wings and textile seam allowance", () => {
  const saved = sale([line(fon, { width: "80", count: "7", order_mode: "adet" })]);
  const revised = revise(saved, { "line-1": { width: 70 } });
  assert.equal(revised.pos_details.cart[0].quantity, 17.5);
  assert.equal(revised.pos_details.cart[0].pieces, 7);
  assert.ok(!("right_width" in measurementFormForLine(saved.pos_details.cart[0])));
});

test("shared case separately bills each panel and uses actual total width for accessories", () => {
  const product = { ...stor, extra_options: [
    { option_name: "Kasa farkı", pricing_basis: "mt", pricing_scope: "kasa", price_impact: 10 },
    { option_name: "Kasa redüktör", pricing_basis: "adet", pricing_scope: "kasa", price_impact: 20 },
    { option_name: "Parça etek", pricing_basis: "adet", pricing_scope: "parca", price_impact: 30 },
    { option_name: "Oyma", pricing_basis: "m2", price_impact: 5 },
    { option_name: "Eğimli fark", pricing_basis: "yuzde", price_impact: 10 },
  ] };
  const original = line(product, { case_mode: "ortak", profile_width_cm: "303", variant: "VR-1 Ekru", extra_indices: [0, 1, 2, 3, 4], mechanical_panels: [
    { width: "80", height: "250", chain_direction: "Sağ", position_override: "Sol", variant: "VR-1 Ekru" },
    { width: "120", height: "250", chain_direction: "Sol", position_override: "Orta", variant: "VR-2 Beyaz" },
    { width: "100", height: "250", chain_direction: "Sağ", position_override: "Sağ", variant: "VR-3 Krem" },
  ] });
  const saved = sale([original]);
  const revised = revise(saved, { "line-1": { mechanical_panels: [{ width: 80, height: 250 }, { width: 155, height: 250 }, { width: 100, height: 250 }], profile_width_cm: 343 } });
  const item = revised.pos_details.cart[0];
  assert.equal(original.quantity, 8);
  assert.equal(item.quantity, 9);
  assert.equal(item.width, 335);
  assert.equal(item.profile_width_cm, 343);
  assert.equal(item.case_count, 1);
  assert.equal(item.pieces, 3);
  assert.deepEqual(item.mechanical_panels.map((panel) => panel.billable_area), [2.5, 4, 2.5]);
  assert.deepEqual(item.accessories.map((option) => option.quantity), [3.35, 1, 3, 9, 10]);
  assert.deepEqual(item.accessories.map((option) => option.total), [33.5, 20, 90, 45, 90]);
  assert.equal(item.item_total, 1178.5);
  assert.deepEqual(item.mechanical_panels.map((panel) => [panel.variant, panel.chain_direction, panel.position]), original.mechanical_panels.map((panel) => [panel.variant, panel.chain_direction, panel.position]));
  assert.match(revised.sale_items[0].item_note, /155,00 × 250,00 cm.*VR-2 Beyaz.*Sol/);
});

test("separate cases preserve their arrangement and use case/piece accessory scope for repeated arrangements", () => {
  const product = { ...stor, extra_options: [{ option_name: "Kasa aparat", pricing_basis: "adet", pricing_scope: "kasa", price_impact: 20 }] };
  const saved = sale([line(product, { count: "2", case_mode: "ayri", extra_indices: [0], mechanical_panels: [{ width: "80", height: "250", chain_direction: "Sağ" }, { width: "120", height: "250", chain_direction: "Sol" }] })]);
  const item = revise(saved, { "line-1": { mechanical_panels: [{ width: 90, height: 250 }, { width: 130, height: 250 }] } }).pos_details.cart[0];
  assert.equal(item.quantity, 11.5);
  assert.equal(item.count, 2);
  assert.equal(item.pieces, 4);
  assert.equal(item.case_count, 4);
  assert.equal(item.accessories[0].quantity, 4);
});

test("optional shared profile width may be cleared without changing real-width accessory billing", () => {
  const product = { ...stor, extra_options: [{ option_name: "Kasa farkı", pricing_basis: "mt", price_impact: 10 }] };
  const saved = sale([line(product, { case_mode: "ortak", profile_width_cm: 303, extra_indices: [0], mechanical_panels: [{ width: 80, height: 250, chain_direction: "Sağ" }, { width: 120, height: 250, chain_direction: "Sol" }] })]);
  const updated = revise(saved, { "line-1": { profile_width_cm: "" } }).pos_details.cart[0];
  assert.equal(updated.profile_width_cm, 0);
  assert.equal(updated.width, 200);
  assert.equal(updated.accessories[0].quantity, 2);
  assert.equal(updated.accessories[0].total, 20);
});

test("catalogue price, accessory price, stock and rule changes do not override a saved snapshot", () => {
  const product = { ...stor, extra_options: [{ option_name: "Etek çıtası", pricing_basis: "mt", price_impact: 10 }] };
  const saved = sale([line(product, { width: "155", height: "250", chain_direction: "Sağ", extra_indices: [0] })]);
  const changedCatalog = { ...product, sale_price: 99999, stock_quantity: 1, stock_tracking: false, purchase_price: 999999, min_width_cm: 0, min_height_cm: 0, min_m2: 0, dimension_rounding_cm: 0, extra_options: [{ ...product.extra_options[0], price_impact: 99999, pricing_basis: "adet" }] };
  const updated = revise(saved, { "line-1": { width: 156 } }, [changedCatalog]).pos_details.cart[0];
  assert.equal(updated.quantity, 4);
  assert.equal(updated.base_unit_price, 100);
  assert.equal(updated.accessories[0].unit_price, 10);
  assert.equal(updated.accessories[0].quantity, 1.56);
  assert.equal(updated.stock_available, saved.pos_details.cart[0].stock_available);
  assert.equal(updated.stock_tracked, true);
  assert.ok(!JSON.stringify(updated).includes("999999"));
});

test("foreign prices keep the saved FX rate and saved TL accessory unit price", () => {
  const product = { ...stor, currency: "USD", sale_price: 25, extra_options: [{ option_name: "USD aksesuar", pricing_basis: "mt", currency: "USD", price_impact: 7 }] };
  const saved = sale([line(product, { width: "155", height: "250", chain_direction: "Sol", currency_rate: "40", extra_indices: [0] })]);
  const item = revise(saved, { "line-1": { width: 165 } }, [{ ...product, sale_price: 90, currency: "EUR" }]).pos_details.cart[0];
  assert.equal(item.quantity, 4.25);
  assert.equal(item.material_total, 4250);
  assert.equal(item.original_currency, "USD");
  assert.equal(item.original_unit_price, 25);
  assert.equal(item.currency_rate, 40);
  assert.equal(item.accessories[0].unit_price, 280);
  assert.equal(item.accessories[0].total, 462);
});

test("legacy missing rules/options resolve from matching catalogue metadata while saved prices remain fixed", () => {
  const product = { ...stor, extra_options: [{ option_name: "Kasa redüktör", pricing_basis: "adet", pricing_scope: "kasa", price_impact: 20 }] };
  const original = line(product, { case_mode: "ortak", profile_width_cm: 303, extra_indices: [0], mechanical_panels: [{ width: 80, height: 250, chain_direction: "Sol" }, { width: 120, height: 250, chain_direction: "Sağ" }] });
  delete original.pricing_snapshot;
  original.accessories.forEach((item) => { delete item.pricing_basis; delete item.pricing_scope; });
  const saved = sale([original]);
  const catalog = { ...product, sale_price: 99999, extra_options: [{ ...product.extra_options[0], price_impact: 99999 }] };
  const item = revise(saved, { "line-1": { mechanical_panels: [{ width: 80, height: 250 }, { width: 155, height: 250 }] } }, [catalog]).pos_details.cart[0];
  assert.equal(item.quantity, 6.5);
  assert.equal(item.base_unit_price, 100);
  assert.equal(item.accessories[0].unit_price, 20);
  assert.equal(item.accessories[0].quantity, 1);
  assert.equal(item.pricing_snapshot.min_width_cm, 100);
  assert.equal(item.pricing_snapshot.extra_options[0].pricing_scope, "kasa");
  assert.equal(revise({ ...saved, pos_details: { ...saved.pos_details, cart: [item] } }, {}, []).grand_total, item.item_total, "resolved rules are frozen for future revisions");
});

test("unresolved legacy mechanical rules and accessory scope reject instead of guessing", () => {
  const item = line(stor, { width: 155, height: 250, chain_direction: "Sağ" });
  delete item.pricing_snapshot;
  assert.throws(() => revise(sale([item])), /minimum \/ yuvarlama kuralları/);
  const withExtra = line({ ...textile, extra_options: [{ option_name: "Aksesuar", pricing_basis: "adet", price_impact: 10 }] }, { extra_indices: [0] });
  delete withExtra.pricing_snapshot;
  delete withExtra.accessories[0].pricing_basis;
  delete withExtra.accessories[0].pricing_scope;
  assert.throws(() => revise(sale([withExtra])), /yöntemi \/ kapsamı/);
  assert.throws(() => revise(sale([withExtra]), {}, [{ ...textile, extra_options: [{ option_name: "Aksesuar", pricing_basis: "adet", price_impact: 10 }, { option_name: "Aksesuar", pricing_basis: "mt", price_impact: 10 }] }]), /yöntemi \/ kapsamı/);
});

test("saved explicit accessory metadata works without consulting current catalogue option names/prices", () => {
  const item = line({ ...textile, extra_options: [{ option_name: "Aksesuar", pricing_basis: "adet", pricing_scope: "parca", price_impact: 10 }] }, { count: 2, extra_indices: [0] });
  delete item.pricing_snapshot;
  Object.assign(item.accessories[0], { pricing_basis: "adet", pricing_scope: "parca" });
  const updated = revise(sale([item]), { "line-1": { width: 420 } }).pos_details.cart[0];
  assert.equal(updated.accessories[0].quantity, 2);
  assert.equal(updated.accessories[0].unit_price, 10);
  assert.equal(updated.quantity, 13.4);
});

test("measurement-only request rejects price, FX, count, pleat, VR, chain and case-mode injections", () => {
  const saved = sale([line(textile)]);
  for (const [key, value] of Object.entries({ unit_price: 1, sale_price: 1, labor_price: 1, currency_rate: 99, count: 2, pleat_id: "seyrek", variant: "NEW-VR", chain_direction: "Sol", case_mode: "ortak", separate_right: false, item_note: "changed" })) assert.throws(() => revise(saved, { "line-1": { [key]: value } }), /izin verilen ölçü/);
  assert.throws(() => buildMeasurementRevision(saved, { measurements: [measurementFormForLine(saved.pos_details.cart[0])], grand_total: 1 }), /izin verilen ölçü/);
});

test("panel count changes and panel metadata injections are rejected", () => {
  const saved = sale([line(stor, { case_mode: "ortak", mechanical_panels: [{ width: 80, height: 250, chain_direction: "Sağ" }, { width: 120, height: 250, chain_direction: "Sol" }] })]);
  for (const panels of [[], [{ width: 80, height: 250 }], [{ width: 80, height: 250 }, { width: 120, height: 250 }, { width: 100, height: 250 }]]) assert.throws(() => revise(saved, { "line-1": { mechanical_panels: panels } }), /parça sayısı/);
  for (const injected of ["variant", "chain_direction", "position_override", "billable_area"]) assert.throws(() => revise(saved, { "line-1": { mechanical_panels: [{ width: 80, height: 250, [injected]: "changed" }, { width: 120, height: 250 }] } }), /izin verilen ölçü/);
});

test("line identity/count must match and stale sale/product index mismatch is rejected", () => {
  const saved = sale([line(textile, {}, "line-1"), line(fon, { width: 80 }, "line-2")]);
  const forms = saved.pos_details.cart.map(measurementFormForLine);
  for (const measurements of [[forms[0]], [...forms, forms[0]], [forms[0], forms[0]], [forms[0], { ...forms[1], line_id: "unknown" }]]) assert.throws(() => buildMeasurementRevision(saved, { measurements }));
  saved.sale_items[0].product = "507f1f77bcf86cd799439098";
  assert.throws(() => buildMeasurementRevision(saved, { measurements: forms }), /POS ölçü kayıtları eşleşmiyor/);
});

test("reordered DTOs retain original sale item IDs/order and manufacturing flags", () => {
  const saved = sale([line(textile, {}, "line-1"), line(fon, { width: 80 }, "line-2")]);
  const result = buildMeasurementRevision(saved, { measurements: saved.pos_details.cart.map(measurementFormForLine).reverse() });
  assert.deepEqual(result.pos_details.cart.map((item) => item.id), ["line-1", "line-2"]);
  assert.deepEqual(result.sale_items.map((item) => [item._id, item.is_ordered]), [["sale-item-0", true], ["sale-item-1", false]]);
});

test("legacy orders without detailed POS cart fail with an explanatory message", () => {
  assert.throws(() => buildMeasurementRevision({ sale_items: [] }, { measurements: [] }), /ayrıntılı POS ölçü kaydı/);
  const saved = sale([line(textile)]);
  delete saved.pos_details.cart[0].id;
  assert.throws(() => revise(saved), /ölçü ayrıntıları eksik/);
});

test("invalid, missing, non-positive or overflowing dimensions cannot create NaN/Infinity totals", () => {
  const saved = sale([line(textile)]);
  for (const value of [null, false, [], {}, "", "  ", 0, -1, Infinity, "not a number"]) assert.throws(() => revise(saved, { "line-1": { width: value } }));
  assert.throws(() => revise(saved, { "line-1": { width: 1e308 } }), /sayı aralığını/);
  const form = measurementFormForLine(saved.pos_details.cart[0]);
  delete form.height;
  assert.throws(() => buildMeasurementRevision(saved, { measurements: [form] }), /bütün ölçü alanlarını/);
});

test("corrupt saved pleat, count, FX or prices reject rather than silently changing original terms", () => {
  const saved = sale([line(textile)]);
  for (const edits of [{ pleat_factor: 9 }, { count: 2.5 }, { original_unit_price: -1 }, { labor_unit_price: -1 }]) {
    const corrupt = clone(saved);
    Object.assign(corrupt.pos_details.cart[0], edits);
    assert.throws(() => revise(corrupt));
  }
  const foreign = sale([line({ ...textile, currency: "USD" }, { currency_rate: 40 })]);
  foreign.pos_details.cart[0].currency_rate = 0;
  assert.throws(() => revise(foreign), /döviz kuru/);
});

test("pure revision does not mutate the original order, incoming forms or fallback catalogue", () => {
  const saved = sale([line(stor, { width: 155, height: 250, chain_direction: "Sağ" })]);
  const input = { measurements: [{ ...measurementFormForLine(saved.pos_details.cart[0]), width: 165 }] };
  const products = [clone(stor)];
  const before = JSON.stringify([saved, input, products]);
  buildMeasurementRevision(saved, input, products);
  assert.equal(JSON.stringify([saved, input, products]), before);
});

test("mechanical metre accessories distinguish real width from rounded product quantity", () => {
  const rail = { ...stor, calculation_type: "mt", product_category: { category_name: "Ray" }, sale_price: 100, extra_options: [{ option_name: "Birim fark", pricing_basis: "birim", price_impact: 5 }, { option_name: "Gerçek en fark", pricing_basis: "mt", price_impact: 5 }] };
  const saved = sale([line(rail, { width: 155, height: 0, extra_indices: [0, 1] })]);
  const item = revise(saved, { "line-1": { width: 156 } }).pos_details.cart[0];
  assert.equal(item.quantity, 1.6);
  assert.deepEqual(item.accessories.map((option) => [option.quantity, option.total]), [[1.6, 8], [1.56, 7.8]]);
});

test("unit-priced motors allow optional zero dimensions but retain original count/FX pricing", () => {
  const motor = { ...textile, calculation_type: "adet", product_category: { category_name: "Motor" }, currency: "EUR", sale_price: 100 };
  const saved = sale([line(motor, { width: 0, height: 0, count: 2, currency_rate: 45 })]);
  const revised = revise(saved, { "line-1": { width: 100, height: 200 } });
  assert.equal(revised.pos_details.cart[0].quantity, 2);
  assert.equal(revised.grand_total, 9000);
  assert.equal(revised.sale_items[0].width, 100);
});
