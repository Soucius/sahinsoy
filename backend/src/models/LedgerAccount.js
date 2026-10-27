import mongoose from 'mongoose';
import { GOLD_UNITS } from '../libs/goldUnits.js';

const entry = new mongoose.Schema({
  operation_id: { type: String, required: true }, fingerprint: { type: String, required: true },
  type: { type: String, enum: ['opening', 'debt', 'receivable', 'payment_sent', 'payment_received', 'mail_order', 'invoice', 'reversal'], required: true },
  date: { type: String, required: true }, amount_minor: { type: String, required: true, match: /^\d+$/ }, delta_minor: { type: String, required: true, match: /^-?\d+$/ },
  description: { type: String, maxlength: 500, default: '' }, method: { type: String, default: '' }, reverses: { type: String, default: '' },
  source_sale_id: { type: String, default: '', match: /^(?:[a-f\d]{24})?$/i }, source_payment_id: { type: String, default: '', maxlength: 100 },
  source_invoice_id: { type: String, default: '', maxlength: 36 }, source_invoice_number: { type: String, default: '', maxlength: 100 },
  recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, recorded_name: String, recorded_at: { type: Date, required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 120 }, name_key: { type: String, required: true },
  category: { type: String, enum: ['supplier', 'cargo', 'electricity', 'communication', 'personal', 'other'], required: true }, note: { type: String, maxlength: 500, default: '' },
  currency: { type: String, enum: ['TRY', 'EUR', 'USD', ...Object.keys(GOLD_UNITS)], required: true }, opening_status: { type: String, enum: ['pending', 'confirmed'], required: true }, opening_date: { type: String, default: null },
  balance_minor: { type: String, default: null, match: /^-?\d+$/ }, revision: { type: Number, required: true, default: 0 },
  create_operation: { type: String, required: true, unique: true }, create_fingerprint: { type: String, required: true },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  entries: { type: [entry], required: true, validate: value => value.length <= 5000 },
}, { timestamps: true });
schema.index({ name_key: 1, currency: 1 }, { unique: true });
export default mongoose.model('LedgerAccount', schema);
