import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { importCatalog, normalizeCatalog } from "../controllers/catalog.controller.js";
import Product from "../models/Product.js";
import Brand from "../models/Brand.js";
import Category from "../models/Category.js";
import Unit from "../models/Unit.js";
import Role from "../models/Role.js";

const record = (overrides = {}) => ({ catalog_id: "URUN-20001", name: " MA Serisi ", brand: "Oba Perdesan", category: "Stor", unit: "Metrekare", sale_price: 826, purchase_price: 295, currency: "TRY", min_width_cm: 100, min_height_cm: 200, dimension_rounding_cm: 10, min_m2: 2, extra_options: [{ option_name: " Stor etek oyma ", pricing_basis: "m2", currency: "TRY", price_impact: 84 }], ...overrides });
const response = () => ({ statusCode: 0, body: null, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

function mockDatabase(t, { upsertedCount = 1 } = {}) {
  const previousName = mongoose.connection.name;
  mongoose.connection.name = "sahinsoy_test";
  t.after(() => { mongoose.connection.name = previousName; });
  const calls = { start: 0, transaction: 0, end: 0, operations: [], options: null, related: [] };
  t.mock.method(Role, "findById", async () => ({ role_name: "Test Yöneticisi" }));
  const session = { async withTransaction(callback) { calls.transaction++; await callback(); }, async endSession() { calls.end++; } };
  t.mock.method(mongoose, "startSession", async () => { calls.start++; return session; });
  for (const [model, key] of [[Brand, "brand_name"], [Category, "category_name"], [Unit, "unit_name"]]) t.mock.method(model, "findOneAndUpdate", async (filter, update, options) => { calls.related.push({ filter, update, options }); return { _id: `${key}:${filter[key]}` }; });
  t.mock.method(Product, "bulkWrite", async (operations, options) => { calls.operations = operations; calls.options = options; return { upsertedCount }; });
  return calls;
}

test("normalization retains mechanical rules, trimmed options and legacy textile defaults", () => {
  const [mechanical, legacy] = normalizeCatalog([record(), record({ catalog_id: "URUN-0001", name: "Tül", unit: "Metre", min_width_cm: undefined, min_height_cm: undefined, dimension_rounding_cm: undefined, min_m2: undefined, extra_options: undefined })]);
  assert.equal(mechanical.name, "MA Serisi");
  assert.equal(mechanical.min_width_cm, 100);
  assert.equal(mechanical.min_height_cm, 200);
  assert.equal(mechanical.dimension_rounding_cm, 10);
  assert.equal(mechanical.extra_options[0].option_name, "Stor etek oyma");
  assert.equal(mechanical.extra_options[0].pricing_scope, "parca");
  assert.equal(legacy.dimension_rounding_cm, 0);
  assert.deepEqual(legacy.extra_options, []);
});

test("invalid dimensions, option bases, prices, duplicate identities and incompatible currencies reject the whole catalog", () => {
  for (const field of ["min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm", "width_cm", "grammage_gr"]) for (const value of [-1, NaN, Infinity, null, "10"]) assert.throws(() => normalizeCatalog([record({ [field]: value })]));
  for (const options of [null, {}, [{ option_name: " ", price_impact: 0 }], [{ option_name: "Kasa", price_impact: -1 }], [{ option_name: "Kasa", price_impact: 1, pricing_basis: "unknown" }], [{ option_name: "Kasa", price_impact: 1, currency: "USD" }], [{ option_name: "Kasa", price_impact: 1 }, { option_name: " kasa ", price_impact: 2 }]]) assert.throws(() => normalizeCatalog([record({ extra_options: options })]));
  assert.throws(() => normalizeCatalog([record(), record()]));
  assert.throws(() => normalizeCatalog([record({ unit: "Adet" })]));
  assert.throws(() => normalizeCatalog([record({ currency: "USD", extra_options: [{ option_name: "EUR fark", price_impact: 1, currency: "EUR" }] })]));
});

test("foreign motor and percentage surcharge keep currency and percentage rather than multiplying them", () => {
  const [motor] = normalizeCatalog([record({ unit: "Adet", currency: "USD", sale_price: 280, purchase_price: 100, min_width_cm: 0, min_height_cm: 0, dimension_rounding_cm: 0, min_m2: 0, extra_options: [{ option_name: "TL fark", price_impact: 10, currency: "TRY", pricing_basis: "adet" }] })]);
  assert.equal(motor.currency, "USD");
  assert.equal(motor.extra_options[0].currency, "TRY");
  const [percent] = normalizeCatalog([record({ extra_options: [{ option_name: "Karışık renk", price_impact: 10, currency: "TRY", pricing_basis: "yuzde" }, { option_name: "Eğimli perde", price_impact: 100, currency: "TRY", pricing_basis: "yuzde" }] })]);
  assert.deepEqual(percent.extra_options.map((option) => option.price_impact), [10, 100]);
  assert.throws(() => normalizeCatalog([record({ extra_options: [{ option_name: "Fark", price_impact: 101, currency: "TRY", pricing_basis: "yuzde" }] })]));
  assert.throws(() => normalizeCatalog([record({ currency: "USD", extra_options: [{ option_name: "Fark", price_impact: 10, currency: "USD", pricing_basis: "yuzde" }] })]));
});

test("supplier units, width-only sets and technical limits stay separate from billing rules", () => {
  const limits = { min_width_cm: 50, min_height_cm: 50, max_width_cm: 245, max_height_cm: 300, max_m2: 7, max_load_kg: 40, tube_diameter_mm: 47, slat_width_mm: 25 };
  const [set] = normalizeCatalog([record({ unit: "Adet", supplier_unit: " Takım ", fixed_dimensions: { width_cm: 200 }, technical_limits: limits, min_width_cm: 0, min_height_cm: 0, min_m2: 0, dimension_rounding_cm: 0 })]);
  assert.equal(set.supplier_unit, "Takım");
  assert.deepEqual(set.fixed_dimensions, { width_cm: 200, height_cm: 0 });
  assert.deepEqual(set.technical_limits, limits);
  assert.equal(set.min_width_cm, 0, "technical operating minima must not become billable minima");
  assert.equal(set.min_height_cm, 0);
  assert.equal(set.width_cm, 0, "fixed set width must not become textile fabric width");
  const [equalLimits] = normalizeCatalog([record({ technical_limits: { min_width_cm: 50, max_width_cm: 50, min_height_cm: 100, max_height_cm: 100 } })]);
  assert.equal(equalLimits.technical_limits.max_width_cm, 50);
  const [heightOnly] = normalizeCatalog([record({ fixed_dimensions: { height_cm: 150 } })]);
  assert.deepEqual(heightOnly.fixed_dimensions, { width_cm: 0, height_cm: 150 });
  const [legacy] = normalizeCatalog([record()]);
  for (const field of ["supplier_unit", "fixed_dimensions", "technical_limits"]) assert.equal(Object.hasOwn(legacy, field), false);
});

test("malformed supplier metadata rejects unknown keys, invalid numbers and inverted technical limits", () => {
  for (const supplier_unit of [null, 1, true, {}, [], "", " ", "x".repeat(200)]) assert.throws(() => normalizeCatalog([record({ supplier_unit })]));
  for (const fixed_dimensions of [null, 1, [], {}, { width_cm: 0, height_cm: 0 }, { width_cm: 100, extra: 1 }]) assert.throws(() => normalizeCatalog([record({ fixed_dimensions })]));
  for (const field of ["width_cm", "height_cm"]) for (const value of [-1, NaN, Infinity, null, "100", true]) assert.throws(() => normalizeCatalog([record({ fixed_dimensions: { width_cm: 100, [field]: value } })]));
  for (const technical_limits of [null, 1, [], {}, { max_width_cm: 200, arbitrary: 1 }, { min_width_cm: 201, max_width_cm: 200 }, { min_height_cm: 301, max_height_cm: 300 }]) assert.throws(() => normalizeCatalog([record({ technical_limits })]));
  for (const field of ["min_width_cm", "min_height_cm", "max_width_cm", "max_height_cm", "max_m2", "max_load_kg", "tube_diameter_mm", "slat_width_mm"]) {
    for (const value of [0, -1, NaN, Infinity, null, "100", true, undefined]) assert.throws(() => normalizeCatalog([record({ technical_limits: { [field]: value } })]));
  }
});

test("Product model preserves typed supplier metadata without generated nested IDs and rejects invalid limits", () => {
  const product = (metadata = {}) => new Product({ product_name: "Set", product_category: "507f1f77bcf86cd799439011", product_brand: "507f1f77bcf86cd799439012", product_unit: "507f1f77bcf86cd799439013", purchase_price: 100, sale_price: 280, ...metadata });
  assert.equal(product().validateSync(), undefined, "legacy products must not require supplier metadata");
  const valid = product({ supplier_unit: " Takım ", fixed_dimensions: { width_cm: 200 }, technical_limits: { min_width_cm: 50, max_width_cm: 245, tube_diameter_mm: 47 } });
  assert.equal(valid.validateSync(), undefined);
  const stored = valid.toObject();
  assert.equal(stored.supplier_unit, "Takım");
  assert.deepEqual(stored.fixed_dimensions, { width_cm: 200, height_cm: 0 });
  assert.deepEqual(stored.technical_limits, { min_width_cm: 50, max_width_cm: 245, tube_diameter_mm: 47 });
  for (const metadata of [
    { supplier_unit: " " }, { supplier_unit: null },
    { fixed_dimensions: null }, { fixed_dimensions: {} }, { fixed_dimensions: { width_cm: -1 } },
    { fixed_dimensions: { width_cm: Infinity } }, { fixed_dimensions: { width_cm: 100, arbitrary: 1 } },
    { technical_limits: null }, { technical_limits: {} }, { technical_limits: { max_m2: 0 } },
    { technical_limits: { max_load_kg: Infinity } }, { technical_limits: { max_width_cm: 200, arbitrary: 1 } },
    { technical_limits: { min_width_cm: 201, max_width_cm: 200 } },
    { technical_limits: { min_height_cm: 301, max_height_cm: 300 } }
  ]) assert.ok(product(metadata).validateSync(), JSON.stringify(metadata));
});

test("late invalid record causes zero sessions or writes, so no partial import is possible", async (t) => {
  const calls = mockDatabase(t);
  const res = response();
  await importCatalog({ user: {}, body: { products: [record(), record({ catalog_id: "URUN-20002", extra_options: [{ option_name: "Fark", price_impact: -1 }] })] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.start, 0);
  assert.equal(calls.related.length, 0);
  assert.equal(calls.operations.length, 0);
});

test("late invalid supplier metadata rejects the entire catalog before starting writes", async (t) => {
  const calls = mockDatabase(t);
  const res = response();
  await importCatalog({ user: {}, body: { products: [record(), record({ catalog_id: "URUN-20002", technical_limits: { min_width_cm: 300, max_width_cm: 200 } })] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.start, 0);
  assert.equal(calls.related.length, 0);
  assert.equal(calls.operations.length, 0);
});

test("supplier metadata is inserted transactionally without changing existing product metadata or billing", async (t) => {
  const calls = mockDatabase(t, { upsertedCount: 0 });
  const res = response();
  const input = record({ unit: "Adet", currency: "USD", supplier_unit: "Takım", fixed_dimensions: { width_cm: 100, height_cm: 200 }, technical_limits: { min_width_cm: 65, max_width_cm: 250, max_load_kg: 40 }, min_width_cm: 0, min_height_cm: 0, min_m2: 0, dimension_rounding_cm: 0 });
  await importCatalog({ user: {}, body: { products: [input] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.existing, 1);
  const operation = calls.operations[0].updateOne;
  assert.deepEqual(Object.keys(operation.update), ["$setOnInsert"]);
  const stored = operation.update.$setOnInsert;
  assert.equal(stored.supplier_unit, "Takım");
  assert.deepEqual(stored.fixed_dimensions, input.fixed_dimensions);
  assert.deepEqual(stored.technical_limits, input.technical_limits);
  assert.equal(stored.currency, "USD");
  assert.equal(stored.calculation_type, "adet");
  assert.equal(stored.min_width_cm, 0);
  assert.equal(stored.min_height_cm, 0);
  assert.equal(stored.fabric_width_cm, 0);
  assert.equal(stored.stock_tracking, false);
  assert.deepEqual(stored.variants, []);
  assert.equal(calls.transaction, 1);
  assert.equal(calls.end, 1);
});

test("import stores all mechanical metadata in one transaction and never updates existing catalog products", async (t) => {
  const calls = mockDatabase(t, { upsertedCount: 0 });
  const res = response();
  await importCatalog({ user: {}, body: { products: [record()] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.added, 0);
  assert.equal(res.body.existing, 1);
  assert.equal(calls.transaction, 1);
  assert.equal(calls.end, 1);
  const operation = calls.operations[0].updateOne;
  assert.deepEqual(Object.keys(operation.update), ["$setOnInsert"], "existing price, VR, and stock must never be overwritten");
  assert.deepEqual(operation.filter, { catalog_id: "URUN-20001" });
  assert.equal(operation.upsert, true);
  const stored = operation.update.$setOnInsert;
  assert.equal(stored.min_width_cm, 100);
  assert.equal(stored.min_height_cm, 200);
  assert.equal(stored.dimension_rounding_cm, 10);
  assert.equal(stored.min_m2, 2);
  assert.equal(stored.extra_options[0].price_impact, 84);
  assert.equal(stored.stock_tracking, false);
  assert.equal(stored.stock_quantity, 0);
  assert.ok(calls.options.session);
  assert.ok(calls.related.every((call) => call.options.session === calls.options.session));
});

test("catalog import remains restricted to TEST database and TEST administrator", async (t) => {
  const calls = mockDatabase(t);
  mongoose.connection.name = "production";
  const blockedDatabase = response();
  await importCatalog({ user: {}, body: { products: [record()] } }, blockedDatabase);
  assert.equal(blockedDatabase.statusCode, 403);
  mongoose.connection.name = "sahinsoy_test";
  t.mock.method(Role, "findById", async () => ({ role_name: "User" }));
  const blockedRole = response();
  await importCatalog({ user: {}, body: { products: [record()] } }, blockedRole);
  assert.equal(blockedRole.statusCode, 403);
  assert.equal(calls.start, 0);
});

test("case accessory scopes are validated and preserved without changing existing records", async (t) => {
  assert.throws(() => normalizeCatalog([record({ extra_options: [{ option_name: "Kasa", price_impact: 50, pricing_basis: "adet", pricing_scope: "unknown" }] })]));
  assert.throws(() => normalizeCatalog([record({ extra_options: [{ option_name: "Kasa", price_impact: 50, pricing_basis: "adet", pricing_scope: null }] })]));
  const calls = mockDatabase(t);
  const res = response();
  const product = record({ extra_options: [{ option_name: "Kasa aparat", price_impact: 50, pricing_basis: "adet", pricing_scope: "kasa" }, { option_name: "Parça aparat", price_impact: 30, pricing_basis: "adet", pricing_scope: "parca" }] });
  await importCatalog({ user: {}, body: { products: [product] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.operations[0].updateOne.update.$setOnInsert.extra_options.map((option) => option.pricing_scope), ["kasa", "parca"]);
  assert.deepEqual(Object.keys(calls.operations[0].updateOne.update), ["$setOnInsert"]);
});
