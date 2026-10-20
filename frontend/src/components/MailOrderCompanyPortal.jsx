import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../libs/axios.js";
import { companyKey, companyLinkInput } from "../../../backend/src/libs/mailOrderCompanyLinks.js";
const field = "block w-full rounded-lg border border-[#d8c6ae] bg-[#fffdf8] p-3 mt-1";
export default function MailOrderCompanyPortal({ company }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api.get("/mail-order-companies").then(response => { if (active) { setLinks(response.data); setError(false); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  let selected = "";
  try { if (company.trim()) selected = companyKey(company); } catch { /* The receipt form validates the company before saving. */ }
  const record = links.find(link => companyKey(link.company) === selected);
  const editVisible = editing === selected && selected;
  const save = async () => {
    if (busy || loading || error || !selected) return;
    let validated;
    try { validated = companyLinkInput({ company, url: draft, expected_revision: record?.revision || 0 }); }
    catch (validationError) { toast.error(validationError.message); return; }
    setBusy(true);
    try {
      const response = await api.put("/mail-order-companies", { company: validated.company, url: validated.url, expected_revision: validated.revision });
      setLinks(previous => [...previous.filter(link => companyKey(link.company) !== validated.key), response.data]);
      setEditing(null); toast.success(validated.url ? "Firma POS bağlantısı kaydedildi." : "Firma POS bağlantısı kaldırıldı.");
    } catch (saveError) {
      toast.error(saveError.response?.data?.message || "Bağlantı kaydı doğrulanamadı. Yenileyip kontrol edin.");
      if (saveError.response?.status === 409) { setEditing(null); setLoading(true); setAttempt(previous => previous + 1); }
    } finally { setBusy(false); }
  };
  if (!selected) return null;
  return <div className="mt-3 rounded-lg bg-[#f4ecdf] p-3" aria-label="Firma POS bağlantısı">
    {loading ? <p>Firma bağlantısı yükleniyor…</p> : error ? <div><p>Firma bağlantıları yüklenemedi.</p><button type="button" className="border rounded-lg p-2 mt-2" onClick={() => { setLoading(true); setAttempt(previous => previous + 1); }}>Bağlantıları yeniden yükle</button></div> : <>
      <div className="flex flex-wrap gap-3 items-center">
        {record?.url ? <a className="rounded-lg bg-[#80512f] text-white px-4 py-3 font-semibold" href={record.url} target="_blank" rel="noopener noreferrer">Firma POS ekranını aç ↗</a> : <span>Kayıtlı POS bağlantısı yok. Telefonla mail order kaydedebilirsin.</span>}
        <button type="button" disabled={busy} className="border border-[#d8c6ae] rounded-lg px-3 py-2" onClick={() => { setEditing(selected); setDraft(record?.url || ""); }}>{record?.url ? "Linki değiştir" : "Link ekle"}</button>
      </div>
      {editVisible && <div role="group" aria-label="Firma POS linkini düzenle" className="mt-3">
        <label>Firma POS bağlantısı<input type="url" className={field} value={draft} disabled={busy} maxLength={2048} placeholder="https://firmanin-pos-adresi.com" onChange={event => setDraft(event.target.value)} /></label>
        <p className="text-sm mt-2">Bu firmanın bağlantısı sistemde saklanır. Link değişirse buradan güncelleyebilirsin. Kaldırmak için alanı boş bırakıp kaydet.</p>
        <div className="flex gap-3 mt-3"><button type="button" disabled={busy} className="rounded-lg bg-[#80512f] text-white px-4 py-2" onClick={save}>{busy ? "Kaydediliyor…" : "Linki kaydet"}</button><button type="button" disabled={busy} className="border rounded-lg px-3 py-2" onClick={() => setEditing(null)}>Vazgeç</button></div>
      </div>}
      <p className="text-sm text-[#806b56] mt-2">Firma ekranı yeni sekmede açılır; bu sipariş açık kalır. Link kaydetmek tahsilat oluşturmaz.</p>
    </>}
  </div>;
}
