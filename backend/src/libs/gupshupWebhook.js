import Receipt from '../models/WhatsAppDeliveryReceipt.js';
import Notification from '../models/WhatsAppNotification.js';
import { connectionSignature, validVerifyToken, whatsappPhone } from './whatsappNotifications.js';
import { isGupshupId } from './gupshupTransport.js';

const allowed = {
  sent: ['sending', 'unknown', 'accepted'],
  delivered: ['sending', 'unknown', 'accepted', 'sent', 'failed'],
  read: ['sending', 'unknown', 'accepted', 'sent', 'delivered', 'failed'],
  failed: ['sending', 'unknown', 'accepted', 'sent'],
};
export async function applyGupshupReceipts(providerId, config) {
  if (!isGupshupId(providerId)) return;
  const signature = connectionSignature(config);
  const receipts = await Receipt.find({ config_signature: signature, provider_id: providerId }).sort({ createdAt: 1 }).limit(20).lean();
  for (const r of receipts) {
    if (!allowed[r.status]) continue;
    await Notification.updateOne({
      config_signature: signature, provider_id: providerId, recipient: r.recipient, status: { $in: allowed[r.status] },
    }, { $set: { status: r.status, detail: r.status === 'failed' ? 'Gupshup mesajın teslim edilemediğini bildirdi.' : '' } });
  }
}
export async function receiveGupshupWebhook(req, res, config) {
  if (!validVerifyToken(req.get('x-sahinsoy-webhook-token'), config.gupshupWebhookToken)) return res.sendStatus(401);
  if (!Buffer.isBuffer(req.body)) return res.sendStatus(400);
  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  // Use the provider's Meta-format (v3) callback, with a dedicated secret header.
  if (payload?.object !== 'whatsapp_business_account' || payload.gs_app_id !== config.gupshupAppId || !Array.isArray(payload.entry)) return res.sendStatus(200);
  try {
    for (const entry of payload.entry) for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value;
      if (change.field !== 'messages' || !Array.isArray(value?.statuses)) continue;
      if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== (config.gupshupPhoneId || config.phoneId)) continue;
      for (const status of value.statuses) {
        const recipient = whatsappPhone(status.recipient_id);
        if (!recipient || !allowed[status.status] || !isGupshupId(status.gs_id)) continue;
        // Pre-Meta failures may lack metadata; the authenticated app and exact
        // Gupshup request id still bind these to our own outgoing notification.
        if (!value.metadata?.phone_number_id && status.status !== 'failed') continue;
        const event = { config_signature: connectionSignature(config), provider_id: status.gs_id, recipient, status: status.status };
        // Journal before lookup: a delivery callback can beat the send HTTP response.
        try { await Receipt.updateOne(event, { $setOnInsert: event }, { upsert: true, runValidators: true }); }
        catch (error) { if (error.code !== 11000) throw error; }
        await applyGupshupReceipts(status.gs_id, config);
      }
    }
    return res.sendStatus(200);
  } catch { return res.sendStatus(503); }
}
