import { useRef, useState } from "react";
import api from "../libs/axios.js";
import toast from "react-hot-toast";
import { PAYMENT_KINDS, PAYMENT_METHODS, paymentSummary } from "../../../backend/src/libs/orderPayments.js";
import { formatMoney } from "../libs/curtainCalculation.js";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const newForm = () => ({ amount: "", kind: "Kapora", method: "Nakit", paid_date: today(), note: "" });
const key = () => globalThis.crypto?.randomUUID?.() || `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fieldClass = "block w-full rounded-lg border border-[#d8c6ae] bg-[#fffdf8] p-3 mt-1";
export default function PaymentPanel({ sale, onUpdate }) {
  const [form, setForm] = useState(newForm);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [reason, setReason] = useState("");
  const pending = useRef(null), working = useRef(false);
  const summary = paymentSummary(sale);
  const canAdd = ["tamamlandi", "teslim_edildi"].includes(sale.status);
  const update = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));
  const freshSale = async () => {
    const response = await api.get("/sales");
    const record = response.data.find((item) => item._id === sale._id);
    if (!record) throw new Error("Sipariş bulunamadı.");
    onUpdate(record);
    return record;
  };
  const accept = (record) => {
    onUpdate(record); pending.current = null; setUncertain(false);
    setForm((previous) => ({ ...previous, amount: "", note: "", kind: "Teslimat ödemesi" }));
    toast.success("Tahsilat kaydedildi. Kalan bakiye güncellendi.");
  };
  const save = async (event) => {
    event.preventDefault();
    if (working.current || !canAdd) return;
    const payload = pending.current || { ...form, amount: Number(String(form.amount).replace(",", ".")), request_id: key(), expected_revision: sale.payment_revision || 0 };
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) { toast.error("Tahsilat tutarını girin."); return; }
    pending.current = payload; working.current = true; setBusy(true);
    try {
      const response = await api.post(`/sales/${sale._id}/payments`, payload);
      if (response.data?._id !== sale._id || !response.data.payments?.some((entry) => entry.request_id === payload.request_id)) throw new Error("Tahsilat sonucu doğrulanamadı.");
      accept(response.data);
    } catch (error) {
      let confirmed = false;
      try {
        const record = await freshSale();
        if (record.payments?.some((entry) => entry.request_id === payload.request_id)) { accept(record); confirmed = true; }
      } catch { /* Retry the same immutable request after an uncertain response. */ }
      if (!confirmed) {
        if (error.response?.status >= 400 && error.response.status < 500) { pending.current = null; setUncertain(false); }
        else setUncertain(true);
        toast.error(error.response?.data?.message || "Sonuç doğrulanamadı. Aynı kaydı yeniden doğrula düğmesini kullanın.");
      }
    } finally { working.current = false; setBusy(false); }
  };
  const voidPayment = async () => {
    if (working.current || !voidTarget || !reason.trim()) return;
    working.current = true; setBusy(true);
    try {
      const response = await api.post(`/sales/${sale._id}/payments/${voidTarget}/void`, { expected_revision: sale.payment_revision || 0, reason });
      if (!response.data?.payments?.some((entry) => entry.request_id === voidTarget && entry.voided_at)) throw new Error("Düzeltme doğrulanamadı.");
      onUpdate(response.data); setVoidTarget(null); setReason(""); toast.success("Hatalı tahsilat kaydı geçersiz kılındı; geçmişte korunuyor.");
    } catch (error) {
      let confirmed = false;
      try { const record = await freshSale(); if (record.payments?.some((entry) => entry.request_id === voidTarget && entry.voided_at)) { confirmed = true; setVoidTarget(null); setReason(""); } } catch { /* Keep correction available for an idempotent retry. */ }
      if (!confirmed) toast.error(error.response?.data?.message || "Düzeltme doğrulanamadı; kayıtları yenileyip tekrar kontrol edin.");
    } finally { working.current = false; setBusy(false); }
  };
  return <section className="rounded-2xl border border-[#d8c6ae] bg-[#fffdf8] p-5 text-[#443325] mt-5" aria-label="Kapora ve tahsilatlar">
    <h2 className="text-xl font-bold">Kapora ve tahsilatlar</h2><p className="mt-3 inline-block rounded-full border border-[#d8c6ae] bg-[#f4ecdf] px-3 py-2 font-semibold" role="status">{summary.statusLabel}</p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4" aria-live="polite">
      {[["Sipariş bedeli",summary.total],["Kayıtlı tahsilat",summary.paid],[summary.credit > 0 ? "Müşteri alacağı / iade değerlendirmesi" : "Kayıtlara göre kalan",summary.credit || summary.balance]].map(([label,value]) => <div key={label} className="rounded-xl bg-[#f4ecdf] p-3"><p className="text-sm">{label}</p><strong className="text-xl">{formatMoney(value)}</strong></div>)}
    </div>
    <p className="text-sm text-[#806b56]">Yalnız kaydedilen tahsilatlar hesaba katılır. Kapora ve ödemeler sipariş bedelini değiştirmez.</p>
    {summary.records.length > 0 ? <div className="overflow-x-auto my-4"><table className="w-full text-left text-sm"><thead><tr>{["Tarih / tür", "Yöntem", "Tutar", "Kayıt"].map((label) => <th key={label} className="p-2 bg-[#efe0ca]">{label}</th>)}</tr></thead><tbody>{summary.records.map((entry) => <tr key={entry.request_id} className={entry.voided_at ? "text-[#806b56]" : ""}>
      <td className="border-b border-[#e2d2bd] p-2">{entry.paid_date.split("-").reverse().join(".")}<br />{entry.kind}{entry.note && <p>{entry.note}</p>}</td><td className="border-b border-[#e2d2bd] p-2">{entry.method}</td><td className="border-b border-[#e2d2bd] p-2 whitespace-nowrap">{entry.voided_at ? <del>{formatMoney(entry.amount)}</del> : <strong>{formatMoney(entry.amount)}</strong>}</td><td className="border-b border-[#e2d2bd] p-2">{entry.voided_at ? <>Geçersiz kayıt<p>{entry.void_reason}</p></> : <button type="button" disabled={busy || uncertain} onClick={() => { setVoidTarget(entry.request_id); setReason(""); }} className="rounded-lg border p-2">Hatalı kaydı düzelt</button>}</td>
    </tr>)}</tbody></table></div> : <p className="my-4">Henüz tahsilat kaydı yok.</p>}
    {voidTarget && <div className="rounded-xl border border-[#d8c6ae] p-4 my-4" role="group" aria-label="Tahsilat kaydını düzelt">
      <p>Bu işlem yalnız hatalı kaydı geçersiz kılar; para iadesi yapmaz. Kayıt geçmişte korunur.</p>
      <label className="block mt-3">Düzeltme açıklaması<input className={fieldClass} value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-3 mt-3"><button type="button" disabled={busy || !reason.trim()} onClick={voidPayment} className="border rounded-lg p-3">Hatalı kaydı geçersiz kıl</button><button type="button" disabled={busy} onClick={() => setVoidTarget(null)} className="border rounded-lg p-3">Vazgeç</button></div>
    </div>}
    {canAdd ? <form onSubmit={save} className="mt-5">
      <fieldset disabled={busy || uncertain} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label>Tahsilat tutarı (₺)<input className={fieldClass} type="number" inputMode="decimal" min="0.01" max={summary.balance} step="0.01" value={form.amount} onChange={(event) => update("amount",event.target.value)} required /></label>
        <label>Tahsilat türü<select className={fieldClass} value={form.kind} onChange={(event) => update("kind",event.target.value)}>{PAYMENT_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label>Tahsilat yöntemi<select className={fieldClass} value={form.method} onChange={(event) => update("method",event.target.value)}>{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
        <label>Tahsilat tarihi<input className={fieldClass} type="date" value={form.paid_date} onChange={(event) => update("paid_date",event.target.value)} required /></label>
        <label className="sm:col-span-2">Tahsilat notu<input className={fieldClass} value={form.note} onChange={(event) => update("note",event.target.value)} maxLength={500} placeholder="Örn. mail order çekilen firma veya havale açıklaması" /></label>
      </fieldset>
      {uncertain && <p role="alert" className="mt-3 font-semibold">İşlem sonucu henüz doğrulanamadı. Yeni tahsilat girmeden aynı kaydı yeniden doğrulayın.</p>}
      <div className="flex flex-wrap gap-3 mt-4"><button type="button" disabled={busy || uncertain || summary.balance <= 0} className="border rounded-lg p-3" onClick={() => setForm((previous) => ({ ...previous, amount: String(summary.balance), kind: summary.paid > 0 ? "Teslimat ödemesi" : "Tam ödeme" }))}>Kalanın tamamı</button><button type="submit" disabled={busy || (!uncertain && summary.balance <= 0)} className="rounded-lg bg-[#80512f] text-white px-5 py-3 font-semibold">{busy ? "Kaydediliyor…" : uncertain ? "Aynı kaydı yeniden doğrula" : "Tahsilatı kaydet"}</button></div>
    </form> : <p className="mt-4">Yeni tahsilat için sipariş onaylanmış olmalıdır.{sale.status === "iptal" && " İptal, daha önce alınan parayı otomatik iade etmez."}</p>}
  </section>;
}
