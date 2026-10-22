import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Notification from '../models/WhatsAppNotification.js';
import ProductionOrder from '../models/ProductionOrder.js';
import ProductionStaff from '../models/ProductionStaff.js';
import Sale from '../models/Sale.js';
import { ENV } from './env.js';
import { fingerprint, productionLines } from './productionWorkflow.js';
import { allProductsReady, connectionSignature, messagePayload, publicConnection, publicNotification, readyMessage, validVerifyToken, validWebhookSignature, whatsappConfig, whatsappPhone } from './whatsappNotifications.js';
import { drainWhatsAppQueue, enqueueReadyNotification, sendClaimedNotification } from './whatsappService.js';
import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from '../controllers/whatsapp.controller.js';
import whatsappRouter from '../routes/whatsapp.route.js';

// Entirely synthetic: these tests never send network traffic or use a real person's number.
const testEnv = { WHATSAPP_MODE: 'test', WHATSAPP_ACCESS_TOKEN: 'synthetic-secret', WHATSAPP_PHONE_NUMBER_ID: '100000000000001', WHATSAPP_TEST_RECIPIENT: '905550000000', WHATSAPP_APP_SECRET: 'synthetic-app-secret', WHATSAPP_VERIFY_TOKEN: 'synthetic-webhook-verification-token' };
const config = whatsappConfig(testEnv);
const ids = { notification: '900000000000000000000001', order: '800000000000000000000001', sale: '700000000000000000000001', product: '600000000000000000000001', line: '500000000000000000000001', staff: '400000000000000000000001' };
const sale = () => ({ _id: ids.sale, status: 'tamamlandi', measurement_status: 'confirmed', delivery_method: 'store', customer_name: 'Örnek Müşteri', customer_phone: '05550000001', sale_items: [{ _id: ids.line, product: ids.product, quantity: 2, width: 100, height: 200 }] });
const order = s => ({ _id: ids.order, source_fingerprint: fingerprint(s), jobs: productionLines(s).map(j => ({ ...j, supply: 'received', stage: 'ready' })) });
const notification = extra => ({ _id: ids.notification, kind: 'connection_test', mode: 'test', config_signature: connectionSignature(config), recipient: config.testRecipient, status: 'sending', createdAt: new Date(), queued_at: new Date(), ...extra });
function query(read) { return { select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } }; }
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, sendStatus(code) { this.statusCode = code; return this; }, type() { return this; }, send(data) { this.body = data; return this; } });
function setEnv(t, values = testEnv) {
  const names = new Set([...Object.keys(process.env).filter(n => n.startsWith('WHATSAPP_')), ...Object.keys(values)]);
  const previous = Object.fromEntries([...names].map(n => [n, process.env[n]]));
  for (const name of names) { if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name]; }
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
}
test('connection is off by default; incomplete live setup cannot send; status never reveals secrets', () => {
  assert.equal(whatsappConfig({}).enabled, false);
  assert.equal(whatsappConfig({ ...testEnv, WHATSAPP_MODE: 'live' }).enabled, false);
  assert.equal(config.enabled, true);
  const status = JSON.stringify(publicConnection(config));
  for (const secret of [config.token, config.appSecret, config.verifyToken, config.testRecipient]) assert.equal(status.includes(secret), false);
  assert.equal(whatsappConfig({ ...testEnv, WHATSAPP_GRAPH_VERSION: 'https://other.invalid' }).enabled, false);
});
test('phone normalization accepts Turkish and international numbers, rejects embedded text and URLs', () => {
  for (const n of ['0555 000 00 00', '5550000000', '+90 (555) 000-0000', '00905550000000']) assert.equal(whatsappPhone(n), '905550000000');
  assert.equal(whatsappPhone('+49 151 00000000'), '4915100000000');
  for (const n of [undefined, null, 'tel:05550000000', '123', 'https://example.invalid', '05550000000 ext12']) assert.equal(whatsappPhone(n), '');
});
test('ready messages respect delivery method and require all products and materials ready', () => {
  const s = sale(), r = order(s);
  assert.equal(allProductsReady(r), true); assert.equal(allProductsReady({ jobs: [] }), false);
  assert.equal(allProductsReady({ jobs: [...r.jobs, { supply: 'received', stage: 'sewing' }] }), false);
  assert.equal(allProductsReady({ jobs: [{ supply: 'in_transit', stage: 'ready' }] }), false);
  assert.match(readyMessage(s), /Mağazamızdan teslim/);
  assert.doesNotMatch(readyMessage({ ...s, delivery_method: 'montaj' }), /Mağazamızdan teslim/);
});
test('sandbox payload always targets configured private allowlist with no customer data', () => {
  const n = notification({ recipient: '4915100000000', customer_name: 'Örnek Müşteri', order_code: 'SECRETORDER' });
  const payload = messagePayload(n, config);
  assert.equal(payload.to, config.testRecipient); assert.equal(payload.template.name, 'hello_world');
  assert.doesNotMatch(JSON.stringify(payload), /Örnek Müşteri|SECRETORDER|4915100000000/);
  assert.throws(() => messagePayload(n, { ...config, phoneId: '100000000000002' }), /değişti/);
});
test('live template uses customer and order parameters; token rotation does not create a new event', () => {
  const live = whatsappConfig({ ...testEnv, WHATSAPP_MODE: 'live', WHATSAPP_STORE_TEMPLATE: 'sahinsoy_ready_store', WHATSAPP_INSTALLATION_TEMPLATE: 'sahinsoy_ready_installation' });
  assert.equal(live.enabled, true);
  const n = notification({ kind: 'ready_installation', mode: 'live', config_signature: connectionSignature(live), customer_name: 'Örnek Müşteri', order_code: '00000001' });
  assert.equal(messagePayload(n, live).template.name, 'sahinsoy_ready_installation');
  assert.equal(messagePayload(n, live).template.components[0].parameters.length, 2);
  assert.equal(connectionSignature(live), connectionSignature({ ...live, token: 'rotated' }));
});
test('only final ready transition queues inside production transaction, with stable unique event key', async t => {
  const s = sale(), after = order(s), before = { ...after, jobs: after.jobs.map(j => ({ ...j, stage: 'sewing' })) };
  const writes = [];
  t.mock.method(Notification, 'updateOne', async (...args) => { writes.push(args); });
  const session = { synthetic: true };
  await enqueueReadyNotification(before, after, s, session, config);
  assert.equal(writes.length, 1); assert.equal(writes[0][2].session, session);
  assert.equal(writes[0][0].event_key, `ready:${s._id}:test`); assert.equal(writes[0][2].upsert, true);
  assert.equal(writes[0][1].$setOnInsert.recipient, config.testRecipient); assert.equal(writes[0][1].$setOnInsert.customer_name, '');
  for (const [b, a, saleData] of [[after, after, s], [before, before, s], [before, after, { ...s, status: 'iptal' }], [before, after, { ...s, measurement_status: 'preliminary' }], [before, { ...after, source_fingerprint: 'changed' }, s]]) await enqueueReadyNotification(b, a, saleData, session, config);
  assert.equal(writes.length, 1);
});
test('live notification is withheld without recorded customer permission', async t => {
  const s = sale(), after = order(s), before = { ...after, jobs: [] };
  const live = whatsappConfig({ ...testEnv, WHATSAPP_MODE: 'live', WHATSAPP_STORE_TEMPLATE: 'ready_store', WHATSAPP_INSTALLATION_TEMPLATE: 'ready_installation' });
  const writes = [];
  t.mock.method(Notification, 'updateOne', async (...args) => writes.push(args));
  await enqueueReadyNotification(before, after, s, {}, live); assert.equal(writes.length, 0);
  await enqueueReadyNotification(before, { ...after, whatsapp_consent: { granted_at: new Date(), phone: whatsappPhone(s.customer_phone) } }, s, {}, live); assert.equal(writes.length, 1);
  await enqueueReadyNotification(before, { ...after, whatsapp_consent: { granted_at: new Date(), phone: '905550000002' } }, s, {}, live); assert.equal(writes.length, 1, 'changing the customer phone cannot carry over another number’s consent');
});
test('HTTP acceptance is not delivery; timeouts and server errors are not automatically retried', async () => {
  let calls = 0;
  const send = async (_url, options) => { calls++; assert.match(options.headers.Authorization, /^Bearer /); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.synthetic' }] }) }; };
  assert.equal((await sendClaimedNotification(notification(), config, send)).status, 'accepted'); assert.equal(calls, 1);
  const unknown = await sendClaimedNotification(notification(), config, async () => { throw new Error('synthetic-secret'); });
  assert.equal(unknown.status, 'unknown'); assert.doesNotMatch(JSON.stringify(unknown), /synthetic-secret/);
  for (const status of [408, 429, 500]) assert.equal((await sendClaimedNotification(notification(), config, async () => ({ status, ok: false, json: async () => ({ error: { message: 'secret' } }) }))).status, 'unknown');
  const rejected = await sendClaimedNotification(notification(), config, async () => ({ status: 401, ok: false, json: async () => ({ error: { code: 190, message: 'synthetic-secret' } }) }));
  assert.equal(rejected.status, 'failed'); assert.doesNotMatch(JSON.stringify(rejected), /synthetic-secret/);
});
test('worker atomically claims once across concurrent drains and rejects stale source before sending', async t => {
  setEnv(t);
  const items = [notification({ status: 'queued' })], writes = []; let sent = 0;
  t.mock.method(Notification, 'updateMany', async () => {});
  t.mock.method(Notification, 'findOneAndUpdate', () => query(() => { const next = items.find(n => n.status === 'queued'); if (!next) return null; next.status = 'sending'; return { ...next }; }));
  t.mock.method(Notification, 'updateOne', async (_filter, update) => writes.push(update.$set));
  t.mock.method(globalThis, 'fetch', async () => { sent++; return { ok: true, json: async () => ({ messages: [{ id: 'wamid.synthetic' }] }) }; });
  await Promise.all([drainWhatsAppQueue(), drainWhatsAppQueue()]);
  assert.equal(sent, 1); assert.equal(writes[0].status, 'accepted');
  items.push(notification({ _id: '900000000000000000000002', kind: 'ready_store', status: 'queued', sale: ids.sale, production_order: ids.order }));
  t.mock.method(ProductionOrder, 'findById', () => query(() => null));
  t.mock.method(Sale, 'findById', () => query(() => null));
  await drainWhatsAppQueue(); assert.equal(sent, 1); assert.equal(writes.at(-1).status, 'cancelled');
});
test('webhooks require exact raw-body signature and verify token uses safe constant-time comparison', async t => {
  setEnv(t);
  const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const sig = `sha256=${createHmac('sha256', config.appSecret).update(raw).digest('hex')}`;
  assert.equal(validWebhookSignature(raw, sig, config.appSecret), true);
  assert.equal(validWebhookSignature(Buffer.from(' ' + raw), sig, config.appSecret), false);
  assert.equal(validWebhookSignature(raw, 'sha256=abc', config.appSecret), false);
  assert.equal(validVerifyToken('ü'.repeat(config.verifyToken.length), config.verifyToken), false);
  const verified = response(); verifyWhatsAppWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': config.verifyToken, 'hub.challenge': '123456' } }, verified); assert.equal(verified.body, '123456');
  const denied = response(); t.mock.method(Notification, 'updateOne', () => assert.fail('unsigned event cannot touch DB'));
  await receiveWhatsAppWebhook({ body: raw, get: () => 'bad' }, denied); assert.equal(denied.statusCode, 401);
});
test('signed delivery events cannot regress read status or alter another sender/recipient', async t => {
  setEnv(t); let state = notification({ status: 'accepted', provider_id: 'wamid.synthetic' }), writes = 0;
  t.mock.method(Notification, 'updateOne', async (filter, update) => { if (filter.recipient === state.recipient && filter.status.$in.includes(state.status)) { state = { ...state, ...update.$set }; writes++; } });
  async function webhook(status, phone = config.phoneId, recipient = config.testRecipient) {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone }, statuses: [{ id: 'wamid.synthetic', status, recipient_id: recipient, biz_opaque_callback_data: ids.notification }] } }] }] }));
    const res = response(); await receiveWhatsAppWebhook({ body: raw, get: () => `sha256=${createHmac('sha256', config.appSecret).update(raw).digest('hex')}` }, res); assert.equal(res.statusCode, 200);
  }
  await webhook('read'); await webhook('sent'); await webhook('failed'); assert.equal(state.status, 'read'); assert.equal(writes, 1);
  await webhook('delivered', '999999999999999'); await webhook('delivered', config.phoneId, '4915100000000'); assert.equal(writes, 1);
});
test('notification history exposes no token or unmasked number; unknown results cannot be retried', () => {
  const result = publicNotification(notification({ status: 'unknown', token: 'synthetic-secret' }));
  assert.equal(result.retry_allowed, false); assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|905550000000/);
});
test('every WhatsApp control endpoint denies production staff and missing credentials', async t => {
  const prior = ENV.JWT_SECRET; ENV.JWT_SECRET = 'synthetic-test-signing-secret'; t.after(() => { ENV.JWT_SECRET = prior; });
  t.mock.method(ProductionStaff, 'findById', () => query(() => ({ _id: ids.staff, name: 'Test Personel', duties: ['sewing'], active: true, session_version: 0 })));
  t.mock.method(Notification, 'find', () => assert.fail('staff cannot read notifications'));
  const token = jwt.sign({ id: ids.staff, scope: 'production', version: 0 }, ENV.JWT_SECRET, { audience: 'sahinsoy-production' });
  for (const [method, url] of [['GET', '/'], ['POST', '/test'], ['POST', `/notifications/${ids.notification}/retry`]]) {
    await new Promise((resolve, reject) => {
      const res = response(); res.json = function (body) { this.body = body; assert.equal(this.statusCode, 403); resolve(); return this; };
      whatsappRouter.handle({ method, url, headers: { authorization: `Bearer ${token}` }, body: {} }, res, reject);
    });
  }
});
