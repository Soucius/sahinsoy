import test from "node:test";
import assert from "node:assert/strict";
import { calculateCurtainLine, defaultMeasurement, paymentConversion, restoreSaleDraft, salePayload } from "./curtainCalculation.js";
import { createCustomerOrderHtml, createManufacturingHtml } from "./curtainPrint.js";
import { normalizeSale } from "../../../backend/src/libs/sale-validation.js";
import { buildMeasurementRevision, measurementFormForLine } from "../../../backend/src/libs/orderMeasurement.js";

const quote = { payment_currency: "EUR", payment_currency_rate: "50", payment_rate_mode: "automatic", payment_rate_source: "Harem", payment_rate_type: "Buying", payment_rate_date: "2026-10-16", payment_rate_fetched_at: "2026-10-16T09:24:53.000Z", payment_rate_quoted_at: "2026-10-16T09:24:49.000Z" };
const header = { first_name: "Deneme", last_name: "Müşteri", delivery_method: "magaza", delivery_date: "2026-10-20", payment_method: "Nakit", ...quote };
const product = { _id: "507f1f77bcf86cd799439011", product_name: "Örnek ürün", calculation_type: "adet", sale_price: 30000, currency: "TRY", stock_tracking: false };
const line = { ...calculateCurtainLine(product, defaultMeasurement(product)), id: "test-line" };
const saved = (overrides = {}) => ({ _id: "507f1f77bcf86cd799439099", ...salePayload([line], { ...header, ...overrides }, 10, "beklemede", "conversion-example") });

test("TL stays the accounting total while EUR and USD equivalents divide by their selected buying rate", () => {
  for (const payment_currency of ["EUR", "USD"]) {
    const result = paymentConversion(30000, { ...quote, payment_currency });
    assert.equal(result.total_tl, 30000);
    assert.equal(result.amount, 600);
    assert.equal(result.rate, 50);
    assert.equal(result.rate_source, "Harem");
    assert.equal(result.quoted_at, quote.payment_rate_quoted_at);
  }
  assert.deepEqual(paymentConversion(30000), { currency: "TRY", rate: 1, amount: 30000, total_tl: 30000 });
});

test("manual rate accepts decimal comma, rounds the equivalent to cents and clears automatic provenance", () => {
  const result = paymentConversion(30000, { ...quote, payment_rate_mode: "manual", payment_currency_rate: "49,9" });
  assert.equal(result.amount, 601.2);
  assert.equal(result.rate_source, "manual");
  for (const key of ["rate_type", "rate_date", "fetched_at", "quoted_at"]) assert.equal(result[key], null);
});

test("missing, zero, negative, nonfinite or overflowing payment rates cannot produce a displayed or saved equivalent", () => {
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1e-30"]) assert.throws(() => paymentConversion(30000, { ...quote, payment_currency_rate: value }));
  assert.throws(() => paymentConversion(-1, quote));
  assert.throws(() => paymentConversion(30000, { ...quote, payment_currency: "GBP" }));
});

test("automatic payment conversion requires Harem buying provenance, valid date and both timestamps", () => {
  for (const overrides of [{ payment_rate_source: "TCMB" }, { payment_rate_type: "Selling" }, { payment_rate_date: "2026-02-30" }, { payment_rate_quoted_at: "" }, { payment_rate_fetched_at: "yesterday" }, { payment_rate_mode: "other" }]) {
    assert.throws(() => paymentConversion(30000, { ...quote, ...overrides }));
  }
});

test("discount is applied in TL first; saving and reopening retain the exact payment rate and quote time", () => {
  const record = saved();
  assert.equal(record.grand_total, 27000);
  assert.equal(record.pos_details.payment_conversion.amount, 540);
  const restored = restoreSaleDraft(JSON.parse(JSON.stringify(record)));
  for (const [key, value] of Object.entries(quote)) assert.equal(restored.header[key], value);
  assert.deepEqual(paymentConversion(record.grand_total, restored.header), record.pos_details.payment_conversion);
});

test("backend recomputes an untrusted converted amount using validated TL total instead of accepting the submitted counterpart", () => {
  const input = saved();
  input.pos_details.payment_conversion.amount = 1;
  const result = normalizeSale(input);
  assert.equal(result.grand_total, 27000);
  assert.equal(result.pos_details.payment_conversion.amount, 540);
  assert.equal(input.pos_details.payment_conversion.amount, 1, "validation does not mutate submitted data");
  input.pos_details.header.payment_currency_rate = "0";
  assert.throws(() => normalizeSale(input), /ödeme kuru/);
});

test("returning to TRY removes a previously selected foreign conversion from normalized data", () => {
  const input = saved();
  input.pos_details.header.payment_currency = "TRY";
  assert.equal(Object.hasOwn(normalizeSale(input).pos_details, "payment_conversion"), false);
});

test("editing a saved order preserves an existing payment fee in both TL total and foreign equivalent", () => {
  const record = salePayload([line], header, 10, "beklemede", "existing-fee", 300);
  assert.equal(record.credit_card_fee, 300);
  assert.equal(record.grand_total, 27300);
  assert.equal(record.pos_details.payment_conversion.amount, 546);
  assert.equal(normalizeSale(record).pos_details.payment_conversion.amount, 546);
  assert.equal(salePayload([line], header, 10, "beklemede", "new-order").credit_card_fee, 0);
  assert.throws(() => salePayload([line], header, 10, "beklemede", "negative-fee", -1), /ödeme farkı/);
});

test("measurement revision updates the foreign equivalent using the saved payment rate and keeps product prices in TL", () => {
  const textile = { ...product, product_category: { category_name: "Tül" }, calculation_type: "mt", sale_price: 500 };
  const item = { ...calculateCurtainLine(textile, { ...defaultMeasurement(textile), width: "400", height: "260" }), id: "measure-line" };
  const record = { _id: "507f1f77bcf86cd799439099", ...salePayload([item], header, 0, "tamamlandi", "measurement-conversion") };
  const revised = buildMeasurementRevision(record, { measurements: [{ ...measurementFormForLine(item), width: "420" }] });
  assert.equal(record.grand_total, 6200);
  assert.equal(revised.grand_total, 6500);
  assert.equal(revised.pos_details.payment_conversion.amount, 130);
  assert.equal(revised.pos_details.payment_conversion.rate, 50);
  assert.equal(revised.pos_details.payment_conversion.quoted_at, quote.payment_rate_quoted_at);
  assert.equal(revised.pos_details.cart[0].base_unit_price, 500);
});

test("customer paper contains TL total, foreign equivalent, buying rate and its time; factory paper has no payment detail", () => {
  const record = saved();
  const customer = createCustomerOrderHtml(record);
  assert.ok(customer.includes("Döviz ödeme karşılığı"));
  assert.ok(customer.includes("540,00"));
  assert.ok(customer.includes("27.000,00"));
  assert.ok(customer.includes("Harem alış kuru"));
  assert.ok(customer.includes("12:24:49"));
  assert.ok(customer.includes("Tahsilat makbuzu değildir"));
  const factory = createManufacturingHtml(record);
  assert.ok(!factory.includes("Döviz ödeme karşılığı"));
  assert.ok(!factory.includes("Harem alış kuru"));
  const local = createCustomerOrderHtml(saved({ payment_currency: "TRY" }));
  assert.ok(!local.includes("Döviz ödeme karşılığı"));
});
