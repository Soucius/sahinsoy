import { createHash } from 'node:crypto';

// No credentials or provider error bodies are logged or returned to the browser.
const tokens = new Map();
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const isGupshupId = value => typeof value === 'string' && uuid.test(value);
const authKey = config => createHash('sha256').update(config.gupshupAppId + ':' + config.gupshupSecret).digest('hex');
export function clearGupshupToken(config) { tokens.delete(authKey(config)); }

async function accessToken(config, send) {
  const key = authKey(config), cached = tokens.get(key);
  if (cached?.expires > Date.now() + 60000) return cached.token;
  const res = await send('https://api.gupshup.io/wa/app/' + config.gupshupAppId + '/auth/app-token', {
    method: 'POST', headers: { 'X-Customer-Secret': config.gupshupSecret },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  const data = await res.json(), expires = Date.parse(data?.expiresAt);
  if (!res.ok || typeof data?.token !== 'string' || !/^[A-Za-z0-9._~-]{16,10000}$/.test(data.token) || !Number.isFinite(expires) || expires < Date.now() + 60000 || expires > Date.now() + 25 * 3600000) throw new Error('Gupshup sunucu erişimi doğrulanamadı.');
  // This application uses one provider account; discard expired/previous credentials.
  tokens.clear();
  tokens.set(key, { token: data.token, expires });
  return data.token;
}

export async function sendGupshupNotification(payload, config, send = fetch) {
  let token;
  try { token = await accessToken(config, send); }
  catch { return { status: 'failed', detail: 'Gupshup sunucu erişimi doğrulanamadı; mesaj gönderilmedi.' }; }
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
