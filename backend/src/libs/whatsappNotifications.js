import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isGupshupId } from './gupshupTransport.js';

export function whatsappPhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{10}$/.test(digits)) digits = `90${digits.slice(1)}`;
  else if (/^5\d{9}$/.test(digits)) digits = `90${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}
export const maskedPhone = phone => phone ? `+${phone.slice(0, 2)} … ${phone.slice(-4)}` : '';
export const allProductsReady = record => Boolean(record?.jobs?.length) && record.jobs.every(j => j.supply === 'received' && ['ready', 'installation', 'installed'].includes(j.stage));
export const readyKind = sale => ['montaj', 'installation'].includes(sale.delivery_method) ? 'ready_installation' : ['store', 'magaza', 'mağaza'].includes(sale.delivery_method) ? 'ready_store' : '';
export function readyMessage(sale) {
  const name = String(sale.customer_name || 'Müşterimiz').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  return `Sayın ${name}, ürünleriniz hazırdır. ${readyKind(sale) === 'ready_installation' ? 'Montaj randevunuzu planlamak için sizinle iletişime geçeceğiz.' : 'Mağazamızdan teslim alabilirsiniz.'} Bizi tercih ettiğiniz için teşekkür ederiz. Şahinsoy Perde · Sipariş no: ${String(sale._id).slice(-8).toUpperCase()}`;
}
export function whatsappConfig(env = process.env) {
  const mode = ['test', 'live'].includes(env.WHATSAPP_MODE) ? env.WHATSAPP_MODE : 'disabled';
  const config = { mode, token: env.WHATSAPP_ACCESS_TOKEN || '', phoneId: env.WHATSAPP_PHONE_NUMBER_ID || '', version: env.WHATSAPP_GRAPH_VERSION || 'v25.0', testRecipient: whatsappPhone(env.WHATSAPP_TEST_RECIPIENT), storeTemplate: env.WHATSAPP_STORE_TEMPLATE || '', installationTemplate: env.WHATSAPP_INSTALLATION_TEMPLATE || '', language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'tr', appSecret: env.WHATSAPP_APP_SECRET || '', verifyToken: env.WHATSAPP_VERIFY_TOKEN || '' };
  const missing = [];
  config.provider = env.WHATSAPP_PROVIDER || 'meta';
  if (!['meta', 'gupshup'].includes(config.provider)) missing.push('Mesaj sağlayıcısı');
  config.gupshupAppId = env.GUPSHUP_APP_ID || '';
  config.gupshupSecret = env.GUPSHUP_CUSTOMER_SECRET || '';
  config.gupshupSource = whatsappPhone(env.GUPSHUP_SOURCE_PHONE);
  config.gupshupStoreTemplate = env.GUPSHUP_STORE_TEMPLATE_ID || '';
  config.gupshupInstallationTemplate = env.GUPSHUP_INSTALLATION_TEMPLATE_ID || '';
  config.gupshupWebhookToken = env.GUPSHUP_WEBHOOK_TOKEN || '';
  if (config.provider === 'gupshup') {
    if (!isGupshupId(config.gupshupAppId) || !config.gupshupSource) missing.push('Gupshup uygulama ve mağaza numarası');
    if (config.gupshupSecret.length < 24) missing.push('Gupshup hesap anahtarı');
    if (!isGupshupId(config.gupshupStoreTemplate) || (mode === 'live' && !isGupshupId(config.gupshupInstallationTemplate))) missing.push('Onaylı Gupshup mesaj şablonları');
  } else if (!config.token) missing.push('Erişim anahtarı');
  if (!/^\d{5,30}$/.test(config.phoneId)) missing.push('Gönderici numara kimliği');
  if (!/^v\d{2}\.0$/.test(config.version)) missing.push('API sürümü');
  if (mode === 'test' && !config.testRecipient) missing.push('Doğrulanmış deneme alıcısı');
  if (mode === 'live') {
    if (config.provider !== 'gupshup' && ![config.storeTemplate, config.installationTemplate].every(t => /^[a-z][a-z0-9_]{0,511}$/.test(t))) missing.push('Onaylı teslim ve montaj mesaj şablonları');
    if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(config.language)) missing.push('Şablon dili');
    if (config.provider === 'gupshup' ? config.gupshupWebhookToken.length < 24 : !config.appSecret || config.verifyToken.length < 24) missing.push('Teslim bildirimi doğrulaması');
  }
  config.missing = missing;
  config.enabled = mode !== 'disabled' && missing.length === 0;
  return config;
}
export function connectionSignature(config) {
  if (config.provider === 'gupshup') return createHash('sha256').update(JSON.stringify([config.provider, config.mode, config.phoneId, config.gupshupAppId, config.gupshupSource, config.testRecipient, config.gupshupStoreTemplate, config.gupshupInstallationTemplate])).digest('hex');
  // Do not include the token: rotation must not create a new notification.
  return createHash('sha256').update(JSON.stringify([config.mode, config.phoneId, config.testRecipient, config.storeTemplate, config.installationTemplate, config.language, config.version])).digest('hex');
}
export function messagePayload(notification, config) {
  if (!config.enabled || notification.config_signature !== connectionSignature(config)) throw new Error('Bağlantı ayarları değişti.');
  const to = config.mode === 'test' ? config.testRecipient : whatsappPhone(notification.recipient);
  if (!to || (config.mode === 'live' && notification.kind === 'connection_test')) throw new Error('Gönderim alıcısı geçersiz.');
  if (config.provider === 'gupshup') return {
    source: config.gupshupSource, destination: to,
    template: { id: notification.kind === 'ready_installation' ? config.gupshupInstallationTemplate : config.gupshupStoreTemplate, params: config.mode === 'test' ? ['Deneme Müşterisi', 'TEST'] : [notification.customer_name, notification.order_code] },
  };
  const template = config.mode === 'test' ? { name: 'hello_world', language: { code: 'en_US' } } : {
    name: notification.kind === 'ready_installation' ? config.installationTemplate : config.storeTemplate,
    language: { code: config.language },
    components: [{ type: 'body', parameters: [notification.customer_name, notification.order_code].map(text => ({ type: 'text', text })) }],
  };
  return { messaging_product: 'whatsapp', to, type: 'template', template, biz_opaque_callback_data: String(notification._id) };
}
export const publicConnection = config => ({ provider: config.provider || 'meta', mode: config.mode, configured: config.enabled, missing: config.mode === 'disabled' ? [] : config.missing, recipient: config.mode === 'test' ? maskedPhone(config.testRecipient) : '', delivery_tracking: config.provider === 'gupshup' ? config.gupshupWebhookToken.length >= 24 : Boolean(config.appSecret && config.verifyToken.length >= 24) });
export function validWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !secret || !/^sha256=[a-f\d]{64}$/.test(signature || '')) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(rawBody).digest(), Buffer.from(signature.slice(7), 'hex'));
}
export function validVerifyToken(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && expected.length >= 24 && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export const STATUS_LABELS = { queued: 'Gönderim bekliyor', sending: 'Gönderiliyor', accepted: 'WhatsApp kabul etti; teslim bekleniyor', sent: 'Gönderildi', delivered: 'Ulaştı', read: 'Okundu', failed: 'Gönderilemedi', unknown: 'Sonuç belirsiz; tekrar gönderilmedi', cancelled: 'Gönderim iptal edildi' };
export function publicNotification(n) {
  return { _id: String(n._id), sale_id: n.sale ? String(n.sale) : '', kind: n.kind, mode: n.mode, recipient: maskedPhone(n.recipient), status: n.status, status_label: STATUS_LABELS[n.status] || n.status, detail: n.detail || '', created_at: n.createdAt, updated_at: n.updatedAt, retry_allowed: n.status === 'failed' };
}
export function providerError(code) {
  return ({ 190: 'Erişim anahtarının süresi dolmuş veya geçersiz.', 131030: 'Alıcı numara Meta deneme listesinde doğrulanmamış.', 131026: 'Mesaj alıcıya teslim edilemedi.', 132001: 'Onaylı mesaj şablonu veya dili bulunamadı.', 132015: 'Mesaj şablonu duraklatılmış.', 133010: 'Gönderici numarası API için kayıtlı değil.' })[Number(code)] || 'WhatsApp gönderimi kabul etmedi. Bağlantıyı kontrol edin.';
}
