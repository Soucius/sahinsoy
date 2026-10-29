import { useEffect, useRef, useState } from 'react';
const field = 'w-full rounded-xl border border-[#b99a77] bg-white px-3 py-3 text-xl';
const button = 'rounded-xl border border-[#a78159] px-4 py-3 font-semibold disabled:opacity-50';
function Dimensions({ value, change, widthOnly = false, widthTitle = 'En (cm)', heightTitle = 'Boy (cm)', disabled }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="grid gap-2">{widthTitle}<input className={field} inputMode="decimal" required value={value.width ?? ''} disabled={disabled} onChange={event => change('width', event.target.value)} /></label>{!widthOnly && <label className="grid gap-2">{heightTitle}<input className={field} inputMode="decimal" required value={value.height ?? ''} disabled={disabled} onChange={event => change('height', event.target.value)} /></label>}</div>;
}
export default function StaffMeasurementEditor({ saleId, client, onClose, onSaved }) {
  const [data, setData] = useState(null), [forms, setForms] = useState([]), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const saving = useRef(false), requestId = useRef(null);
  useEffect(() => { let stopped = false; client.get(`/visits/${saleId}/measurements`).then(r => { if (!stopped) { setData(r.data); setForms(r.data.lines.map(line => line.form)); } }).catch(e => { if (!stopped) setError(e.response?.data?.message || 'Ölçü işi yüklenemedi. Listeyi yenileyin.'); }); return () => { stopped = true; }; }, [client, saleId]);
  function change(line, key, value) {
    requestId.current = null;
    setForms(previous => previous.map(form => {
      const other = data.lines.find(row => row.id === form.line_id), shared = line.dual_group && other?.dual_group === line.dual_group && (key === 'width' || key === 'height' && line.shared_measurements);
      return form.line_id === line.id || shared ? { ...form, [key]: value } : form;
    }));
  }
  async function save(event) {
    event.preventDefault(); if (saving.current || !data) return; saving.current = true; setBusy(true); setError(''); requestId.current ||= crypto.randomUUID();
    try { const result = await client.post(`/visits/${saleId}/measurements`, { request_id: requestId.current, expected_revision: data.expected_revision, expected_visit_revision: data.expected_visit_revision, expected_fingerprint: data.expected_fingerprint, measurements: forms, note }); if (!result.data?.saved) throw new Error('Kayıt sonucu doğrulanamadı.'); onSaved(); }
    catch (e) { setError(e.response?.data?.message || 'Kayıt sonucu doğrulanamadı. Aynı ölçüleri tekrar kaydedebilirsin; yeni kayıt açmadan önce son durumu kontrol et.'); }
    finally { saving.current = false; setBusy(false); }
  }
  const seen = new Set();
  const lines = (data?.lines || []).filter(line => { if (line.motor) return false; if (line.shared_measurements && line.dual_group) { if (seen.has(line.dual_group)) return false; seen.add(line.dual_group); } return true; });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"><section role="dialog" aria-modal="true" aria-label="Yerinde alınan ölçüleri gir" className="w-full max-w-4xl max-h-[94vh] overflow-auto rounded-2xl bg-[#fffaf3] p-4 sm:p-6 text-[#3d2d22]">
    <header className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold">{data?.customer_name || 'Ölçü işi'} · {data?.confirmed ? 'Ölçüyü düzelt' : 'Ölçüyü aldım'}</h2><p className="mt-2">Yeni ölçüleri santimetre olarak gir. Aynıysa mevcut ölçüleri kaydederek teyit edebilirsin.</p></div><button type="button" className={button} disabled={busy} onClick={onClose}>Kapat</button></header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 mt-4">{error}</p>}
    {!data ? <p className="py-5">Ölçüler yükleniyor…</p> : <form onSubmit={save} className="space-y-5 mt-5"><fieldset disabled={busy} className="space-y-4">{lines.map(line => {
      const form = forms.find(row => row.line_id === line.id), partner = line.shared_measurements && line.dual_group ? data.lines.find(row => row.dual_group === line.dual_group && row.id !== line.id) : null;
      return <article key={line.id} className="rounded-2xl border border-[#d8c5ae] bg-white p-4 space-y-4"><h3 className="text-xl font-bold">{line.name}{partner ? ` + ${partner.name}` : ''}</h3><p>{[line.room, line.area, line.variant ? `Renk / VR: ${line.variant}` : ''].filter(Boolean).join(' · ')}</p>{partner && <p>Çiftli sistem · ortak cam ölçüsü iki kumaşa birlikte uygulanır.</p>}
        {form.mechanical_panels?.length ? <>{form.mechanical_panels.map((panel, index) => <div key={index} className="border-t pt-3 space-y-3"><h4 className="font-semibold">{line.panel_labels[index]}</h4><Dimensions value={panel} disabled={busy} change={(key, value) => change(line, 'mechanical_panels', form.mechanical_panels.map((old, i) => i === index ? { ...old, [key]: value } : old))} /></div>)}{Object.hasOwn(form, 'profile_width_cm') && <label className="grid gap-2">Fiziksel kasa / profil eni (cm)<input className={field} inputMode="decimal" value={form.profile_width_cm ?? ''} onChange={event => change(line, 'profile_width_cm', event.target.value)} /></label>}</> : <>
          <Dimensions value={form} disabled={busy} widthOnly={line.width_only} widthTitle={Object.hasOwn(form, 'right_width') ? 'Sol kanat eni (cm)' : line.dual_group ? 'Ortak cam eni (cm)' : 'En (cm)'} change={(key, value) => change(line, key, value)} />
          {Object.hasOwn(form, 'right_width') && <Dimensions value={{ width: form.right_width, height: form.right_height }} disabled={busy} widthTitle="Sağ kanat eni (cm)" heightTitle="Sağ kanat boyu (cm)" change={(key, value) => change(line, key === 'width' ? 'right_width' : 'right_height', value)} />}
        </>}
      </article>;
    })}<label className="grid gap-2 font-semibold">Ölçü notu<textarea className={field} maxLength={2000} rows={3} value={note} onChange={event => { requestId.current = null; setNote(event.target.value); }} /></label></fieldset>
      <p className="rounded-xl bg-amber-50 border border-amber-200 p-4">Kaydedince ölçü kesinleşir; sipariş miktarı ve tutarı kayıtlı birim fiyatlarla otomatik güncellenir. Üretime aktarılmış işte güncel ölçülerin alındığını mağazayla kontrol et.</p>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className={`${button} bg-[#80512f] text-white`}>{busy ? 'Kaydediliyor…' : data.confirmed ? 'Yeni ölçüleri kaydet' : 'Ölçüyü aldım · Kaydet'}</button><button type="button" className={button} disabled={busy} onClick={onClose}>Vazgeç</button></div>
    </form>}
  </section></div>;
}
