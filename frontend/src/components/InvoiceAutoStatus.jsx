import { useEffect, useRef, useState } from 'react';
import api from '../libs/axios';
import { invoiceDate } from '../libs/invoiceDisplay';

const control = 'rounded-lg border border-[#d8c5ae] bg-white p-3 font-semibold disabled:opacity-50';
const tomorrow = () => { const date = new Date(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date())}T12:00:00+03:00`); date.setUTCDate(date.getUTCDate() + 1); return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(date); };
const time = value => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Henüz yapılmadı';
export default function InvoiceAutoStatus() {
  const [state, setState] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [start, setStart] = useState(tomorrow);
  const saving = useRef(false);
  useEffect(() => {
    let active = true, loading = false;
    async function load() { if (loading) return; loading = true; try { const response = await api.get('/accounting/invoice-auto'); if (active) { setState(response.data); setError(''); } } catch (e) { if (active) setError(e.response?.data?.message || 'Aktarım durumu alınamadı.'); } finally { loading = false; } }
    load(); const timer = setInterval(load, 60000); return () => { active = false; clearInterval(timer); };
  }, []);
  async function action(kind) {
    if (saving.current) return; saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (kind === 'check') { const response = await api.post('/accounting/invoice-auto/check', {}); setNotice(response.data.message); setState((await api.get('/accounting/invoice-auto')).data); }
      else setState((await api.post('/accounting/invoice-auto', { enabled: kind === 'enable', ...(kind === 'enable' ? { starts_on: state?.starts_on || start } : {}) })).data);
    } catch (e) { setError(e.response?.data?.message || 'İşlem tamamlanamadı. Durumu yenileyerek kontrol edin.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section aria-label="Otomatik fatura cari aktarımı" className="rounded-2xl border border-[#d8c5ae] bg-[#fffaf3] p-5 space-y-3">
    <h2 className="text-xl font-bold">Otomatik fatura → Cari</h2>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!state ? <p>Aktarım durumu kontrol ediliyor…</p> : <>
      <p><strong>{state.enabled ? 'Açık' : 'Kapalı'}</strong>{state.starts_on && <> · Başlangıç: <strong>{invoiceDate(state.starts_on)}</strong></>}{state.running && ' · Kontrol sürüyor'}</p>
      <p className="text-sm">Sunucu 15 dakikada bir kontrol eder; POS’un açık kalması gerekmez. Başlangıç tarihli ve sonrasındaki onaylı satış faturaları eşleşen cariye yalnız bir kez borç yazılır. Daha eski faturalar açılış bakiyesinde kalır.</p>
      <p className="text-sm">İade/iptal, firma eşleşmesi, para birimi veya açılış bakiyesi sorunu olan belgeler incelemeye ayrılır. Mail order ve ödeme kayıtları mevcut şekilde alacak işler; fatura onayı ödeme anlamına gelmez.</p>
      {!state.starts_on && <label className="flex flex-wrap items-center gap-3">Aktarım başlangıç tarihi<input type="date" className={control} value={start} disabled={busy} onChange={e => setStart(e.target.value)} /></label>}
      <div className="flex flex-wrap gap-3"><button className={control} disabled={busy || (!state.starts_on && !start)} onClick={() => action(state.enabled ? 'pause' : 'enable')}>{state.enabled ? 'Aktarımı duraklat' : 'Otomatik aktarımı aç'}</button>{state.enabled && <button className={control} disabled={busy || state.running} onClick={() => action('check')}>Şimdi kontrol et</button>}</div>
      <p className="text-sm">Son deneme: {time(state.last_attempt)} · Son tamamlanan kontrol: {time(state.last_success)}</p>
      <p className="text-sm">Son tarama: {state.scanned} belge · Yeni işlenen: {state.posted} · Önceden işlenmiş: {state.existing} · İnceleme bekleyen: {state.issue_count}</p>
      {state.error && <p role="alert" className="text-red-800">{state.error}</p>}
      {state.issues?.length > 0 && <details><summary className="cursor-pointer underline">İnceleme bekleyen faturalar ({state.issue_count})</summary><ul className="list-disc pl-5 mt-3 space-y-2 text-sm">{state.issues.map((item, index) => <li key={`${item.number}-${index}`}><strong>{item.number}</strong> · {item.supplier} · {invoiceDate(item.date)} — {item.reason}</li>)}</ul>{state.issue_count > state.issues.length && <p className="text-sm mt-2">İlk {state.issues.length} kayıt gösteriliyor.</p>}</details>}
    </>}
  </section>;
}
