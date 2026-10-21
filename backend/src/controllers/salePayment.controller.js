import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import { paymentEntry, paymentVoid, PaymentInputError } from "../libs/orderPayments.js";

async function changePayment(req, res, voiding) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Sipariş kimliği geçersiz." });
  const session = await mongoose.startSession();
  try {
    let savedId;
    await session.withTransaction(async () => {
      const sale = await Sale.findById(req.params.id).session(session);
      if (!sale) throw new PaymentInputError("Sipariş bulunamadı.", 404);
      const result = voiding ? paymentVoid(sale, req.params.paymentId, req.body, req.user._id) : paymentEntry(sale, req.body, req.user._id);
      if (!result.existing) {
        if (voiding) Object.assign(result.entry, result.changes);
        else { if (!Array.isArray(sale.payments)) sale.payments = []; sale.payments.push(result.entry);
          if (result.entry.mark_delivered && sale.status === "tamamlandi") {
            const now = result.entry.recorded_at;
            if (!sale.approved_at) sale.approved_at = sale.updatedAt || sale.createdAt || now;
            sale.status = "teslim_edildi"; sale.delivered_at = now; sale.delivered_by = req.user._id;
          }
        }
        sale.payment_revision = (sale.payment_revision || 0) + 1;
        await sale.save({ session });
      }
      savedId = sale._id;
    });
    res.json(await Sale.findById(savedId).populate("sale_items.product", "product_name calculation_type"));
  } catch (error) {
    if (error instanceof PaymentInputError) return res.status(error.status).json({ message: error.message });
    console.error("Tahsilat kaydı doğrulanamadı.");
    return res.status(500).json({ message: "Tahsilat sonucu doğrulanamadı. Aynı kaydı yeniden doğrulayın; yeni kayıt oluşturmayın." });
  } finally { await session.endSession(); }
}
export const addSalePayment = (req, res) => changePayment(req, res, false);
export const voidSalePayment = (req, res) => changePayment(req, res, true);
