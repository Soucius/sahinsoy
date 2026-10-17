import { formatMoney } from '../libs/curtainCalculation.js';
import { hemColors, hemAccessoryOptions, selectedHemAccessory } from '../libs/hemAccessories.js';

export default function HemAccessories({ product, measurement, onModelChange, onColorChange }) {
  const options = hemAccessoryOptions(product);
  if (!options.length) return null;
  const selected = selectedHemAccessory(product, measurement);
  const color = selected ? measurement.accessory_colors?.[selected.option.option_name] || '' : '';
  const palette = hemColors(selected?.shape);
  const colors = [...palette, ...(color && !palette.includes(color) ? [color] : [])];
  return <section className="divider" aria-label="Etek çıtası modeli ve rengi">
    <h3>Lama / etek çıtası</h3>
    <div className="fields">
      <label>Etek çıtası modeli<select value={selected ? String(selected.index) : ''} disabled={Boolean(selected?.included)} onChange={(event) => onModelChange(event.target.value)}>
        <option value="">Standart · ilave lama farkı yok</option>
        {options.map((entry) => <option key={entry.index} value={entry.index}>{entry.label} · {formatMoney(entry.option.price_impact, entry.option.currency || 'TRY')} / m</option>)}
        {selected?.included && <option value={selected.index}>{selected.label}</option>}
      </select></label>
      {selected && <label>Etek çıtası rengi<select aria-label="Etek çıtası rengi" value={color} onChange={(event) => onColorChange(selected.option.option_name, event.target.value)}>
        <option value="">Renk seçin</option>{colors.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>}
    </div>
    {selected && <p className="muted">{selected.included ? 'Kare etek çıtası New Tech mekanizmanın içindedir; ayrıca lama farkı eklenmez.' : 'Lama farkı gerçek perde eni üzerinden hesaplanır. Renk seçimi fiyatı değiştirmez.'} Seçtiğiniz renk siparişe kaydedilir.</p>}
  </section>;
}
