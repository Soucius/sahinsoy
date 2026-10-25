import { createHash } from 'node:crypto';

// No credentials or provider error bodies are logged or returned to the browser.
const tokens = new Map();
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const isGupshupId = value => typeof value === 'string' && uuid.test(value);
// Only used to reject expired manually supplied TEST tokens. Gupshup still
// verifies the JWT signature and application permissions on the send request.
export function validGupshupTestToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 10000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp * 1000 > now + 60000 && exp * 1000 <= now + 25 * 3600000;
  } catch { return false; }
}
const authKey = config => createHash('sha256').update(config.gupshupAppId + ':' + config.gupshupSecret).digest('hex');
class AccessFailure extends Error {
  constructor(reason) { super('Gupshup access failed'); this.reason = reason; }
}
const accessFailureDetails = {
  unauthorized: 'Gupshup erişim anahtarını kabul etmedi (401). Mesaj gönderilmedi.',
  forbidden: 'Gupshup bu anahtara uygulama erişimi vermedi (403). Mesaj gönderilmedi.',
  not_found: 'Gupshup uygulama erişim adresi bulunamadı (404). Mesaj gönderilmedi.',
  limited: 'Gupshup erişim isteklerini geçici olarak sınırladı (429). Mesaj gönderilmedi.',
  unavailable: 'Gupshup erişim sunucusu geçici hata verdi. Mesaj gönderilmedi.',
  format: 'Gupshup erişim yanıtının biçimi doğrulanamadı. Mesaj gönderilmedi.',
  token: 'Gupshup erişim yanıtındaki anahtar doğrulanamadı. Mesaj gönderilmedi.',
  expiry: 'Gupshup erişim anahtarının geçerlilik zamanı doğrulanamadı. Mesaj gönderilmedi.',
};
export function clearGupshupToken(config) { tokens.delete(authKey(config)); }

async function accessToken(config, send) {
  if (config.mode === 'test' && config.gupshupTestToken) {
    if (!validGupshupTestToken(config.gupshupTestToken)) throw new AccessFailure('expiry');
    return config.gupshupTestToken;
  }
  const key = authKey(config), cached = tokens.get(key);
  if (cached?.expires > Date.now() + 60000) return cached.token;
  const res = await send('https://api.gupshup.io/wa/app/' + config.gupshupAppId + '/auth/app-token', {
    method: 'POST', headers: { 'X-Customer-Secret': config.gupshupSecret },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!res.ok) throw new AccessFailure(({ 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 429: 'limited' })[res.status] || 'unavailable');
  let data;
  try { data = await res.json(); } catch { throw new AccessFailure('format'); }
  const expires = Date.parse(data?.expiresAt);
  if (typeof data?.token !== 'string' || !/^[A-Za-z0-9._~-]{16,10000}$/.test(data.token)) throw new AccessFailure('token');
  if (!Number.isFinite(expires) || expires < Date.now() + 60000 || expires > Date.now() + 25 * 3600000) throw new AccessFailure('expiry');
  // This application uses one provider account; discard expired/previous credentials.
  tokens.clear();
  tokens.set(key, { token: data.token, expires });
  return data.token;
}

export async function sendGupshupNotification(payload, config, send = fetch) {
  let token;
  try { token = await accessToken(config, send); }
  catch (error) { return { status: 'failed', detail: error instanceof AccessFailure ? accessFailureDetails[error.reason] : 'Gupshup sunucu erişimi doğrulanamadı; mesaj gönderilmedi.' }; }
  let res, data;
  try {
    res = await send('https://api.gupshup.io/wa/api/v1/template/msg', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ source: payload.source, destination: payload.destination, template: JSON.stringify(payload.template) }).toString(),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    data = await res.json();
  } catch { return { status: 'unknown', detail: 'Bağlantı kesildi; mesaj ulaşmış olabilir. Tekrar gönderilmedi.' }; }
  if (res.ok && ['submitted', 'success'].includes(data?.status) && isGupshupId(data.messageId)) return { status: 'accepted', provider_id: data.messageId, detail: '' };
  if (res.status === 401 || res.status === 403) clearGupshupToken(config);
  if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) return { status: 'failed', detail: 'Gupshup mesajı kabul etmedi. Anahtar, bakiye ve şablon onayını kontrol edin.' };
  return { status: 'unknown', detail: 'Gupshup kesin gönderim sonucu vermedi. Tekrar gönderilmedi.' };
}
