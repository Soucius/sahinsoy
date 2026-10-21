import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 80 },
  username: { type: String, required: true, unique: true, maxlength: 80 },
  password_hash: { type: String, required: true, select: false },
  duties: { type: [String], enum: ['cutting', 'sewing', 'installation'], required: true },
  active: { type: Boolean, default: true },
  session_version: { type: Number, default: 0 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  access_history: { type: [new mongoose.Schema({ at: Date, by: String, action: String }, { _id: false })], default: [] },
}, { timestamps: true });
export default mongoose.model('ProductionStaff', schema);
