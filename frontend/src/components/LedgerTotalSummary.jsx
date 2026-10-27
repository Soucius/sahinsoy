import { goldQuantity, isGoldUnit, ledgerValuation } from '../libs/goldLedger';
import { invoiceAmount } from '../libs/invoiceDisplay';

const decimal = minor => `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const money = minor => invoiceAmount(decimal(minor), 'TRY');
const quantity = (minor, currency) => isGoldUnit(currency) ? goldQuantity(minor, currency) : invoiceAmount(decimal(minor), currency);

export default function LedgerTotalSummary({ accounts, rates, truncated }) {
  const summary = ledgerValuation(accounts, rates.data, rates.now);
  return <section aria-label="TL cinsinden toplam cari bakiyesi" className="rounded-2xl border-2 border-[#754b2e] bg-[#fffaf3] p-5 space-y-4">
    <div><h3 className="text-xl font-bold">Toplam cari bakiyesi · TL karşılığı</h3><p className="text-sm mt-2">Tüm kayıtlı cariler · TL + döviz + altın. Harem satış kuru ile 60 saniyede bir güncellenir; hesapların asıl borç miktarı değişmez.</p></div>
    <div className="grid gap-5 md:grid-cols-2">{['debt', 'receivable'].map(side => {
      const value = summary[side], complete = value.complete && !truncated;
      return <div key={side} className="rounded-xl bg-white border border-[#d8c5ae] p-4"><h4 className="font-semibold">{side === 'debt' ? 'Bilinen toplam borç bakiyesi' : 'Bilinen toplam alacak bakiyesi'}</h4>
        <p className={`text-2xl font-bold mt-2 ${side === 'debt' ? 'text-[#8c4228]' : 'text-[#22634d]'}`}>{complete ? `${value.parts.some(part => part.currency !== 'TRY') ? '≈ ' : ''}${money(value.total_minor)}` : 'Toplam henüz tamamlanamadı'}</p>
        {!complete && <p className="text-sm text-amber-900 mt-2">Hesaplanabilen kısım: {money(value.total_minor)}. Kur bekleyen hesaplar veya eksik liste toplamın dışında.</p>}
        <ul className="mt-4 space-y-3 text-sm">{value.parts.map(part => <li key={part.currency} className="border-t border-[#eadfd1] pt-2"><strong>{quantity(part.quantity_minor, part.currency)}</strong><span className="block">{part.try_minor === null ? 'TL karşılığı: güncel kur bekleniyor' : `= ${money(part.try_minor)}`}</span>{part.quote && <small className="block text-[#78634f]">Harem satış: {part.quote.rate.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} TL/{isGoldUnit(part.currency) ? 'birim' : part.currency} · {new Date(part.quote.timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</small>}</li>)}</ul>
      </div>;
    })}</div>
    {summary.pending_count > 0 && <p className="text-sm text-amber-900">Bakiyesi beklenen {summary.pending_count} cari bu toplama dahil değil.</p>}
    {truncated && <p className="text-sm text-amber-900">Liste ilk 200 cariyi içeriyor; tüm cariler yüklenmeden genel toplam tamamlanamaz.</p>}
  </section>;
}
