const HAREM_SOCKET_URL = "wss://hrmsocketonly.haremaltin.com/socket.io/?EIO=4&transport=websocket";
const CACHE_TTL_MS = 30 * 1000;
const TIMEOUT_MS = 8000;
const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_PROTOCOL_FRAMES = 30;
const MAX_RATE_AGE_MS = 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

export class HaremExchangeRateError extends Error {
  constructor(code) {
    super(code);
    this.name = "HaremExchangeRateError";
    this.code = code;
  }
}

const invalid = (code = "INVALID_HAREM_QUOTE") => { throw new HaremExchangeRateError(code); };

function assertFreshTimestamp(timestamp, nowMs) {
  if (!Number.isFinite(nowMs)) invalid("INVALID_CLOCK");
  const age = nowMs - timestamp;
  if (!Number.isFinite(age) || age > MAX_RATE_AGE_MS || age < -FUTURE_TOLERANCE_MS) invalid("OUTDATED_HAREM_QUOTE");
}

function parseTimestamp(value, nowMs) {
  if (typeof value !== "string") invalid("INVALID_HAREM_TIMESTAMP");
  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) invalid("INVALID_HAREM_TIMESTAMP");
  const [day, month, year, hour, minute, second] = match.slice(1).map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 2000 || localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hour || localDate.getUTCMinutes() !== minute || localDate.getUTCSeconds() !== second) invalid("INVALID_HAREM_TIMESTAMP");
  const timestamp = localDate.getTime() - ISTANBUL_OFFSET_MS;
  assertFreshTimestamp(timestamp, nowMs);
  return timestamp;
}

function rateNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d{1,6}(?:\.\d{1,8})?$/.test(value))) invalid("INVALID_HAREM_RATE");
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100000) invalid("INVALID_HAREM_RATE");
  return number;
}

export function parseHaremRateEvent(payload, { now = Date.now() } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) invalid();
  const rates = {};
  const rateTimes = {};
  const timestamps = [];
  for (const currency of ["USD", "EUR"]) {
    const code = `${currency}TRY`;
    const quote = payload.data[code];
    if (!quote || typeof quote !== "object" || Array.isArray(quote) || quote.code !== code) invalid("MISSING_OR_INVALID_HAREM_CURRENCY");
    const buying = rateNumber(quote.alis);
    const selling = rateNumber(quote.satis);
    if (buying > selling) invalid("INVALID_HAREM_SPREAD");
    const timestamp = parseTimestamp(quote.tarih, Number(now));
    timestamps.push(timestamp);
    rates[currency] = buying;
    rateTimes[currency] = new Date(timestamp).toISOString();
  }
  return {
    rate_date: new Date(Math.max(...timestamps) + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10),
    rates,
    rate_times: rateTimes,
  };
}

function receiveHaremQuote({ WebSocketImpl, now, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let engineConnected = false;
    let namespaceConnected = false;
    let frames = 0;
    let bytes = 0;
    const encoder = new TextEncoder();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        try { socket.close(); } catch { /* The socket may already be closed. */ }
      }
      if (error) reject(error instanceof HaremExchangeRateError ? error : new HaremExchangeRateError("HAREM_PROVIDER_UNAVAILABLE"));
      else resolve(result);
    };
    const onError = () => finish(new HaremExchangeRateError("HAREM_PROVIDER_UNAVAILABLE"));
    const onClose = () => finish(new HaremExchangeRateError("HAREM_PROVIDER_CLOSED"));
    const onMessage = ({ data }) => {
      if (settled) return;
      try {
        if (typeof data !== "string") invalid("INVALID_HAREM_PROTOCOL");
        bytes += encoder.encode(data).byteLength;
        if (bytes > MAX_MESSAGE_BYTES || ++frames > MAX_PROTOCOL_FRAMES) invalid("HAREM_RESPONSE_LIMIT");
        if (data.startsWith("0")) {
          if (engineConnected) invalid("INVALID_HAREM_PROTOCOL");
          const handshake = JSON.parse(data.slice(1));
          if (!handshake || typeof handshake.sid !== "string" || !handshake.sid || handshake.sid.length > 200) invalid("INVALID_HAREM_PROTOCOL");
          engineConnected = true;
          socket.send("40");
          return;
        }
        if (data === "2") {
          if (!engineConnected) invalid("INVALID_HAREM_PROTOCOL");
          socket.send("3");
          return;
        }
        if (data.startsWith("40")) {
          if (!engineConnected || namespaceConnected) invalid("INVALID_HAREM_PROTOCOL");
          if (data.length > 2) {
            const handshake = JSON.parse(data.slice(2));
            if (!handshake || typeof handshake.sid !== "string" || !handshake.sid || handshake.sid.length > 200) invalid("INVALID_HAREM_PROTOCOL");
          }
          namespaceConnected = true;
          return;
        }
        if (data.startsWith("42")) {
          if (!namespaceConnected) invalid("INVALID_HAREM_PROTOCOL");
          const event = JSON.parse(data.slice(2));
          if (!Array.isArray(event) || event.length !== 2 || typeof event[0] !== "string") invalid("INVALID_HAREM_PROTOCOL");
          if (event[0] !== "price_changed") return;
          const parsed = parseHaremRateEvent(event[1], { now: now() });
          finish(null, {
            source: "Harem", rate_type: "Buying", ...parsed,
            fetched_at: new Date(now()).toISOString(), cached: false, stale: false,
          });
          return;
        }
        invalid("INVALID_HAREM_PROTOCOL");
      } catch (error) {
        finish(error);
      }
    };
    const timer = setTimeout(() => finish(new HaremExchangeRateError("HAREM_PROVIDER_TIMEOUT")), timeoutMs);
    try {
      if (typeof WebSocketImpl !== "function") invalid("HAREM_WEBSOCKET_UNAVAILABLE");
      // This is the same unauthenticated public stream used by Harem's website.
      // Only the protocol handshake and ping response are sent; no subscriptions/orders.
      socket = new WebSocketImpl(HAREM_SOCKET_URL);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    } catch (error) {
      finish(error);
    }
  });
}

export function createHaremExchangeRateService({ WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  let cache;
  let pending;
  return {
    async getRates() {
      const age = Number(now()) - cache?.storedAt;
      if (cache && age >= 0 && age < CACHE_TTL_MS) {
        try {
          for (const timestamp of Object.values(cache.value.rate_times)) assertFreshTimestamp(Date.parse(timestamp), Number(now()));
          return { ...structuredClone(cache.value), cached: true };
        } catch {
          cache = undefined;
        }
      }
      if (!pending) pending = receiveHaremQuote({ WebSocketImpl, now, timeoutMs }).then((value) => {
        cache = { value, storedAt: Number(now()) };
        return value;
      }).finally(() => { pending = undefined; });
      return structuredClone(await pending);
    },
  };
}

export const haremExchangeRateService = createHaremExchangeRateService();
