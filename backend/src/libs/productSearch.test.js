import test from "node:test";
import assert from "node:assert/strict";
import { productSearchPattern } from "./productSearch.js";
import { getAllProducts } from "../controllers/product.controller.js";
import Product from "../models/Product.js";

const matches = (query, name) => new RegExp(productSearchPattern(query), "iu").test(name);

test("Turkish I keyboard variants find the same product, including partial names", () => {
    for (const query of ["MİLA", "MILA", "mila", "mıla", "mi̇la", "  mila  "]) {
        for (const name of ["MİLA", "MILA", "mila", "mıla", "MİLA"]) {
            assert.ok(matches(query, name), `${query} must match ${name}`);
        }
    }
    for (const query of ["gabriela", "gabrıela", "GABRİELA"]) {
        assert.ok(matches(query, "GABRİELA"));
    }
    assert.ok(matches("micole", "79-MİCOLE"));
    assert.ok(matches("isabella", "İSABELLA"));
    for (const query of ["ayvalık", "ayvalik", "AYVALIK", "AYVALİK"]) {
        assert.ok(matches(query, "AYVALIK"));
        assert.ok(matches(query, "AYVALİK"));
    }
    for (const query of ["nisa", "nısa", "NISA", "NİSA"]) {
        assert.ok(matches(query, "NİSA"));
    }
    assert.ok(matches("şahin", "ŞAHİN"));
    assert.ok(matches("ekru", "EKRU"));
    assert.ok(matches("CAFE\u0301", "CAFE\u0301"));
    assert.ok(!matches("mila", "MİRA"));
});

test("codes remain literal, including regex operators and backslashes", () => {
    for (const code of ["A+B", "V(390)", "a.b", "[i]", "i*", "^i$", "V\\i", "2506"]) {
        assert.ok(matches(code, `prefix ${code} suffix`), code);
    }
    assert.ok(!matches("A+B", "AAAB"));
    assert.ok(!matches("a.b", "axb"));
    assert.ok(!matches("V(390)", "V390"));
    assert.ok(!matches("[i]", "I"));
    assert.ok(!matches("i*", "abc"));
    assert.equal(productSearchPattern("   "), "");
    assert.equal(productSearchPattern(undefined), "");
    assert.equal(productSearchPattern({ $regex: ".*" }), "");
});

test("product listing applies the same Turkish search and filters to rows and count", async (t) => {
    const findQueries = [], countQueries = [], paging = {};
    const chain = {
        populate() { return this; }, sort() { return this; },
        skip(value) { paging.skip = value; return this; },
        limit(value) { paging.limit = value; return Promise.resolve([{ product_name: "MİLA" }]); }
    };
    t.mock.method(Product, "find", (query) => { findQueries.push(query); return chain; });
    t.mock.method(Product, "countDocuments", async (query) => { countQueries.push(query); return 25; });
    let status, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
    await getAllProducts({ query: { search: " mila ", brand: "brand-id", category: "category-id", page: "2", limit: "24" } }, res);
    assert.equal(status, 200);
    assert.deepEqual(countQueries, findQueries);
    const query = findQueries[0];
    assert.equal(query.product_brand, "brand-id");
    assert.equal(query.product_category, "category-id");
    assert.deepEqual(query.$or.map(Object.keys).flat(), ["product_name", "product_barcode", "variants.vr", "variants.color"]);
    for (const clause of query.$or) {
        const filter = Object.values(clause)[0];
        assert.equal(filter.$options, "i");
        assert.ok(new RegExp(filter.$regex, "iu").test("MİLA"));
        assert.ok(!new RegExp(filter.$regex, "iu").test("MİRA"));
    }
    assert.deepEqual(paging, { skip: 24, limit: 24 });
    assert.equal(body.totalProducts, 25);
    assert.equal(body.totalPages, 2);
});
