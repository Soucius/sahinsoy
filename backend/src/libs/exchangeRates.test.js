import test from "node:test";
import assert from "node:assert/strict";
import { createExchangeRateService, exchangeRateService, parseTcmbRates } from "./exchangeRates.js";
import { getExchangeRates } from "../controllers/exchangeRate.controller.js";

const AS_OF = Date.parse("2026-10-16T12:00:00Z");
const currency = (code, value, unit = "1") => `<Currency CrossOrder="0" Kod="${code}" CurrencyCode="${code}"><Unit>${unit}</Unit><Isim>ÖRNEK DÖVİZ</Isim><ForexBuying>1.1</ForexBuying><ForexSelling>${value}</ForexSelling><BanknoteSelling>999</BanknoteSelling></Currency>`;
const bulletin = (contents = currency("USD", "43.1256") + currency("EUR", "50.7890"), attributes = 'Tarih="16.10.2026" Date="10/16/2026"') => `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="islemkur.xsl"?><Tarih_Date ${attributes}>${contents}</Tarih_Date>`;
const parse = (xml = bulletin(), now = AS_OF) => parseTcmbRates(xml, { now });
const providerResponse = (xml = bulletin(), init) => new Response(xml, { status: 200, ...init });
const responseMock = () => ({ statusCode: 0, body: null, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("reads USD/EUR ForexSelling only, with a per-one-unit conversion", () => {
  assert.deepEqual(parse(), { rate_date: "2026-10-16", rates: { USD: 43.1256, EUR: 50.789 } });
  assert.ok(Math.abs(parse(bulletin(currency("USD", "4312.56", "100") + currency("EUR", "5078.90", "100"))).rates.USD - 43.1256) < 1e-10);
});

test("accepts TCMB whitespace, BOM, comments, and unused empty fields", () => {
  assert.deepEqual(parse(`\uFEFF${bulletin().replace("<Unit>", "<!-- A harmless comment --><Empty/>\n<Unit>").replace("43.1256", "\n43.1256\n")}`), parse());
});

test("one valid bulletin date attribute is enough, but both must agree if present", () => {
  assert.equal(parse(bulletin(undefined, 'Tarih="16.10.2026"')).rate_date, "2026-10-16");
  assert.equal(parse(bulletin(undefined, 'Date="10/16/2026"')).rate_date, "2026-10-16");
  for (const attributes of ['', 'Tarih="16.10.2026" Date="10/15/2026"', 'Tarih="16.10.2026" Date="bad"', 'Tarih="31.02.2026"', 'Date="02/29/2026"']) {
    assert.throws(() => parse(bulletin(undefined, attributes)), { code: "INVALID_RATE_DATE" });
  }
});

test("uses the Istanbul calendar day and accepts the prior business day over a weekend", () => {
  assert.equal(parse(bulletin(), Date.parse("2026-10-18T12:00:00Z")).rate_date, "2026-10-16");
  assert.equal(parse(bulletin(), Date.parse("2026-10-15T21:01:00Z")).rate_date, "2026-10-16");
  assert.throws(() => parse(bulletin(), Date.parse("2026-10-15T20:59:00Z")), { code: "OUTDATED_RATE_DATE" });
});

test("rejects future, invalid, or more-than-seven-calendar-day-old bulletin dates", () => {
  assert.throws(() => parse(bulletin(undefined, 'Tarih="17.10.2026" Date="10/17/2026"')), { code: "OUTDATED_RATE_DATE" });
  assert.equal(parse(bulletin(), AS_OF + 7 * 86400000).rate_date, "2026-10-16");
  assert.throws(() => parse(bulletin(), AS_OF + 8 * 86400000), { code: "OUTDATED_RATE_DATE" });
  assert.throws(() => parse(bulletin(), NaN), { code: "INVALID_CLOCK" });
});

test("rejects a missing or duplicate required currency and inconsistent currency codes", () => {
  assert.throws(() => parse(bulletin(currency("USD", "43"))), { code: "MISSING_OR_DUPLICATE_CURRENCY" });
  assert.throws(() => parse(bulletin(currency("USD", "43") + currency("USD", "44") + currency("EUR", "50"))), { code: "MISSING_OR_DUPLICATE_CURRENCY" });
  assert.throws(() => parse(bulletin().replace('CurrencyCode="USD"', 'CurrencyCode="EUR"')), { code: "INVALID_CURRENCY_CODE" });
});

test("rejects a missing, duplicate, nested, or nonnumeric selling value", () => {
  for (const xml of [
    bulletin().replace("<ForexSelling>43.1256</ForexSelling>", ""),
    bulletin().replace("<ForexSelling>43.1256</ForexSelling>", "<ForexSelling>43</ForexSelling><ForexSelling>44</ForexSelling>"),
    bulletin().replace("43.1256", "<Value>43</Value>"),
    ...["", "0", "-43", "NaN", "Infinity", "1e3", "43,12", "100001"].map((value) => bulletin().replace("43.1256", value)),
  ]) assert.throws(() => parse(xml));
});

test("rejects missing, zero, negative, fractional, or excessive unit values", () => {
  assert.throws(() => parse(bulletin().replace("<Unit>1</Unit>", "")), { code: "INVALID_CURRENCY_FIELD" });
  for (const unit of ["0", "-1", "1.5", "100001"]) assert.throws(() => parse(bulletin(currency("USD", "43", unit) + currency("EUR", "50"))), { code: "INVALID_CURRENCY_FIELD" });
});

test("does not expand entities, DTD, CDATA, malformed XML, or unexpected roots", () => {
  for (const xml of [
    '<!DOCTYPE x [<!ENTITY price "43">]>' + bulletin(),
    bulletin().replace("43.1256", "&#43;"),
    bulletin().replace("43.1256", "<![CDATA[43]]>"),
    bulletin().replace("</Currency>", "</Other>"),
    bulletin().replace("</Tarih_Date>", ""),
    bulletin().replace("<Tarih_Date", '<Other><Tarih_Date') + "</Other>",
    bulletin().replace("<Tarih_Date", '<Tarih_Date Tarih="16.10.2026"'),
    bulletin() + "<Other/>",
    bulletin().replace("<Unit>", "<Unit badattribute>"),
    bulletin().replace("<Unit>", "<Unit> unclosed <"),
    "<html>Provider error</html>",
  ]) assert.throws(() => parse(xml));
});

test("rejects XML beyond the strict response byte limit", () => {
  assert.throws(() => parse(bulletin(" ".repeat(128 * 1024))), { code: "INVALID_TCMB_XML" });
});

test("fetches a fixed official URL with redirects rejected and safe response metadata", async () => {
  let call;
  const service = createExchangeRateService({ now: () => AS_OF, fetchImpl: async (...args) => { call = args; return providerResponse(); } });
  const result = await service.getRates();
  assert.equal(call[0], "https://www.tcmb.gov.tr/kurlar/today.xml");
  assert.equal(call[1].redirect, "error");
  assert.ok(call[1].signal instanceof AbortSignal);
  assert.deepEqual(result, { source: "TCMB", rate_type: "ForexSelling", rate_date: "2026-10-16", rates: { USD: 43.1256, EUR: 50.789 }, fetched_at: "2026-10-16T12:00:00.000Z", cached: false, stale: false });
});

test("uses a five-minute cache without sharing mutable response objects", async () => {
  let time = AS_OF;
  let calls = 0;
  const service = createExchangeRateService({ now: () => time, fetchImpl: async () => { calls++; return providerResponse(); } });
  const first = await service.getRates();
  first.rates.USD = 1;
  time += 299999;
  const cached = await service.getRates();
  assert.equal(cached.cached, true);
  assert.equal(cached.rates.USD, 43.1256);
  assert.equal(calls, 1);
  time++;
  assert.equal((await service.getRates()).cached, false);
  assert.equal(calls, 2);
});

test("coalesces simultaneous lookups into one provider request", async () => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createExchangeRateService({ now: () => AS_OF, fetchImpl: async () => { calls++; await gate; return providerResponse(); } });
  const requests = [service.getRates(), service.getRates(), service.getRates()];
  release();
  const [first, second, third] = await Promise.all(requests);
  assert.equal(calls, 1);
  first.rates.USD = 1;
  assert.equal(second.rates.USD, 43.1256);
  assert.equal(third.cached, false);
});

test("an expired cache is never silently returned after provider failure, and a retry can recover", async () => {
  let time = AS_OF;
  let failure = false;
  const service = createExchangeRateService({ now: () => time, fetchImpl: async () => { if (failure) throw new Error("Private upstream information"); return providerResponse(); } });
  await service.getRates();
  time += 300000;
  failure = true;
  await assert.rejects(service.getRates(), { code: "RATE_PROVIDER_UNAVAILABLE", message: "RATE_PROVIDER_UNAVAILABLE" });
  await assert.rejects(service.getRates(), { code: "RATE_PROVIDER_UNAVAILABLE" });
  failure = false;
  assert.equal((await service.getRates()).cached, false);
});

test("a cached bulletin that crosses the seven-day date limit is revalidated and refused", async () => {
  let time = Date.parse("2026-10-23T20:59:00Z");
  let calls = 0;
  const service = createExchangeRateService({ now: () => time, fetchImpl: async () => { calls++; return providerResponse(); } });
  await service.getRates();
  time += 120000;
  await assert.rejects(service.getRates(), { code: "OUTDATED_RATE_DATE" });
  assert.equal(calls, 2);
});

test("rejects HTTP failures and redirects without caching them", async () => {
  for (const response of [providerResponse("Unavailable", { status: 503 }), { status: 200, redirected: true }, { status: 200, url: "https://example.com/rates.xml" }]) {
    const service = createExchangeRateService({ now: () => AS_OF, fetchImpl: async () => response });
    await assert.rejects(service.getRates(), { code: "RATE_PROVIDER_HTTP_ERROR" });
  }
});

test("enforces size limits from both Content-Length and actual streamed bytes", async () => {
  const overLimit = " ".repeat(128 * 1024 + 1);
  for (const response of [providerResponse("small", { headers: { "content-length": String(overLimit.length) } }), providerResponse(overLimit)]) {
    const service = createExchangeRateService({ now: () => AS_OF, fetchImpl: async () => response });
    await assert.rejects(service.getRates(), { code: "RATE_RESPONSE_TOO_LARGE" });
  }
});

test("rejects invalid UTF-8 and malformed provider bodies", async () => {
  for (const response of [new Response(new Uint8Array([0xff, 0xfe])), providerResponse("<html>Service unavailable</html>")]) {
    const service = createExchangeRateService({ now: () => AS_OF, fetchImpl: async () => response });
    await assert.rejects(service.getRates());
  }
});

test("total timeout covers a fetch that never returns headers", async () => {
  let signal;
  const service = createExchangeRateService({ now: () => AS_OF, timeoutMs: 10, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(service.getRates(), { code: "RATE_PROVIDER_TIMEOUT" });
  assert.equal(signal.aborted, true);
});

test("total timeout also covers a response whose body stalls", async () => {
  let streamController;
  const service = createExchangeRateService({ now: () => AS_OF, timeoutMs: 10, fetchImpl: async (_, { signal }) => {
    const stream = new ReadableStream({ start(controller) { streamController = controller; } });
    signal.addEventListener("abort", () => streamController.error(new Error("aborted")), { once: true });
    return new Response(stream);
  } });
  await assert.rejects(service.getRates(), { code: "RATE_PROVIDER_TIMEOUT" });
});

test("controller refuses a deleted/missing authenticated user", async (t) => {
  let calls = 0;
  t.mock.method(exchangeRateService, "getRates", async () => { calls++; });
  const response = responseMock();
  await getExchangeRates({}, response);
  assert.equal(response.statusCode, 401);
  assert.equal(calls, 0);
});

test("controller returns rate metadata and disables shared/browser caching", async (t) => {
  const data = { source: "TCMB", rates: { USD: 43, EUR: 50 }, cached: false, stale: false };
  t.mock.method(exchangeRateService, "getRates", async () => data);
  const response = responseMock();
  await getExchangeRates({ user: { _id: "test-user" } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, data);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("controller reports provider failure as 503, exposes no upstream detail or stale rates", async (t) => {
  t.mock.method(exchangeRateService, "getRates", async () => { throw new Error("secret-token-and-private-provider-response"); });
  const response = responseMock();
  await getExchangeRates({ user: { _id: "test-user" } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { code: "EXCHANGE_RATES_UNAVAILABLE", message: "TCMB kuru şu anda alınamadı. Kuru elle girebilir veya yeniden deneyebilirsiniz." });
  assert.equal(response.headers["Cache-Control"], "no-store");
});
