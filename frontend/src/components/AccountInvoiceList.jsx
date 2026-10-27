import { useEffect, useRef, useState } from 'react';
import api from '../libs/axios';
import { invoiceAmount, invoiceDate, invoiceStatus, invoiceType } from '../libs/invoiceDisplay';
import { loadInvoicePages, matchAccountInvoices } from '../libs/accountInvoices';

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
const control = 'rounded-lg border border-[#d8c5ae] bg-white p-2';
export default function AccountInvoiceList({ account }) {
  const [range, setRange] = useState(() => ({ start: `${today().slice(0, 8)}01`, end: today() }));
  const [requestRange, setRequestRange] = useState(() => ({ ...range, version: 0 }));
  const [state, setState] = useState({ result: null, loading: true, error: '' });
  const [supplier, setSupplier] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current, controller = new AbortController();
    let active = true;
    async function load() {
      setState({ result: null, loading: true, error: '' });
      try {
        const result = await loadInvoicePages(async page => (await api.get('/accounting/invoices', { params: { start_date: requestRange.start, end_date: requestRange.end, page }, signal: controller.signal, timeout: 20000 })).data);
        if (active && id === request.current) setState({ result, loading: false, error: '' });
      } catch (error) {
        if (active && id === request.current) setState({ result: null, loading: false, error: error.response?.data?.message || error.message || 'Faturalar alınamadı. Yeniden deneyin.' });
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [account.id, requestRange]);
  const result = state.result, match = matchAccountInvoices(account, result?.invoices || [], supplier);
  const changed = range.start !== requestRange.start || range.end !== requestRange.end;
  function refresh(event) { event.preventDefault(); setSupplier(''); setRequestRange(previous => ({ ...range, version: previous.version + 1 })); }
  return <section aria-label={`${account.name} gelen faturaları`} className="rounded-2xl border border-[#d8c5ae] bg-white p-5 space-y-4">
    <header><h3 className="text-xl font-bold">{account.name} · Gelen faturalar</h3><p className="text-sm text-[#78634f] mt-2">Uyumsoft faturalarını bu carinin içinde gör. Bu liste belge bilgisidir; borç ve ödeme hareketleri hesap geçmişindedir.</p></header>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={refresh}><label className="grid gap-1 text-sm">Başlangıç tarihi<input className={control} type="date" required max={range.end} value={range.start} disabled={state.loading} onChange={event => setRange({ ...range, start: event.target.value })} /></label><label className="grid gap-1 text-sm">Bitiş tarihi<input className={control} type="date" required min={range.start} max={today()} value={range.end} disabled={state.loading} onChange={event => setRange({ ...range, end: event.target.value })} /></label><button className={`${control} font-semibold disabled:opacity-50`} disabled={state.loading}>{state.loading ? 'Faturalar yükleniyor…' : 'Faturaları yenile'}</button></form>
    {state.error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3">{state.error}</p>}
    {changed && <p className="text-sm text-amber-900">Tarih seçimi değişti; “Faturaları yenile”ye bas. Görünen sonuç önceki tarih aralığına aittir.</p>}
    {result && <>
      {!result.complete && <p className="rounded-lg bg-amber-50 text-amber-900 p-3">Seçili aralıktaki {result.source_count} faturanın ilk {result.invoices.length} kaydı tarandı; liste tamamlanmadı. Daha dar bir tarih aralığı seç.</p>}
      {match.matched_supplier ? <p className="text-sm"><strong>Faturadaki firma:</strong> {match.matched_supplier.name} · {match.invoices.length} fatura · {invoiceDate(requestRange.start)} – {invoiceDate(requestRange.end)}</p> : <p className="text-sm text-amber-900">{match.ambiguous ? 'Aynı isimle birden fazla vergi kaydı var. Doğru firmayı seç.' : 'Bu aralıkta cari adıyla eşleşen fatura bulunamadı. Tarihi değiştirebilir veya aşağıdan faturadaki firmayı seçebilirsin.'}</p>}
      {match.suppliers.length > 0 && <details><summary className="text-sm underline cursor-pointer">Faturadaki firmayı seç / değiştir</summary><label className="grid gap-2 text-sm mt-3">Fatura firması<select className={control} value={supplier} onChange={event => setSupplier(event.target.value)}><option value="">Cari adına göre eşleştir</option>{match.suppliers.map(item => <option key={item.identifier} value={item.identifier}>{item.name} · VKN/TCKN sonu {item.identifier.slice(-4)}</option>)}</select></label><p className="text-xs mt-2">Bu seçim yalnız bu listedeki görünümü değiştirir; cari bakiyesine hareket eklemez.</p></details>}
      {match.invoices.length > 0 && <div className="max-h-[440px] overflow-auto rounded-xl border border-[#d8c5ae]"><table className="w-full text-sm text-left"><thead className="sticky top-0 bg-[#f4eadc]"><tr>{['Fatura / tarih', 'Tür', 'KDV dahil tutar', 'KDV', 'Belge durumu', 'Cari bilgisi'].map(title => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>{match.invoices.map(invoice => <tr key={invoice.id} className="border-t border-[#eadfd1]"><td className="p-3 whitespace-nowrap"><strong>{invoice.number}</strong><span className="block mt-1">{invoiceDate(invoice.date)}</span></td><td className="p-3">{invoiceType(invoice.type)}</td><td className="p-3 whitespace-nowrap font-semibold">{invoiceAmount(invoice.amount, invoice.currency)}</td><td className="p-3 whitespace-nowrap">{invoiceAmount(invoice.tax, invoice.currency)}</td><td className="p-3">{invoiceStatus(invoice.status)}</td><td className="p-3 min-w-40"><span>{invoice.ledger_status || 'Aktarım durumu alınamadı'}</span>{account.opening_date && invoice.date <= account.opening_date && <small className="block mt-1 text-amber-900">Açılış tarihinde / öncesinde; açılış bakiyesinde bulunabilir.</small>}{invoice.currency !== account.currency && <small className="block mt-1">Bu carinin para biriminden farklı.</small>}</td></tr>)}</tbody></table></div>}
      <p className="text-xs text-[#78634f]">Belgenin “Onaylandı” olması ödendiğini göstermez. Aktarım durumu sunucudan gelir; bu listeyi görüntülemek tekrar borç oluşturmaz.</p>
    </>}
  </section>;
}
