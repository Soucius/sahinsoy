import test from "node:test";
import assert from "node:assert/strict";
import { createHaremExchangeRateService, haremExchangeRateService, parseHaremRateEvent } from "./haremExchangeRates.js";
import { exchangeRateService } from "./exchangeRates.js";
import { getExchangeRates } from "../controllers/exchangeRate.controller.js";

// Shape and values observed on Harem's official public stream, 16 October 2026.
const AS_OF = Date.parse("2026-10-16T09:24:53.000Z");
const fixture = () => ({ meta: {}, data: {
  USDTRY: { code: "USDTRY", alis: "49.3300", satis: "49.4000", tarih: "16-10-2026 12:20:32", dir: { alis_dir: "up", satis_dir: "" }, dusuk: "49.4000", yuksek: "49.6490", kapanis: 49.256 },
  EURTRY: { code: "EURTRY", alis: "55.3850", satis: "55.5360", tarih: "16-10-2026 12:24:49", dir: { alis_dir: "down", satis_dir: "down" }, dusuk: "55.4280", yuksek: "55.6540", kapanis: 55.12 },
} });
const eventFrame = (payload = fixture()) => `42${JSON.stringify(["price_changed", payload])}`;
const openFrame = '0{"sid":"public-engine-id","pingInterval":25000,"pingTimeout":20000}';
const connectedFrame = '40{"sid":"public-namespace-id"}';
const completeFrames = (socket, payload) => { socket.frame(openFrame); socket.frame(connectedFrame); socket.frame(eventFrame(payload)); };
const responseMock = () => ({ statusCode: 0, body: null, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

function mockSocket(script = completeFrames) {
  const state = { instances: [], sent: [], urls: [] };
  class MockWebSocket extends EventTarget {
    constructor(url) {
      super();
      state.urls.push(url);
      state.instances.push(this);
      this.closed = false;
      queueMicrotask(() => script(this));
    }
    frame(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
    send(data) { state.sent.push(data); }
    close() { this.closed = true; }
  }
  return { state, WebSocketImpl: MockWebSocket };
}

test("official-shaped quote selects buying, exact per-currency source times and latest Istanbul date", () => {
  assert.deepEqual(parseHaremRateEvent(fixture(), { now: AS_OF }), {
    rate_date: "2026-10-16", rates: { USD: 49.33, EUR: 55.385 },
    rate_times: { USD: "2026-10-16T09:20:32.000Z", EUR: "2026-10-16T09:24:49.000Z" },
  });
});

test("requires both explicit currency codes instead of substituting another currency", () => {
  for (const mutate of [(data) => { delete data.EURTRY; }, (data) => { data.USDTRY.code = "EURTRY"; }, (data) => { data.EURTRY = []; }]) {
    const payload = fixture(); mutate(payload.data);
    assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }), { code: "MISSING_OR_INVALID_HAREM_CURRENCY" });
  }
  for (const payload of [null, [], {}, { data: [] }]) assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }));
});

test("rejects missing, zero, negative, nonfinite, comma, exponent and implausible rates", () => {
  for (const field of ["alis", "satis"]) for (const value of [undefined, null, "", "0", "-1", "NaN", "Infinity", Infinity, "49,33", "4.933e1", "100001", true, {}]) {
    const payload = fixture(); payload.data.USDTRY[field] = value;
    assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }), { code: "INVALID_HAREM_RATE" });
  }
});

test("requires buying no higher than selling", () => {
  const payload = fixture(); payload.data.EURTRY.alis = "56";
  assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }), { code: "INVALID_HAREM_SPREAD" });
});

test("rejects malformed and impossible Istanbul calendar timestamps", () => {
  for (const value of [undefined, "", "2026-10-16T09:24:49Z", "31-02-2026 12:24:49", "16-13-2026 12:24:49", "16-10-2026 24:24:49", "16-10-2026 12:60:49", "16-10-2026 12:24:60"]) {
    const payload = fixture(); payload.data.EURTRY.tarih = value;
    assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }), { code: "INVALID_HAREM_TIMESTAMP" });
  }
});

test("rejects a quote older than sixty minutes or over two minutes in the future", () => {
  for (const time of ["16-10-2026 11:24:52", "16-10-2026 12:26:54"]) {
    const payload = fixture(); payload.data.EURTRY.tarih = time;
    assert.throws(() => parseHaremRateEvent(payload, { now: AS_OF }), { code: "OUTDATED_HAREM_QUOTE" });
  }
  const payload = fixture(); payload.data.EURTRY.tarih = "16-10-2026 11:24:53";
  assert.equal(parseHaremRateEvent(payload, { now: AS_OF }).rates.EUR, 55.385);
  payload.data.EURTRY.tarih = "16-10-2026 12:26:53";
  assert.equal(parseHaremRateEvent(payload, { now: AS_OF }).rates.EUR, 55.385);
  assert.throws(() => parseHaremRateEvent(payload, { now: NaN }), { code: "INVALID_CLOCK" });
});

test("source dates stay Istanbul-local across UTC midnight", () => {
  const payload = fixture();
  payload.data.USDTRY.tarih = "16-10-2026 23:59:59";
  payload.data.EURTRY.tarih = "17-10-2026 00:00:01";
  assert.equal(parseHaremRateEvent(payload, { now: Date.parse("2026-10-16T21:00:02Z") }).rate_date, "2026-10-17");
});

test("fixed unauthenticated stream sends only handshake/pong and closes after first price event", async () => {
  const { state, WebSocketImpl } = mockSocket((socket) => {
    socket.frame(openFrame);
    socket.frame("2");
    socket.frame(connectedFrame);
    socket.frame(eventFrame());
    socket.frame(eventFrame({ data: {} }));
  });
  const service = createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF });
  assert.deepEqual(await service.getRates(), {
    source: "Harem", rate_type: "Buying", rate_date: "2026-10-16", rates: { USD: 49.33, EUR: 55.385 },
    rate_times: { USD: "2026-10-16T09:20:32.000Z", EUR: "2026-10-16T09:24:49.000Z" },
    fetched_at: "2026-10-16T09:24:53.000Z", cached: false, stale: false,
  });
  assert.deepEqual(state.urls, ["wss://hrmsocketonly.haremaltin.com/socket.io/?EIO=4&transport=websocket"]);
  assert.deepEqual(state.sent, ["40", "3"]);
  assert.equal(state.instances[0].closed, true);
});

test("unrelated public events are ignored until the first price event", async () => {
  const { WebSocketImpl } = mockSocket((socket) => {
    socket.frame(openFrame); socket.frame(connectedFrame);
    socket.frame('42["public_notice",{}]'); socket.frame(eventFrame());
  });
  const service = createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF });
  assert.equal((await service.getRates()).rates.USD, 49.33);
});

test("rejects price before handshake, duplicate handshake, malformed or binary protocol messages", async () => {
  for (const frames of [
    [eventFrame()], [openFrame, eventFrame()], [openFrame, openFrame], ['0{"sid":""}'],
    [openFrame, connectedFrame, connectedFrame], [openFrame, connectedFrame, "42not-json"],
    [openFrame, connectedFrame, '42["price_changed"]'], [new ArrayBuffer(8)],
    [openFrame, connectedFrame, "1"], [openFrame, connectedFrame, '44{"message":"Denied"}'],
  ]) {
    const { WebSocketImpl, state } = mockSocket((socket) => { for (const frame of frames) socket.frame(frame); });
    const service = createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF });
    await assert.rejects(service.getRates());
    assert.equal(state.instances[0].closed, true);
  }
});

test("bounds total message bytes and total protocol frame count", async () => {
  for (const frames of [["x".repeat(128 * 1024 + 1)], [openFrame, connectedFrame, ...Array.from({ length: 29 }, () => '42["notice",{}]')], [openFrame, connectedFrame, '42["notice",{"text":"' + "x".repeat(70000) + '"}]', '42["notice",{"text":"' + "x".repeat(70000) + '"}]']]) {
    const { WebSocketImpl, state } = mockSocket((socket) => { for (const frame of frames) socket.frame(frame); });
    await assert.rejects(createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF }).getRates(), { code: "HAREM_RESPONSE_LIMIT" });
    assert.equal(state.instances[0].closed, true);
  }
});

test("total timeout closes a connection that never supplies a complete price", async () => {
  for (const script of [() => {}, (socket) => { socket.frame(openFrame); socket.frame(connectedFrame); }]) {
    const { WebSocketImpl, state } = mockSocket(script);
    await assert.rejects(createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF, timeoutMs: 10 }).getRates(), { code: "HAREM_PROVIDER_TIMEOUT" });
    assert.equal(state.instances[0].closed, true);
  }
});

test("network errors, premature close and missing runtime support fail without leaking details", async () => {
  for (const [script, code] of [[(socket) => socket.dispatchEvent(new Event("error")), "HAREM_PROVIDER_UNAVAILABLE"], [(socket) => socket.dispatchEvent(new Event("close")), "HAREM_PROVIDER_CLOSED"]]) {
    const { WebSocketImpl } = mockSocket(script);
    await assert.rejects(createHaremExchangeRateService({ WebSocketImpl, now: () => AS_OF }).getRates(), { code });
  }
  await assert.rejects(createHaremExchangeRateService({ WebSocketImpl: null, now: () => AS_OF }).getRates(), { code: "HAREM_WEBSOCKET_UNAVAILABLE" });
});

test("thirty-second cache is immutable across responses and simultaneous lookups share one socket", async () => {
  let time = AS_OF;
  const { WebSocketImpl, state } = mockSocket();
  const service = createHaremExchangeRateService({ WebSocketImpl, now: () => time });
  const [first, simultaneous] = await Promise.all([service.getRates(), service.getRates()]);
  first.rates.USD = 1;
  assert.equal(simultaneous.rates.USD, 49.33);
  assert.equal(state.instances.length, 1);
  time += 29999;
  assert.equal((await service.getRates()).cached, true);
  time++;
  assert.equal((await service.getRates()).cached, false);
  assert.equal(state.instances.length, 2);
});

test("expired cache is not returned on provider failure and another request can recover", async () => {
  let time = AS_OF;
  let failing = false;
  const { WebSocketImpl, state } = mockSocket((socket) => { if (failing) socket.dispatchEvent(new Event("error")); else completeFrames(socket); });
  const service = createHaremExchangeRateService({ WebSocketImpl, now: () => time });
  await service.getRates();
  time += 30000;
  failing = true;
  await assert.rejects(service.getRates(), { code: "HAREM_PROVIDER_UNAVAILABLE" });
  await assert.rejects(service.getRates(), { code: "HAREM_PROVIDER_UNAVAILABLE" });
  failing = false;
  assert.equal((await service.getRates()).cached, false);
  assert.equal(state.instances.length, 4);
});

test("a cached source quote crossing its sixty-minute limit is never served as current", async () => {
  let time = AS_OF;
  const payload = fixture(); payload.data.USDTRY.tarih = "16-10-2026 11:25:03";
  const { WebSocketImpl, state } = mockSocket((socket) => completeFrames(socket, payload));
  const service = createHaremExchangeRateService({ WebSocketImpl, now: () => time });
  await service.getRates();
  time += 20000;
  await assert.rejects(service.getRates(), { code: "OUTDATED_HAREM_QUOTE" });
  assert.equal(state.instances.length, 2);
});

test("provider=harem selects Harem; absent and explicit tcmb retain the original service", async (t) => {
  const harem = { source: "Harem", rates: { USD: 49.33, EUR: 55.385 } };
  const tcmb = { source: "TCMB", rates: { USD: 49.4204, EUR: 55.411 } };
  t.mock.method(haremExchangeRateService, "getRates", async () => harem);
  t.mock.method(exchangeRateService, "getRates", async () => tcmb);
  for (const [query, expected] of [[{ provider: "harem" }, harem], [{}, tcmb], [{ provider: "tcmb" }, tcmb]]) {
    const response = responseMock();
    await getExchangeRates({ user: { _id: "test-user" }, query }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, expected);
    assert.equal(response.headers["Cache-Control"], "no-store");
  }
});

test("unsupported or repeated provider values return 400 without contacting either source", async (t) => {
  let calls = 0;
  t.mock.method(haremExchangeRateService, "getRates", async () => { calls++; });
  t.mock.method(exchangeRateService, "getRates", async () => { calls++; });
  for (const provider of ["", "other", "Harem", ["harem", "tcmb"], {}, "https://example.com/rates"]) {
    const response = responseMock();
    await getExchangeRates({ user: { _id: "test-user" }, query: { provider } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_EXCHANGE_RATE_PROVIDER");
  }
  assert.equal(calls, 0);
});

test("Harem provider errors return a specific manual fallback message, never TCMB or old rates", async (t) => {
  let tcmbCalls = 0;
  t.mock.method(haremExchangeRateService, "getRates", async () => { throw new Error("private-provider-detail"); });
  t.mock.method(exchangeRateService, "getRates", async () => { tcmbCalls++; });
  const response = responseMock();
  await getExchangeRates({ user: { _id: "test-user" }, query: { provider: "harem" } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { code: "EXCHANGE_RATES_UNAVAILABLE", message: "Harem alış kuru şu anda alınamadı veya güncel değil. Kuru elle girebilir veya yeniden deneyebilirsiniz." });
  assert.equal(tcmbCalls, 0);
});

test("a missing user cannot retrieve Harem rates", async (t) => {
  let calls = 0;
  t.mock.method(haremExchangeRateService, "getRates", async () => { calls++; });
  const response = responseMock();
  await getExchangeRates({ query: { provider: "harem" } }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(calls, 0);
});
