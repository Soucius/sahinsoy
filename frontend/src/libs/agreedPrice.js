import { orderTotals, roundMoney } from "./curtainCalculation.js";

// Keep the unrounded rate: 22,000 -> 20,000 must not become 20,000.20
// through rounding the automatically calculated percentage to 9.09.
export function discountForAgreedTotal(cart, agreedTotal, savedFee = 0) {
  const text = String(agreedTotal ?? "").trim().replace(",", ".");
  if (!text || !Number.isFinite(Number(text)) || Number(text) < 0) throw new Error("Anlaşılan toplam tutar için sıfır veya daha büyük bir tutar girin.");
  const target = roundMoney(Number(text));
  const fee = Number(savedFee);
  if (!Number.isFinite(fee) || fee < 0) throw new Error("Kayıtlı ödeme farkı geçersiz.");
  const { subtotal } = orderTotals(cart, 0);
  const subtotalCents = Math.round(subtotal * 100);
  const feeCents = Math.round(roundMoney(fee) * 100);
  const targetCents = Math.round(target * 100);
  if (targetCents < feeCents) throw new Error("Anlaşılan toplam tutar, kayıtlı ödeme farkından az olamaz.");
  if (targetCents > subtotalCents + feeCents) throw new Error("Anlaşılan toplam tutar, iskonto öncesi toplamı aşamaz.");
  const discountCents = subtotalCents + feeCents - targetCents;
  const percent = subtotalCents ? discountCents / subtotalCents * 100 : 0;
  if (roundMoney(orderTotals(cart, percent).total + roundMoney(fee)) !== target) throw new Error("Anlaşılan tutar kuruş hassasiyetinde hesaplanamadı.");
  return percent;
}

export function discountPercentInput(percent) {
  return String(Math.round((Number(percent) + Number.EPSILON) * 100) / 100);
}

export function discountLabel(percent, minimumFractionDigits = 0) {
  const rounded = Number(discountPercentInput(percent));
  const approximate = Math.abs(Number(percent) - rounded) > 0.00000001;
  return `${approximate ? "≈ " : ""}%${rounded.toLocaleString("tr-TR", { minimumFractionDigits, maximumFractionDigits: 2 })}`;
}
