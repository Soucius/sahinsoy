import Notification from '../models/WhatsAppNotification.js';
import { connectionSignature, providerError, publicConnection, publicNotification, validVerifyToken, validWebhookSignature, whatsappConfig, whatsappPhone } from '../libs/whatsappNotifications.js';
import { kickWhatsAppQueue, retryNotification } from '../libs/whatsappService.js';
const fail = res => res.status(500).json({ message: 'WhatsApp bilgileri alınamadı. Tekrar deneyin.' });
export async function getWhatsAppStatus(_req, res) {
  try {
    const records = await Notification.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json({ connection: publicConnection(whatsappConfig()), notifications: records.map(publicNotification) });
  } catch { fail(res); }
}
export async function testWhatsApp(req, res) {
  try {
    const config = whatsappConfig();
    if (!config.enabled || config.mode !== 'test') return res.status(409).json({ message: 'Önce sunucuda Meta deneme bağlantısını tamamlayın.' });
    if (!req.body || Object.keys(req.body).length !== 1 || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(req.body.request_id || '')) return res.status(400).json({ message: 'Deneme isteği geçersiz. Ekranı yenileyin.' });
    const n = await Notification.findOneAndUpdate({ event_key: `test:${req.body.request_id}` }, { $setOnInsert: { kind: 'connection_test', mode: 'test', recipient: config.testRecipient, config_signature: connectionSignature(config), status: 'queued' } }, { upsert: true, new: true, runValidators: true }).lean();
    kickWhatsAppQueue();
    res.status(202).json(publicNotification(n));
  } catch { fail(res); }
}
export async function retryWhatsApp(req, res) {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id || '')) return res.status(400).json({ message: 'Bildirim numarası geçersiz.' });
    if (!req.body || Object.keys(req.body).length) return res.status(400).json({ message: 'İstek geçersiz.' });
    if (!await retryNotification(req.params.id)) return res.status(409).json({ message: 'Yalnız kesin başarısız, güncel ve izinli bildirimler yeniden gönderilebilir. Ekranı yenileyin.' });
    res.status(202).json({ message: 'Bildirim tekrar gönderim için sıraya alındı.' });
  } catch { fail(res); }
}
export function verifyWhatsAppWebhook(req, res) {
  const config = whatsappConfig();
  if (req.query['hub.mode'] !== 'subscribe' || !validVerifyToken(req.query['hub.verify_token'], config.verifyToken) || typeof req.query['hub.challenge'] !== 'string') return res.sendStatus(403);
  res.type('text/plain').send(req.query['hub.challenge']);
}
export async function receiveWhatsAppWebhook(req, res) {
  const config = whatsappConfig();
  if (!validWebhookSignature(req.body, req.get('x-hub-signature-256'), config.appSecret)) return res.sendStatus(401);
  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return res.sendStatus(200);
  try {
    const allowed = { sent: ['sending', 'unknown', 'accepted'], delivered: ['sending', 'unknown', 'accepted', 'sent', 'failed'], read: ['sending', 'unknown', 'accepted', 'sent', 'delivered', 'failed'], failed: ['sending', 'unknown', 'accepted', 'sent'] };
    for (const entry of payload.entry) for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value;
      if (change.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneId || !Array.isArray(value.statuses)) continue;
      // Ignore incoming chats, attachments and contacts. Only store delivery results for our own messages.
      for (const status of value.statuses) {
        if (!allowed[status.status] || typeof status.id !== 'string' || status.id.length > 511) continue;
        const recipient = whatsappPhone(status.recipient_id);
        if (!recipient) continue;
        const opaque = /^[a-f\d]{24}$/i.test(status.biz_opaque_callback_data || '') ? { _id: status.biz_opaque_callback_data } : { provider_id: status.id };
        await Notification.updateOne({ ...opaque, recipient, config_signature: connectionSignature(config), status: { $in: allowed[status.status] }, $or: [{ provider_id: status.id }, { provider_id: { $exists: false } }] }, { $set: { provider_id: status.id, status: status.status, detail: status.status === 'failed' ? providerError(status.errors?.[0]?.code) : '' } });
      }
    }
    res.sendStatus(200);
  } catch { res.sendStatus(503); }
}
