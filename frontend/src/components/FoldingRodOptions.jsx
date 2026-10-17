import { formatMoney, formatNumber } from '../libs/curtainCalculation.js';
import { foldingRodOption } from '../libs/foldingRods.js';

export default function FoldingRodOptions({ product, measurement, line, onChange }) {
  const entry = foldingRodOption(product);
  if (!entry) return null;
  const selected = measurement.extra_indices?.includes(entry.index);
  const count = selected ? measurement.accessory_counts?.[entry.option.option_name] ?? 1 : 0;
  const accessory = line?.accessories?.find((option) => option.name === entry.option.option_name);
  return <section className="divider" aria-label="Katlama ara çubuk seçimi">
    <h3>Katlama ara çubuğu</h3>
    <p className="muted">Standart 5+1 takım ürün fiyatına dahildir. Yalnız ilave çubuk adedini girin.</p>
    <div className="fields">
      <label>İlave ara çubuk adedi<input type="number" min="0" max="1000" step="1" inputMode="numeric" value={count} onChange={(event) => onChange(event.target.value)} /></label>
      <p className="muted">Birim fiyat: {formatMoney(entry.option.price_impact, entry.option.currency || product.currency || 'TRY')} / metre<br />Gerçek perde eni × ilave çubuk adedi</p>
    </div>
    {accessory && <p aria-live="polite"><strong>{formatNumber(count)} ilave çubuk · {formatNumber(accessory.quantity)} metre · {formatMoney(accessory.total)}</strong></p>}
  </section>;
}
