import test from 'node:test';
import assert from 'node:assert/strict';
import Receipt from '../models/WhatsAppDeliveryReceipt.js';
import Notification from '../models/WhatsAppNotification.js';
import { clearGupshupToken, sendGupshupNotification } from './gupshupTransport.js';
import { applyGupshupReceipts, receiveGupshupWebhook } from './gupshupWebhook.js';
import { connectionSignature, messagePayload, publicConnection, whatsappConfig } from './whatsappNotifications.js';

// Synthetic identifiers only; no test contacts any provider.
const app = '10000000-0000-0000-0000-000000000001';
const store = '20000000-0000-0000-0000-000000000001';
const install = '20000000-0000-0000-0000-000000000002';
const message = '30000000-0000-0000-0000-000000000001';
const env = { WHATSAPP_PROVIDER: 'gupshup', WHATSAPP_MODE: 'test', WHATSAPP_PHONE_NUMBER_ID: '100000000000001', WHATSAPP_TEST_RECIPIENT: '905550000000', GUPSHUP_APP_ID: app, GUPSHUP_SOURCE_PHONE: '905550000001', GUPSHUP_CUSTOMER_SECRET: 'synthetic-account-secret-never-real', GUPSHUP_STORE_TEMPLATE_ID: store, GUPSHUP_INSTALLATION_TEMPLATE_ID: install, GUPSHUP_WEBHOOK_TOKEN: 'synthetic-delivery-header-secret' };
const config = whatsappConfig(env);
const notification = c => ({ _id: '900000000000000000000001', mode: c.mode, kind: 'connection_test', config_signature: connectionSignature(c), recipient: '4915100000000', customer_name: 'Should not leave sandbox', order_code: 'PRIVATE' });
const okToken = () => ({ ok: true, json: async () => ({ token: 'synthetic-jwt-value-without-real-access', expiresAt: new Date(Date.now() + 23 * 3600000).toISOString() }) });
const testJwt = exp => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'syntheticSignature'].join('.');
const query = read => ({ sort() { return this; }, limit() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } });
const response = () => ({ statusCode: 200, sendStatus(code) { this.statusCode = code; return this; } });
const event = (status = 'delivered', extra = {}) => ({ object: 'whatsapp_business_account', gs_app_id: app, entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: config.phoneId }, statuses: [{ gs_id: message, id: 'wamid.different-provider-id', recipient_id: config.testRecipient, status }] } }] }], ...extra });
const req = (payload, secret = config.gupshupWebhookToken) => ({ body: Buffer.from(JSON.stringify(payload)), get: () => secret });

test('Gupshup setup fails closed and exposes no account, token or private number in status', () => {
  assert.equal(config.enabled, true);
  assert.equal(whatsappConfig({ ...env, GUPSHUP_CUSTOMER_SECRET: '' }).enabled, false);
  assert.equal(whatsappConfig({ ...env, GUPSHUP_STORE_TEMPLATE_ID: 'not-approved' }).enabled, false);
  assert.equal(whatsappConfig({ ...env, WHATSAPP_MODE: 'live', GUPSHUP_WEBHOOK_TOKEN: '' }).enabled, false);
  assert.equal(whatsappConfig({ ...env, WHATSAPP_PROVIDER: 'unknown-provider' }).enabled, false);
  const visible = JSON.stringify(publicConnection(config));
  for (const value of [config.gupshupSecret, config.gupshupWebhookToken, config.testRecipient]) assert.equal(visible.includes(value), false);
  assert.equal(publicConnection(config).provider, 'gupshup');
});

test('Gupshup sandbox cannot send actual customer identity or select arbitrary recipients', () => {
  const payload = messagePayload(notification(config), config);
  assert.equal(payload.source, config.gupshupSource);
  assert.equal(payload.destination, config.testRecipient);
  assert.deepEqual(payload.template, { id: store, params: ['Deneme Müşterisi', 'TEST'] });
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|Should not leave|4915100000000/);
  const live = whatsappConfig({ ...env, WHATSAPP_MODE: 'live' });
  const n = { ...notification(live), kind: 'ready_installation', customer_name: 'Örnek', order_code: 'SS0001' };
  assert.deepEqual(messagePayload(n, live).template, { id: install, params: ['Örnek', 'SS0001'] });
  assert.equal(connectionSignature(live), connectionSignature({ ...live, gupshupSecret: 'rotated-key', gupshupWebhookToken: 'rotated-header' }));
  assert.notEqual(connectionSignature(live), connectionSignature({ ...live, gupshupAppId: install }));
  assert.throws(() => messagePayload(notification(live), live), /geçersiz/);
});

test('CAT is obtained only at the official endpoint and cached; account secret is never sent with a message', async () => {
  clearGupshupToken(config);
  let auth = 0, sent = 0;
  const send = async (url, options) => {
    if (url.endsWith('/auth/app-token')) { auth++; assert.equal(url, 'https://api.gupshup.io/wa/app/' + app + '/auth/app-token'); assert.equal(options.headers['X-Customer-Secret'], config.gupshupSecret); return okToken(); }
    sent++;
    assert.equal(url, 'https://api.gupshup.io/wa/api/v1/template/msg');
    assert.equal(options.redirect, 'error');
    assert.match(options.headers.Authorization, /^Bearer /);
    assert.equal(options.headers['X-Customer-Secret'], undefined);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('destination'), config.testRecipient);
    assert.deepEqual(JSON.parse(body.get('template')).params, ['Deneme Müşterisi', 'TEST']);
    assert.equal(options.body.includes(config.gupshupSecret), false);
    return { ok: true, status: 202, json: async () => ({ status: 'submitted', messageId: message }) };
  };
  for (let i = 0; i < 2; i++) assert.deepEqual(await sendGupshupNotification(messagePayload(notification(config), config), config, send), { status: 'accepted', provider_id: message, detail: '' });
  assert.equal(auth, 1); assert.equal(sent, 2);
  clearGupshupToken(config);
});

test('failed or expired CAT never sends a message or exposes provider secrets', async () => {
  for (const data of [{ token: 'synthetic-token-value', expiresAt: 'bad-date' }, { token: 'synthetic-token-value', expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
    clearGupshupToken(config); let calls = 0;
    const result = await sendGupshupNotification(messagePayload(notification(config), config), config, async () => { calls++; return { ok: true, json: async () => data }; });
    assert.equal(result.status, 'failed'); assert.equal(calls, 1);
  }
  const failed = await sendGupshupNotification(messagePayload(notification(config), config), config, async () => { throw new Error(config.gupshupSecret); });
  assert.equal(failed.status, 'failed'); assert.equal(JSON.stringify(failed).includes(config.gupshupSecret), false);
});

test('a manually generated CAT is restricted to TEST and expires closed without exposing its value', async () => {
  const token = testJwt(Math.floor(Date.now() / 1000) + 23 * 3600);
  const manual = whatsappConfig({ ...env, GUPSHUP_CUSTOMER_SECRET: '', GUPSHUP_TEST_APP_TOKEN: token });
  assert.equal(manual.enabled, true);
  assert.equal(JSON.stringify(publicConnection(manual)).includes(token), false);
  assert.equal(connectionSignature(manual), connectionSignature(config));
  let calls = 0;
  const result = await sendGupshupNotification(messagePayload(notification(manual), manual), manual, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.gupshup.io/wa/api/v1/template/msg');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(new URLSearchParams(options.body).get('destination'), config.testRecipient);
    return { ok: true, status: 202, json: async () => ({ status: 'submitted', messageId: message }) };
  });
  assert.equal(result.status, 'accepted'); assert.equal(calls, 1);
  const live = whatsappConfig({ ...env, WHATSAPP_MODE: 'live', GUPSHUP_TEST_APP_TOKEN: token });
  assert.equal(live.gupshupTestToken, '');
  assert.equal(whatsappConfig({ ...env, WHATSAPP_MODE: 'live', GUPSHUP_CUSTOMER_SECRET: '', GUPSHUP_TEST_APP_TOKEN: token }).enabled, false);
  for (const invalid of ['malformed-token', testJwt(Math.floor(Date.now() / 1000) - 1), testJwt(Math.floor(Date.now() / 1000) + 26 * 3600)]) {
    assert.equal(whatsappConfig({ ...env, GUPSHUP_TEST_APP_TOKEN: invalid }).enabled, false);
    let networkCalls = 0;
    const failed = await sendGupshupNotification({}, { ...manual, gupshupTestToken: invalid }, async () => { networkCalls++; });
    assert.equal(failed.status, 'failed'); assert.equal(networkCalls, 0);
    assert.equal(JSON.stringify(failed).includes(invalid), false);
  }
});

test('provider acceptance is not delivery; uncertain sends are never retried automatically', async () => {
  for (const status of [408, 429, 500]) {
    clearGupshupToken(config); let sent = 0;
    const result = await sendGupshupNotification(messagePayload(notification(config), config), config, async url => {
      if (url.endsWith('/auth/app-token')) return okToken();
      sent++; return { status, ok: false, json: async () => ({ error: config.gupshupSecret }) };
    });
    assert.equal(result.status, 'unknown'); assert.equal(sent, 1); assert.equal(JSON.stringify(result).includes(config.gupshupSecret), false);
  }
  clearGupshupToken(config);
  const failed = await sendGupshupNotification(messagePayload(notification(config), config), config, async url => url.endsWith('/auth/app-token') ? okToken() : { status: 401, ok: false, json: async () => ({ message: 'secret error body' }) });
  assert.equal(failed.status, 'failed');
  clearGupshupToken(config);
});

test('auth diagnostics distinguish provider rejection without exposing secrets or sending a message', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    clearGupshupToken(config);
    let calls = 0;
    const result = await sendGupshupNotification(messagePayload(notification(config), config), config, async url => {
      calls++; assert.ok(url.endsWith('/auth/app-token'));
      return { ok:false, status, json:async () => ({ error:config.gupshupSecret }) };
    });
    assert.equal(result.status, 'failed'); assert.equal(calls, 1);
    assert.ok(result.detail.includes(status === 500 ? 'geçici hata' : String(status)));
    assert.equal(JSON.stringify(result).includes(config.gupshupSecret), false);
  }
  clearGupshupToken(config);
});

test('delivery callbacks require the private header and matching app and sender', async t => {
  let writes = 0;
  t.mock.method(Receipt, 'updateOne', async () => { writes++; });
  t.mock.method(Receipt, 'find', () => query(() => []));
  const invalid = response(); await receiveGupshupWebhook(req(event(), 'wrong'), invalid, config); assert.equal(invalid.statusCode, 401);
  const otherApp = response(); await receiveGupshupWebhook(req(event('read', { gs_app_id: install })), otherApp, config);
  const wrongPhone = event(); wrongPhone.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999';
  await receiveGupshupWebhook(req(wrongPhone), response(), config);
  const incoming = event(); incoming.entry[0].changes[0].value = { metadata: { phone_number_id: config.phoneId }, messages: [{ text: { body: 'private incoming chat' } }] };
  await receiveGupshupWebhook(req(incoming), response(), config);
  assert.equal(writes, 0);
});

test('early delivery callback is journaled and applied after HTTP response establishes provider id; read never regresses', async t => {
  const journal = []; let saved = { status: 'sending', recipient: config.testRecipient, config_signature: connectionSignature(config) };
  t.mock.method(Receipt, 'updateOne', async (filter, update) => { assert.equal(JSON.stringify(update).includes('private incoming chat'), false); if (!journal.some(r => r.status === filter.status)) journal.push({ ...filter }); });
  t.mock.method(Receipt, 'find', () => query(() => journal));
  t.mock.method(Notification, 'updateOne', async (filter, update) => {
    if (filter.provider_id === saved.provider_id && filter.recipient === saved.recipient && filter.status.$in.includes(saved.status)) saved = { ...saved, ...update.$set };
  });
  await receiveGupshupWebhook(req(event()), response(), config);
  assert.equal(saved.status, 'sending');
  saved = { ...saved, status: 'accepted', provider_id: message };
  await applyGupshupReceipts(message, config);
  assert.equal(saved.status, 'delivered');
  await receiveGupshupWebhook(req(event('read')), response(), config); assert.equal(saved.status, 'read');
  await receiveGupshupWebhook(req(event('sent')), response(), config);
  await receiveGupshupWebhook(req(event('failed')), response(), config);
  assert.equal(saved.status, 'read');
  assert.ok(journal.every(r => r.provider_id === message && !('payload' in r)));
});

test('authenticated provider-side failures can be recorded before Meta assigns sender metadata', async t => {
  const writes = [];
  t.mock.method(Receipt, 'updateOne', async (filter) => writes.push(filter));
  t.mock.method(Receipt, 'find', () => query(() => []));
  const failed = event('failed'); delete failed.entry[0].changes[0].value.metadata;
  await receiveGupshupWebhook(req(failed), response(), config);
  assert.equal(writes.length, 1); assert.equal(writes[0].provider_id, message);
  const unsigned = response(); await receiveGupshupWebhook(req(failed, ''), unsigned, config);
  assert.equal(unsigned.statusCode, 401); assert.equal(writes.length, 1);
});
