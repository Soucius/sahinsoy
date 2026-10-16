import test from "node:test";
import assert from "node:assert/strict";
import { calculateCurtainLine, defaultMeasurement, salePayload } from "./curtainCalculation.js";
import { buildMeasurementRevision, measurementFormForLine } from "../../../backend/src/libs/orderMeasurement.js";

const product = { _id: "507f1f77bcf86cd799439011", product_name: "Örnek sistem", category_name: "Plise", calculation_type: "m2", sale_price: 100, min_m2: 1, dimension_rounding_cm: 10 };
const calculate = (p, form) => calculateCurtainLine(p, { ...defaultMeasurement(p), ...form });

test("plise minimum area differs from honeycomb and dikey minimum dimensions", () => {
  assert.equal(calculate(product, { width: 95, height: 150 }).quantity, 1.5);
  assert.equal(calculate(product, { width: 40, height: 40, count: 2 }).quantity, 2);
  const bounded = { ...product, min_width_cm: 100, min_height_cm: 200, min_m2: 2 };
  assert.equal(calculate(bounded, { width: 95, height: 150 }).quantity, 2);
  assert.equal(calculate(bounded, { width: 155, height: 205 }).quantity, 3.36);
});

test("fixed rustik set width defaults and cannot be changed into a differently priced size", () => {
  const fixed = { ...product, calculation_type: "adet", category_name: "Rustik", fixed_dimensions: { width_cm: 150, height_cm: 0 }, supplier_unit: "Takım" };
  assert.equal(defaultMeasurement(fixed).width, "150");
  const line = calculate(fixed, { count: 2 });
  assert.equal(line.quantity, 2);
  assert.equal(line.unit_label, "takım");
  assert.equal(line.item_total, 200);
  assert.throws(() => calculate(fixed, { width: 600 }), /sabit ölçülü/);
});

test("motor dimensions are technical constraints, without changing count pricing or billing minimums", () => {
  const motor = { ...product, calculation_type: "adet", category_name: "Motor", currency: "USD", technical_limits: { min_width_cm: 60, max_width_cm: 300, max_m2: 9 } };
  const valid = calculate(motor, { width: 250, height: 300, count: 2, currency_rate: 40 });
  assert.equal(valid.quantity, 2);
  assert.equal(valid.item_total, 8000);
  assert.throws(() => calculate(motor, { width: 301, currency_rate: 40 }), /ölçü sınırının dışında/);
  assert.throws(() => calculate(motor, { width: 50, currency_rate: 40 }), /ölçü sınırının dışında/);
  assert.throws(() => calculate(motor, { width: 300, height: 301, currency_rate: 40 }), /maksimum m²/);
});

test("saved fixed-size and motor bounds stay enforced after a later catalogue change", () => {
  const p = { ...product, calculation_type: "adet", fixed_dimensions: { width_cm: 150, height_cm: 0 }, technical_limits: { max_height_cm: 300 } };
  const line = { ...calculate(p, { height: 260 }), id: "sample-line" };
  const saved = salePayload([line], { first_name: "Deneme", delivery_method: "magaza", payment_method: "Nakit" }, 0, "beklemede", "test-fixed");
  const measurement = measurementFormForLine(line);
  const changed = { ...p, fixed_dimensions: { width_cm: 600, height_cm: 0 }, technical_limits: { max_height_cm: 900 } };
  const revision = (values) => buildMeasurementRevision(saved, { measurements: [{ ...measurement, ...values }] }, [changed]);
  assert.throws(() => revision({ width: 600 }), /sabit ölçülü/);
  assert.throws(() => revision({ height: 301 }), /ölçü sınırının dışında/);
  const result = revision({ height: 280 });
  assert.equal(result.pos_details.cart[0].height, 280);
  assert.deepEqual(result.pos_details.cart[0].pricing_snapshot.fixed_dimensions, p.fixed_dimensions);
});

test("motorized rails use a metre minimum and width increments, not metre-square pricing", () => {
  const rail = { ...product, calculation_type: "mt", category_name: "Motorlu Ray", min_width_cm: 100, dimension_rounding_cm: 10, currency: "EUR" };
  assert.equal(calculate(rail, { width: 55, currency_rate: 50 }).quantity, 1);
  assert.equal(calculate(rail, { width: 155, height: 260, currency_rate: 50 }).quantity, 1.6);
});

test("a new saved order without technical limits does not adopt later catalogue constraints", () => {
  const p = { ...product, calculation_type: "adet", category_name: "Motor" };
  const line = { ...calculate(p, { width: 250 }), id: "unbounded-line" };
  const saved = salePayload([line], {}, 0, "beklemede", "no-limits");
  const updated = { ...p, technical_limits: { max_width_cm: 200 } };
  const result = buildMeasurementRevision(saved, { measurements: [measurementFormForLine(line)] }, [updated]);
  assert.equal(result.pos_details.cart[0].width, 250);
  assert.equal(result.pos_details.cart[0].pricing_snapshot.technical_limits, null);
});
