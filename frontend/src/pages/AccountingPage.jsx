import { useEffect, useRef, useState } from 'react';
import api from '../libs/axios';
import { invoiceAmount, invoiceDate, invoiceStatus, invoiceType } from '../libs/invoiceDisplay';
import AccountLedgerPanel from '../components/AccountLedgerPanel';
import InvoiceAutoStatus from '../components/InvoiceAutoStatus';

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
const control = 'rounded-lg border border-[#d8c5ae] bg-white p-3';
const button = `${control} font-semibold disabled:opacity-50`;
export default function AccountingPage() {
  const [tab, setTab] = useState('accounts');
  return <main className="p-4 md:p-8 text-[#3d2d22] space-y-6 max-w-7xl mx-auto"><header><p className="text-sm text-[#78634f]">ŞAHİNSOY · MALİ TAKİP</p><h1 className="text-3xl font-bold mt-2">Faturalar ve Cari</h1></header><InvoiceAutoStatus /><div className="flex flex-wrap gap-3" role="tablist" aria-label="Mali takip bölümü">{[['accounts', 'Cari hesaplar'], ['invoices', 'Gelen faturalar']].map(([key, title]) => <button role="tab" aria-selected={tab === key} key={key} className={tab === key ? button.replace('bg-white', 'bg-[#f4eadc]') : button} onClick={() => setTab(key)}>{title}</button>)}</div><div hidden={tab !== 'accounts'}><AccountLedgerPanel /></div>{tab === 'invoices' && <InvoiceListPanel />}</main>;
}
function InvoiceListPanel() {
  const [connection, setConnection] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const [start, setStart] = useState(() => `${today().slice(0, 8)}01`), [end, setEnd] = useState(today), [result, setResult] = useState(null);
  const [loadedRange, setLoadedRange] = useState(null);
  const request = useRef(0);
  useEffect(() => { let active = true; const counter = request; api.get('/accounting/connection').then(r => { if (active) setConnection(r.data); }).catch(e => { if (active) setError(e.response?.data?.message || 'Fatura bağlantısı yüklenemedi.'); }); return () => { active = false; counter.current++; }; }, []);
  async function load(page = 0) {
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const response = await api.get('/accounting/invoices', { params: { start_date: start, end_date: end, page } });
      if (id === request.current) { setResult(response.data); setLoadedRange({ start, end }); setConnected(true); }
    } catch (e) { if (id === request.current) setError(e.response?.data?.message || 'Faturalar alınamadı.'); }
    finally { if (id === request.current) setBusy(false); }
  }
  async function checkConnection() {
    setBusy(true); setError('');
    try { await api.post('/accounting/connection/test', {}); setConnected(true); }
    catch (e) { setConnected(false); setError(e.response?.data?.message || 'Bağlantı doğrulanamadı.'); }
    finally { setBusy(false); }
  }
  const changedRange = loadedRange && (loadedRange.start !== start || loadedRange.end !== end);
  return <section className="space-y-6" aria-label="Uyumsoft gelen faturaları">
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-[#d8c5ae] bg-[#fffaf3] p-5 space-y-3">
      <h2 className="text-xl font-bold">Uyumsoft Kurumsal bağlantısı</h2>
      <p>{connected ? 'Web servis bağlantısı doğrulandı.' : connection?.configured ? 'Bağlantı bilgileri hazır; henüz doğrulanmadı.' : connection ? 'Güvenli sunucu bağlantısının kurulması bekleniyor.' : 'Bağlantı kontrol ediliyor…'}</p>
      <button className={button} disabled={busy || !connection?.configured} onClick={checkConnection}>Bağlantıyı kontrol et</button>
      <p className="text-sm text-[#78634f]">Bu ekranda fatura kabulü, reddi veya gönderimi yapılmaz. Uyumsoft’taki kayıtlar değiştirilmez.</p>
    </section>
    <section className="rounded-2xl border border-[#d8c5ae] p-5 space-y-3 bg-white"><h2 className="text-xl font-bold">Fatura ve cari kayıtları</h2><p>Otomatik aktarım açıksa başlangıç tarihinden sonraki onaylı satış faturaları eşleşen cariye bir kez işlenir. Başlangıç gününün faturaları da kapsamdadır. “Onaylandı” belge durumudur; ödemenin yapıldığını göstermez. Yeni POS mail order tahsilatları seçilen firma carisine alacak hareketi olarak işlenir.</p><p className="text-sm text-[#78634f]">Güncel net açılış bakiyeleri “Cari hesaplar” bölümünde tutulur. Eski faturaları tekrar borca ekleme.</p></section></div>
    <form className="flex flex-wrap gap-4 items-end" onSubmit={e => { e.preventDefault(); load(0); }}>
      <label className="grid gap-2">Başlangıç tarihi<input className={control} type="date" required value={start} max={end} disabled={busy} onChange={e => setStart(e.target.value)} /></label>
      <label className="grid gap-2">Bitiş tarihi<input className={control} type="date" required value={end} min={start} disabled={busy} onChange={e => setEnd(e.target.value)} /></label>
      <button className={`${button.replace('bg-white', 'bg-[#754b2e]')} text-white`} disabled={busy || !connection?.configured}>{busy ? 'Kontrol ediliyor…' : 'Faturaları listele'}</button>
    </form>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
    {result && <section className="space-y-4" aria-label="Gelen faturalar">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">Gelen faturalar · {result.total_count} kayıt</h2><p>{invoiceDate(loadedRange.start)} – {invoiceDate(loadedRange.end)}</p></div>
      {changedRange && <p className="rounded-lg bg-amber-50 p-3">Tarih seçimi değişti. Aşağıdaki liste önceki tarih aralığına aittir; “Faturaları listele”ye basarak yenile.</p>}
      {result.invoices.length ? <div className="overflow-x-auto rounded-xl border border-[#d8c5ae]"><table className="w-full text-sm text-left bg-white"><thead className="bg-[#f4eadc]"><tr>{['Fatura / tarih', 'Firma', 'Tür', 'KDV dahil tutar', 'KDV', 'Belge durumu', 'Cari'].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{result.invoices.map(i => <tr className="border-t border-[#eadfd1]" key={i.id}><td className="p-3"><strong>{i.number}</strong><div>{invoiceDate(i.date)}</div></td><td className="p-3 min-w-48">{i.supplier}</td><td className="p-3">{invoiceType(i.type)}</td><td className="p-3 whitespace-nowrap font-semibold">{invoiceAmount(i.amount, i.currency)}</td><td className="p-3 whitespace-nowrap">{invoiceAmount(i.tax, i.currency)}</td><td className="p-3">{invoiceStatus(i.status)}</td><td className="p-3">{i.ledger_status || 'Aktarım durumu alınamadı'}</td></tr>)}</tbody></table></div> : <p className="bg-white border rounded-xl p-5">Bu tarih aralığında gelen fatura bulunamadı.</p>}
      <div className="flex items-center gap-4"><button className={button} disabled={busy || changedRange || result.page === 0} onClick={() => load(result.page - 1)}>Önceki</button><span>Sayfa {result.total_pages ? result.page + 1 : 0} / {result.total_pages}</span><button className={button} disabled={busy || changedRange || result.page + 1 >= result.total_pages} onClick={() => load(result.page + 1)}>Sonraki</button></div>
    </section>}
  </section>;
}
