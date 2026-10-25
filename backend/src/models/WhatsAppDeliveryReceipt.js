import mongoose from 'mongoose';

// Minimal authenticated delivery journal; never retain incoming chats or full webhook bodies.
const schema = new mongoose.Schema({
  config_signature: { type: String, required: true, maxlength: 64 },
  provider_id: { type: String, required: true, maxlength: 36 },
  recipient: { type: String, required: true, maxlength: 15 },
  status: { type: String, required: true, enum: ['sent', 'delivered', 'read', 'failed'] },
  error_code: { type: Number, min: 1, max: 999999, validate: Number.isInteger },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 5 * 86400000) },
});
schema.index({ config_signature: 1, provider_id: 1, recipient: 1, status: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model('WhatsAppDeliveryReceipt', schema);
