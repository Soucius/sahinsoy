import mongoose from 'mongoose';
const assignment = { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionStaff', default: null };
const job = new mongoose.Schema({
  line_id: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  supply: { type: String, enum: ['awaiting_order', 'ordered', 'in_transit', 'received'], default: 'awaiting_order' },
  stage: { type: String, enum: ['waiting', 'cutting', 'cut', 'sewing', 'sewn', 'ready', 'installation', 'installed'], default: 'waiting' },
  cutting: assignment, sewing: assignment, installation: assignment,
  note: { type: String, default: '', maxlength: 1000 },
  tracking: { type: String, default: '', maxlength: 200 },
}, { _id: false });
const event = new mongoose.Schema({
  at: { type: Date, required: true }, actor_id: { type: String, required: true },
  actor_name: { type: String, required: true }, actor_kind: { type: String, enum: ['admin', 'staff'], required: true },
  line_id: { type: String, default: '' }, action: { type: String, required: true },
  before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed,
}, { _id: false });
const schema = new mongoose.Schema({
  sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true, unique: true },
  source_fingerprint: { type: String, required: true },
  revision: { type: Number, default: 0, min: 0 },
  jobs: { type: [job], default: [] },
  history: { type: [event], default: [] },
  whatsapp_consent: { granted_at: Date, granted_by: String, phone: String },
}, { timestamps: true });
export default mongoose.model('ProductionOrder', schema);
