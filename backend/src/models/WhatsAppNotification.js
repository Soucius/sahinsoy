import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  event_key: { type: String, required: true, unique: true },
  sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  production_order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  source_fingerprint: String,
  kind: { type: String, enum: ['ready_store', 'ready_installation', 'connection_test'], required: true },
  mode: { type: String, enum: ['test', 'live'], required: true },
  config_signature: { type: String, required: true },
  recipient: { type: String, required: true },
  customer_name: { type: String, maxlength: 120 }, order_code: String,
  status: { type: String, enum: ['queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown', 'cancelled'], default: 'queued', index: true },
  provider_id: { type: String, index: true },
  attempts: { type: Number, default: 0 }, started_at: Date, queued_at: { type: Date, default: Date.now },
  detail: { type: String, default: '' },
}, { timestamps: true });
export default mongoose.model('WhatsAppNotification', schema);
