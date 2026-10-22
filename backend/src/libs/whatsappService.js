import Notification from '../models/WhatsAppNotification.js';
import ProductionOrder from '../models/ProductionOrder.js';
import Sale from '../models/Sale.js';
import { fingerprint } from './productionWorkflow.js';
import { allProductsReady, connectionSignature, messagePayload, providerError, readyKind, whatsappConfig, whatsappPhone } from './whatsappNotifications.js';

export async function enqueueReadyNotification(before, after, sale, session, config = whatsappConfig()) {
  if (!config.enabled || allProductsReady(before) || !allProductsReady(after) || sale.status !== 'tamamlandi' || sale.measurement_status !== 'confirmed' || after.source_fingerprint !== fingerprint(sale) || !readyKind(sale)) return;
  if (config.mode === 'live' && (!after.whatsapp_consent?.granted_at || after.whatsapp_consent.phone !== whatsappPhone(sale.customer_phone))) return;
  const recipient = config.mode === 'test' ? config.testRecipient : whatsappPhone(sale.customer_phone);
  if (!recipient) return;
  await Notification.updateOne({ event_key: `ready:${sale._id}:${config.mode}` }, { $setOnInsert: {
    sale: sale._id, production_order: after._id, source_fingerprint: after.source_fingerprint,
    kind: readyKind(sale), mode: config.mode, config_signature: connectionSignature(config), recipient,
    // Sandbox never receives a real customer's identity or order information.
    customer_name: config.mode === 'live' ? String(sale.customer_name || 'Müşterimiz').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) : '',
    order_code: config.mode === 'live' ? String(sale._id).slice(-8).toUpperCase() : '', status: 'queued',
  } }, { upsert: true, session, runValidators: true });
}
async function validSource(n, config) {
  if (n.config_signature !== connectionSignature(config)) return false;
  if (n.kind === 'connection_test') return config.mode === 'test';
  const [record, sale] = await Promise.all([
    ProductionOrder.findById(n.production_order).lean(),
    Sale.findById(n.sale).populate({ path: 'sale_items.product', select: 'product_name product_category product_brand', populate: [{ path: 'product_category', select: 'category_name' }, { path: 'product_brand', select: 'brand_name' }] }).select('sale_items pos_details customer_name customer_phone delivery_method status measurement_status measurement_revision').lean(),
  ]);
  return Boolean(sale && record && sale.status === 'tamamlandi' && sale.measurement_status === 'confirmed' && allProductsReady(record) && record.source_fingerprint === n.source_fingerprint && fingerprint(sale) === n.source_fingerprint && (config.mode === 'test' || (record.whatsapp_consent?.granted_at && record.whatsapp_consent.phone === n.recipient && whatsappPhone(sale.customer_phone) === n.recipient && String(sale.customer_name || 'Müşterimiz').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) === n.customer_name)));
}
export async function sendClaimedNotification(n, config, send = fetch) {
  const payload = messagePayload(n, config);
  let response, data;
  try {
    response = await send(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    data = await response.json();
  } catch {
    return { status: 'unknown', detail: 'Bağlantı kesildi; mesaj ulaşmış olabilir. Çift mesajı önlemek için yeniden gönderilmedi.' };
  }
  if (response.ok && typeof data?.messages?.[0]?.id === 'string' && data.messages[0].id.length < 512) return { status: 'accepted', provider_id: data.messages[0].id, detail: '' };
  if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) && data?.error) return { status: 'failed', detail: providerError(data.error.code) };
  return { status: 'unknown', detail: 'WhatsApp kesin gönderim sonucu vermedi. Çift mesajı önlemek için yeniden gönderilmedi.' };
}
let running = false;
export async function drainWhatsAppQueue() {
  const config = whatsappConfig();
  if (running || !config.enabled) return;
  running = true;
  try {
    // A crashed process may have already transmitted its request. Never resend a stale lease.
    await Notification.updateMany({ status: 'sending', started_at: { $lt: new Date(Date.now() - 120000) } }, { $set: { status: 'unknown', detail: 'Gönderim sırasında bağlantı kesildi. Tekrar gönderilmedi.' } });
    for (let i = 0; i < 5; i++) {
      const n = await Notification.findOneAndUpdate({ status: 'queued' }, { $set: { status: 'sending', started_at: new Date() }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).lean();
      if (!n) break;
      let result;
      try {
        result = Date.now() - new Date(n.queued_at || n.createdAt).getTime() > 24 * 60 * 60 * 1000 || !await validSource(n, config) ? { status: 'cancelled', detail: 'Sipariş, müşteri izni veya bağlantı bilgileri değişti; eski bildirim gönderilmedi.' } : await sendClaimedNotification(n, config);
      } catch { result = { status: 'unknown', detail: 'Gönderim kontrolü tamamlanamadı; tekrar gönderilmedi.' }; }
      // A signed delivery webhook may arrive before the HTTP response.
      await Notification.updateOne({ _id: n._id, status: 'sending' }, { $set: result });
    }
  } finally { running = false; }
}
export function kickWhatsAppQueue() { void drainWhatsAppQueue().catch(() => { console.error('WhatsApp gönderim kuyruğu kontrol edilemedi.'); }); }
export async function startWhatsAppWorker() { await Notification.init(); kickWhatsAppQueue(); const timer = setInterval(kickWhatsAppQueue, 20000); timer.unref(); return timer; }
export async function retryNotification(id) {
  const config = whatsappConfig();
  const n = await Notification.findById(id).lean();
  if (!n || n.status !== 'failed' || !config.enabled || !await validSource(n, config)) return false;
  const result = await Notification.updateOne({ _id: n._id, status: 'failed', updatedAt: n.updatedAt }, { $set: { status: 'queued', detail: '', queued_at: new Date() } });
  if (result.modifiedCount) kickWhatsAppQueue();
  return Boolean(result.modifiedCount);
}
