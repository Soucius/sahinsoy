const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_RATE_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export class ExchangeRateError extends Error {
  constructor(code) {
    super(code);
    this.name = "ExchangeRateError";
    this.code = code;
  }
}

const invalid = (code = "INVALID_TCMB_XML") => { throw new ExchangeRateError(code); };

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) invalid("INVALID_RATE_DATE");
  return date.toISOString().slice(0, 10);
}

function requireRecentDate(rateDate, nowMs) {
  if (!Number.isFinite(nowMs)) invalid("INVALID_CLOCK");
  // Turkey uses UTC+3 year round. Compare calendar days, not elapsed hours.
  const today = new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rateDate}T00:00:00Z`)) / DAY_MS;
  if (!Number.isInteger(age) || age < 0 || age > MAX_RATE_AGE_DAYS) invalid("OUTDATED_RATE_DATE");
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  let rest = source.trim();
  while (rest) {
    const match = /^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest);
    if (!match || Object.hasOwn(attributes, match[1])) invalid();
    attributes[match[1]] = match[2] ?? match[3];
    rest = rest.slice(match[0].length);
    if (rest && !/^\s/.test(rest)) invalid();
    rest = rest.trimStart();
  }
  return attributes;
}

// A deliberately small, non-expanding XML reader for TCMB's flat bulletin.
// No DTD, entities, CDATA, remote resources, or executable processing instructions.
function parseBulletinXml(xml) {
  if (typeof xml !== "string" || !xml.trim() || new TextEncoder().encode(xml).byteLength > MAX_BODY_BYTES) invalid();
  if (/<!\s*(?:DOCTYPE|ENTITY)|<!\[CDATA\[|&/i.test(xml)) invalid();
  const tokens = xml.replace(/^\uFEFF/, "").matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z_][^>]*>|[^<]+/g);
  const stack = [];
  let root;
  let cursor = 0;
  let nodes = 0;
  const normalized = xml.replace(/^\uFEFF/, "");
  for (const token of tokens) {
    if (token.index !== cursor) invalid();
    const value = token[0];
    cursor += value.length;
    if (value.startsWith("<!--")) {
      if (value.slice(4, -3).includes("--")) invalid();
      continue;
    }
    if (value.startsWith("<?")) {
      if (root || !/^<\?(?:xml\s|xml-stylesheet\s)/.test(value)) invalid();
      continue;
    }
    if (value.startsWith("</")) {
      const match = /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(value);
      if (!match || !stack.length || stack.pop().name !== match[1]) invalid();
      continue;
    }
    if (value.startsWith("<")) {
      const match = /^<([A-Za-z_][\w.:-]*)(\s[\s\S]*?)?\s*(\/?)>$/.exec(value);
      if (!match || ++nodes > 2000 || stack.length > 12) invalid();
      const node = { name: match[1], attributes: parseAttributes(match[2] || ""), children: [], text: "" };
      if (stack.length) stack.at(-1).children.push(node);
      else if (root) invalid();
      else root = node;
      if (!match[3]) stack.push(node);
      continue;
    }
    if (stack.length) stack.at(-1).text += value;
    else if (value.trim()) invalid();
  }
  if (cursor !== normalized.length || stack.length || root?.name !== "Tarih_Date" || root.text.trim()) invalid();
  return root;
}

function numericField(currency, name, { integer = false } = {}) {
  const fields = currency.children.filter((node) => node.name === name);
  if (fields.length !== 1 || fields[0].children.length) invalid("INVALID_CURRENCY_FIELD");
  const text = fields[0].text.trim();
  if (!(integer ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(text)) invalid("INVALID_CURRENCY_FIELD");
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number > 100000 || (integer && !Number.isSafeInteger(number))) invalid("INVALID_CURRENCY_FIELD");
  return number;
}

export function parseTcmbRates(xml, { now = Date.now() } = {}) {
  const root = parseBulletinXml(xml);
  const dates = [];
  for (const [attribute, pattern, indexes] of [
    ["Tarih", /^(\d{2})\.(\d{2})\.(\d{4})$/, [3, 2, 1]],
    ["Date", /^(\d{2})\/(\d{2})\/(\d{4})$/, [3, 1, 2]],
  ]) {
    if (!Object.hasOwn(root.attributes, attribute)) continue;
    const match = pattern.exec(root.attributes[attribute]);
    if (!match) invalid("INVALID_RATE_DATE");
    dates.push(calendarDate(...indexes.map((index) => Number(match[index]))));
  }
  if (!dates.length || new Set(dates).size !== 1) invalid("INVALID_RATE_DATE");
  requireRecentDate(dates[0], Number(now));
  const rates = {};
  for (const code of ["USD", "EUR"]) {
    const currencies = root.children.filter((node) => node.name === "Currency" && (node.attributes.CurrencyCode === code || node.attributes.Kod === code));
    if (currencies.length !== 1) invalid("MISSING_OR_DUPLICATE_CURRENCY");
    const currency = currencies[0];
    if (currency.attributes.CurrencyCode !== code || currency.attributes.Kod !== code || currency.text.trim()) invalid("INVALID_CURRENCY_CODE");
    const value = numericField(currency, "ForexSelling") / numericField(currency, "Unit", { integer: true });
    if (!Number.isFinite(value) || value <= 0 || value > 100000) invalid("INVALID_RATE");
    rates[code] = value;
  }
  return { rate_date: dates[0], rates };
}

async function readBoundedXml(response, signal) {
  const declaredLength = response.headers?.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    void response.body?.cancel().catch(() => {});
    invalid("RATE_RESPONSE_TOO_LARGE");
  }
  if (!response.body?.getReader) invalid("INVALID_RATE_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) invalid("RATE_PROVIDER_TIMEOUT");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        invalid("RATE_RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function createExchangeRateService({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  let cache;
  let pending;
  async function fetchRates() {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ExchangeRateError("RATE_PROVIDER_TIMEOUT"));
      }, timeoutMs);
    });
    const download = async () => {
      const response = await fetchImpl(TCMB_URL, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/xml, text/xml" },
      });
      if (!response || response.status !== 200 || response.redirected || (response.url && response.url !== TCMB_URL)) {
        void response?.body?.cancel().catch(() => {});
        invalid("RATE_PROVIDER_HTTP_ERROR");
      }
      const parsed = parseTcmbRates(await readBoundedXml(response, controller.signal), { now: now() });
      const result = { source: "TCMB", rate_type: "ForexSelling", ...parsed, fetched_at: new Date(now()).toISOString(), cached: false, stale: false };
      return result;
    };
    try {
      const result = await Promise.race([download(), timeout]);
      cache = { value: result, storedAt: Number(now()) };
      return structuredClone(result);
    } catch (error) {
      if (error instanceof ExchangeRateError) throw error;
      throw new ExchangeRateError(controller.signal.aborted ? "RATE_PROVIDER_TIMEOUT" : "RATE_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async getRates() {
      const age = Number(now()) - cache?.storedAt;
      if (cache && age >= 0 && age < CACHE_TTL_MS) {
        try {
          requireRecentDate(cache.value.rate_date, Number(now()));
          return { ...structuredClone(cache.value), cached: true };
        } catch {
          cache = undefined;
        }
      }
      if (!pending) pending = fetchRates().finally(() => { pending = undefined; });
      return structuredClone(await pending);
    },
  };
}

export const exchangeRateService = createExchangeRateService();
