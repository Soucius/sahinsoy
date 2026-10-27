import { freshLedgerQuote, goldTryMinor, GOLD_UNITS, isValuedUnit } from '../libs/goldLedger';
import { invoiceAmount } from '../libs/invoiceDisplay';

export default function GoldEquivalent({ minor, currency, rates }) {
  if (!isValuedUnit(currency)) return null;
  const quote = freshLedgerQuote(rates?.data, currency, rates?.now);
  if (!quote) return <small className="block mt-2 text-amber-800">TL karşılığı: güncel kur {rates?.busy ? 'yükleniyor…' : 'alınamadı'}</small>;
  const value = BigInt(goldTryMinor(minor, quote.rate));
  const decimal = `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  return <span className="block mt-2 text-sm text-[#78634f]"><strong>≈ {invoiceAmount(decimal, 'TRY')}</strong><small className="block">Harem satış · {quote.rate.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} TL/{GOLD_UNITS[currency]?.unit || currency}</small><small className="block">{new Date(quote.timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</small></span>;
}
