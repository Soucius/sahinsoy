import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Role from "../models/Role.js";
import { appendCatalogVariants, normalizeVariantEnrichment, variantCodeKey } from "../controllers/catalogVariants.controller.js";

const input = (products = [{ catalog_id: "URUN-20001", variants: [{ vr: "A-01", color: "Krem" }] }]) => ({ kind: "variant-enrichment", products });
const product = (overrides = {}) => ({
  _id: "product-one", catalog_id: "URUN-20001", product_brand: { _id: "brand-one", brand_name: "OBA Perdesan" },
  product_name: "Test Serisi", sale_price: 19, purchase_price: 7, stock_quantity: 12, stock_tracking: true,
  currency: "TRY", min_width_cm: 100, min_height_cm: 200, extra_options: [{ _id: "option-one", option_name: "Test ek", price_impact: 3 }],
  variants: [{ _id: "variant-one", vr: "a-01", color: "Elle girilmiş renk", stock_quantity: 8 }], ...overrides,
});
const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (body) => ({ user: { user_role: "role-one" }, body });

function mockDatabase(t, { documents = [product()], role = "Test Yöneticisi", realm = "sahinsoy_test", retryOnce = false, beforeRetry, failWrite = 0 } = {}) {
  const previousName = mongoose.connection.name;
  mongoose.connection.name = realm;
  t.after(() => { mongoose.connection.name = previousName; });
  const state = { documents: new Map(documents.map((doc) => [doc.catalog_id, structuredClone(doc)])) };
  const calls = { start: 0, end: 0, transactions: 0, reads: [], writes: [], retry: 0, roles: 0 };
  t.mock.method(Role, "findById", async () => { calls.roles++; return { role_name: role }; });
  const copyState = () => new Map([...state.documents].map(([key, doc]) => [key, structuredClone(doc)]));
  const session = {
    async withTransaction(callback) {
      calls.transactions++;
      let snapshot = copyState();
      try {
        await callback();
        if (retryOnce) {
          state.documents = snapshot;
          calls.retry++;
          if (beforeRetry) beforeRetry(state);
          snapshot = copyState();
          await callback();
        }
      } catch (error) { state.documents = snapshot; throw error; }
    },
    async endSession() { calls.end++; },
  };
  t.mock.method(mongoose, "startSession", async () => { calls.start++; return session; });
  t.mock.method(Product, "find", (filter) => {
    const read = { filter, session: null, fields: null, populate: null };
    calls.reads.push(read);
    return {
      select(fields) { read.fields = fields; return this; },
      populate(path, fields) { read.populate = { path, fields }; return this; },
      session(value) { read.session = value; return this; },
      async lean() { return [...state.documents.values()].filter((doc) => filter.catalog_id.$in.includes(doc.catalog_id)).map((doc) => structuredClone(doc)); },
    };
  });
  t.mock.method(Product, "updateOne", async (filter, update, options) => {
    calls.writes.push({ filter, update: structuredClone(update), options });
    if (failWrite && calls.writes.length === failWrite) throw new Error("TEST_WRITE_FAILURE");
    const doc = state.documents.get(filter.catalog_id);
    if (!doc || doc._id !== filter._id) return { matchedCount: 0, modifiedCount: 0 };
    doc.variants ??= [];
    for (const variant of update.$push.variants.$each) doc.variants.push({ _id: `generated-${doc.variants.length}`, ...structuredClone(variant) });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(console, "error", () => {});
  return { state, calls, session };
}

test("code comparison folds Turkish I, NFC and whitespace but retains meaningful punctuation", () => {
  assert.equal(variantCodeKey("  NİSA   I-01 "), variantCodeKey("nısa i-01"));
  assert.equal(variantCodeKey("I\u0307-ÖA"), variantCodeKey("i-O\u0308A"));
  assert.notEqual(variantCodeKey("A-01"), variantCodeKey("A01"));
  assert.notEqual(variantCodeKey("A / 01"), variantCodeKey("A-01"));
  assert.deepEqual(normalizeVariantEnrichment(input([{ catalog_id: "URUN-20001", variants: [{ vr: "  ÖA / I-01 ", color: " Açık Krem " }] }])),
    [{ catalog_id: "URUN-20001", variants: [{ vr: "ÖA / I-01", color: "Açık Krem" }] }]);
});

test("validation rejects ambiguous codes, unsafe strings, duplicates, extra fields and all incoming stock or prices", () => {
  const invalid = [
    null, { ...input(), kind: "other" }, { ...input(), purchase_price: 1 }, input([]),
    input([{ catalog_id: "URUN-20001", variants: [] }]), input([{ catalog_id: "other", variants: [{ vr: "A", color: "" }] }]),
    input([input().products[0], input().products[0]]),
    input([{ catalog_id: "URUN-20001", variants: [{ vr: "I-01", color: "" }, { vr: "ı-01", color: "other" }] }]),
    input([{ catalog_id: "URUN-20001", variants: [{ vr: "ÖA", color: "" }, { vr: "O\u0308A", color: "" }] }]),
    input([{ ...input().products[0], sale_price: 1 }]),
  ];
  for (const variant of [
    { vr: " ", color: "" }, { vr: "A", color: null }, { vr: 5, color: "" }, { vr: "A" },
    { vr: "A\u0000", color: "" }, { vr: "A", color: "x\u202e" }, { vr: "A\ud800", color: "" },
    { vr: "A".repeat(101), color: "" }, { vr: "A", color: "x".repeat(101) },
    { vr: "A", color: "", stock_quantity: 4 }, { vr: "A", color: "", sale_price: 1 }, { vr: "A", color: "", _id: "invented" },
  ]) invalid.push(input([{ catalog_id: "URUN-20001", variants: [variant] }]));
  for (const body of invalid) assert.throws(() => normalizeVariantEnrichment(body));
});

test("late invalid input causes zero sessions and writes", async (t) => {
  const { calls } = mockDatabase(t);
  const res = response();
  await appendCatalogVariants(request(input([input().products[0], { catalog_id: "URUN-20002", variants: [{ vr: "A", color: "", stock_quantity: 1 }] }])), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.start, 0);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("TEST realm and exact TEST administrator role are required before a transaction", async (t) => {
  const { calls } = mockDatabase(t, { realm: "production" });
  const res = response();
  await appendCatalogVariants(request(input()), res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.roles, 0);
  assert.equal(calls.start, 0);
  mongoose.connection.name = "sahinsoy_test";
  t.mock.method(Role, "findById", async () => ({ role_name: "Administrator" }));
  const blockedRole = response();
  await appendCatalogVariants(request(input()), blockedRole);
  assert.equal(blockedRole.statusCode, 403);
  assert.equal(calls.start, 0);
});

test("every target and brand is checked before writes; a missing target or wrong brand aborts all", async (t) => {
  const { calls, state } = mockDatabase(t);
  const before = structuredClone([...state.documents]);
  const batch = input([{ catalog_id: "URUN-20001", variants: [{ vr: "NEW", color: "Krem" }] }, { catalog_id: "URUN-20002", variants: [{ vr: "NEW", color: "" }] }]);
  const missing = response();
  await appendCatalogVariants(request(batch), missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(calls.writes.length, 0);
  assert.deepEqual([...state.documents], before);
  state.documents.set("URUN-20002", product({ _id: "two", catalog_id: "URUN-20002", product_brand: { brand_name: "Another Brand" } }));
  const wrongBrand = response();
  await appendCatalogVariants(request(batch), wrongBrand);
  assert.equal(wrongBrand.statusCode, 400);
  assert.equal(calls.writes.length, 0);
  assert.deepEqual(state.documents.get("URUN-20001"), before[0][1]);
  assert.equal(calls.end, 2);
});

test("append preserves existing IDs, human colors, blank colors, stock and every parent field", async (t) => {
  const original = product({ product_brand: { brand_name: "  oba   PERDESAN " }, variants: [
    { _id: "manual-one", vr: "  NİSA-01 ", color: "Elle girilen", stock_quantity: 9 },
    { _id: "manual-two", vr: "B-02", color: "", stock_quantity: 4 },
    { _id: "color-only", vr: "", color: "Sadece renk", stock_quantity: 3 },
  ] });
  const { calls, state, session } = mockDatabase(t, { documents: [original] });
  const res = response();
  await appendCatalogVariants(request(input([{ catalog_id: "URUN-20001", variants: [
    { vr: "nısa-01", color: "Portal rengi" }, { vr: "b-02", color: "Portal tamamlaması" }, { vr: "ÖA-03", color: "Açık Krem" },
  ] }])), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.addedVariants, 1);
  assert.equal(res.body.existingVariants, 2);
  assert.equal(res.body.productsTouched, 1);
  assert.equal(res.body.productsTotal, 1);
  const after = state.documents.get("URUN-20001");
  assert.deepEqual(after.variants.slice(0, 3), original.variants);
  assert.deepEqual({ ...after, variants: undefined }, { ...original, variants: undefined });
  assert.deepEqual(after.variants[3], { _id: "generated-3", vr: "ÖA-03", color: "Açık Krem", stock_quantity: 0 });
  assert.deepEqual(Object.keys(calls.writes[0].update), ["$push"]);
  assert.deepEqual(Object.keys(calls.writes[0].update.$push), ["variants"]);
  assert.equal(calls.writes[0].options.session, session);
  assert.equal(calls.writes[0].options.runValidators, true);
  assert.equal(calls.reads[0].session, session);
});

test("repeating the same batch adds zero variants and does not write or toggle tracking", async (t) => {
  const { calls, state } = mockDatabase(t, { documents: [product({ variants: [], stock_tracking: false, stock_quantity: 0 })] });
  const first = response();
  await appendCatalogVariants(request(input()), first);
  const afterFirst = structuredClone([...state.documents]);
  const second = response();
  await appendCatalogVariants(request(input()), second);
  assert.equal(first.body.addedVariants, 1);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.addedVariants, 0);
  assert.equal(second.body.existingVariants, 1);
  assert.equal(second.body.productsTouched, 0);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual([...state.documents], afterFirst);
  assert.equal(state.documents.get("URUN-20001").stock_tracking, false);
});

test("a later database failure rolls back earlier appends in the same batch", async (t) => {
  const docs = [product({ variants: [] }), product({ _id: "two", catalog_id: "URUN-20002", variants: [] })];
  const { calls, state } = mockDatabase(t, { documents: docs, failWrite: 2 });
  const res = response();
  await appendCatalogVariants(request(input(docs.map((doc) => ({ catalog_id: doc.catalog_id, variants: [{ vr: "NEW", color: "" }] })))), res);
  assert.equal(res.statusCode, 500);
  assert.equal(calls.writes.length, 2);
  assert.deepEqual([...state.documents.values()], docs);
  assert.equal(calls.end, 1);
});

test("500-variant cap is checked across the whole batch before writing, but matching entries still skip", async (t) => {
  const fullVariants = Array.from({ length: 500 }, (_, i) => ({ _id: `existing-${i}`, vr: `V-${i}`, color: "", stock_quantity: i }));
  const { calls, state } = mockDatabase(t, { documents: [product({ variants: [] }), product({ _id: "two", catalog_id: "URUN-20002", variants: fullVariants })] });
  const rejected = response();
  await appendCatalogVariants(request(input([{ catalog_id: "URUN-20001", variants: [{ vr: "NEW", color: "" }] }, { catalog_id: "URUN-20002", variants: [{ vr: "NEW", color: "" }] }])), rejected);
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.writes.length, 0);
  assert.deepEqual(state.documents.get("URUN-20002").variants, fullVariants);
  const repeat = response();
  await appendCatalogVariants(request(input([{ catalog_id: "URUN-20002", variants: [{ vr: "v-1", color: "Portal rengi" }] }])), repeat);
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.body.existingVariants, 1);
  assert.equal(repeat.body.addedVariants, 0);
  assert.equal(calls.writes.length, 0);
});

test("transaction retry re-reads manual changes and resets counts, avoiding stale replacement and double counts", async (t) => {
  const { calls, state } = mockDatabase(t, { retryOnce: true, beforeRetry(current) {
    current.documents.get("URUN-20001").variants.push({ _id: "new-manual", vr: "B-02", color: "Manuel yeni renk", stock_quantity: 5 });
  } });
  const res = response();
  await appendCatalogVariants(request(input([{ catalog_id: "URUN-20001", variants: [
    { vr: "A-01", color: "Portal A" }, { vr: "B-02", color: "Portal B" }, { vr: "C-03", color: "Portal C" },
  ] }])), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.retry, 1);
  assert.equal(calls.reads.length, 2);
  assert.equal(res.body.addedVariants, 1);
  assert.equal(res.body.existingVariants, 2);
  assert.equal(res.body.productsTouched, 1);
  const variants = state.documents.get("URUN-20001").variants;
  assert.equal(variants.length, 3);
  assert.deepEqual(variants[1], { _id: "new-manual", vr: "B-02", color: "Manuel yeni renk", stock_quantity: 5 });
  assert.equal(variants[2].vr, "C-03");
  assert.equal(variants.filter((variant) => variant.vr === "C-03").length, 1);
});
