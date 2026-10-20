import mongoose from "mongoose";
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 120 },
  company: { type: String, required: true, maxlength: 120 },
  url: { type: String, default: "", maxlength: 2048 },
  revision: { type: Number, required: true, min: 1, validate: Number.isInteger },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
export default mongoose.model("MailOrderCompany", schema);
