export const PAYMENT_METHODS = ["Nakit", "Havale / EFT", "Kredi Kartı", "Mail Order"];
export const PAYMENT_KINDS = ["Kapora", "Ara ödeme", "Teslimat ödemesi", "Tam ödeme"];
export class PaymentInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const cent = (value) => Math.round((Number(value) + Number.EPSILON) * 100);
const plain = (entry) => typeof entry.toObject === "function" ? entry.toObject() : entry;
export function paymentSummary(sale) {
  const records = Array.isArray(sale?.payments) ? sale.payments : [];
  const paidCents = records.filter((entry) => !entry.voided_at).reduce((sum, entry) => sum + cent(entry.amount), 0);
  const totalCents = cent(sale?.grand_total || 0);
  const chargeCents = sale?.status === "iptal" ? 0 : totalCents;
  const balance = Math.max(0, chargeCents - paidCents) / 100;
  const credit = Math.max(0, paidCents - chargeCents) / 100;
  const statusLabel = credit > 0 ? "Müşteri alacağı / iade değerlendirmesi" : sale?.status === "iptal" ? "Sipariş iptal edildi" : balance > 0 ? "Ödeme beklemede" : totalCents > 0 ? "Ödeme tamamlandı" : "Ödeme gerekmiyor";
  return { total: totalCents / 100, paid: paidCents / 100, balance, credit, statusLabel, records };
}
function object(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new PaymentInputError("Tahsilat alanlarını kontrol edin.");
}
function revision(sale, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new PaymentInputError("Tahsilat sürümü geçersiz; siparişi yenileyin.");
  if ((sale.payment_revision || 0) !== expected) throw new PaymentInputError("Tahsilat kayıtları başka bir ekranda değişti. Siparişi yenileyin.", 409);
}
function text(value, max, label) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new PaymentInputError(`${label} geçersiz.`);
  return value.trim();
}
export function paymentEntry(sale, input, actor, now = new Date()) {
  object(input, ["request_id", "expected_revision", "amount", "method", "kind", "paid_date", "note", "company"]);
  if (typeof input.request_id !== "string" || !/^[a-zA-Z\d_-]{8,100}$/.test(input.request_id)) throw new PaymentInputError("Tahsilat işlem kimliği geçersiz.");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0 || !Number.isSafeInteger(cent(input.amount)) || Math.abs(cent(input.amount) / 100 - input.amount) > 0.0000001) throw new PaymentInputError("Tahsilat tutarını pozitif ve en fazla iki ondalık olarak girin.");
  if (!PAYMENT_METHODS.includes(input.method) || !PAYMENT_KINDS.includes(input.kind)) throw new PaymentInputError("Tahsilat türünü ve ödeme yöntemini seçin.");
  if (typeof input.paid_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.paid_date) || !Number.isFinite(Date.parse(`${input.paid_date}T00:00:00Z`)) || new Date(`${input.paid_date}T00:00:00Z`).toISOString().slice(0,10) !== input.paid_date) throw new PaymentInputError("Tahsilat tarihi geçersiz.");
  const note = text(input.note ?? "", 500, "Tahsilat notu");
  const company = text(input.company ?? "", 120, "Mail order firması");
  if (company && input.method !== "Mail Order") throw new PaymentInputError("Firma seçimi yalnız mail order tahsilatında kullanılabilir.");
  const entry = { request_id: input.request_id, amount: cent(input.amount) / 100, method: input.method, kind: input.kind, paid_date: input.paid_date, note, company };
  const prior = (sale.payments || []).find((item) => item.request_id === entry.request_id);
  if (prior) {
    if (Object.keys(entry).some((key) => (key === "company" ? plain(prior)[key] ?? "" : plain(prior)[key]) !== entry[key])) throw new PaymentInputError("Aynı tahsilat işlem kimliği farklı bilgilerle kullanılamaz.", 409);
    return { existing: true, entry: prior };
  }
  if (!["tamamlandi", "teslim_edildi"].includes(sale.status)) throw new PaymentInputError("Tahsilat yalnız onaylanmış veya teslim edilmiş siparişe eklenebilir.", 409);
  revision(sale, input.expected_revision);
  if ((sale.payments || []).length >= 1000) throw new PaymentInputError("Siparişin tahsilat kayıt sınırına ulaşıldı.");
  if (cent(entry.amount) > cent(paymentSummary(sale).balance)) throw new PaymentInputError("Tahsilat tutarı kalan bakiyeden fazla olamaz.");
  return { existing: false, entry: { ...entry, recorded_at: now, recorded_by: actor, voided_at: null } };
}
export function paymentVoid(sale, requestId, input, actor, now = new Date()) {
  object(input, ["expected_revision", "reason"]);
  const entry = (sale.payments || []).find((item) => item.request_id === requestId);
  if (!entry) throw new PaymentInputError("Tahsilat kaydı bulunamadı.", 404);
  if (entry.voided_at) return { existing: true, entry };
  revision(sale, input.expected_revision);
  const reason = text(input.reason ?? "", 500, "Düzeltme açıklaması");
  if (!reason) throw new PaymentInputError("Hatalı tahsilat kaydı için düzeltme açıklaması girin.");
  return { existing: false, entry, changes: { voided_at: now, voided_by: actor, void_reason: reason } };
}
