import { normalizeName } from './curtainCalculation.js';

// OBA 20 Mayıs 2026, p.4: Stor/Zebra alüminyum etek-çıta farkı palette.
export const HEM_COLORS = ['Beyaz', 'Krem', 'Vizon', 'Bronz', 'Gri', 'Bej', 'Siyah', 'Antrasit'];
// The current Stor portal additionally lists Kahve for the square profile.
export const hemColors = (shape) => shape === 'square' ? [...HEM_COLORS, 'Kahve'] : [...HEM_COLORS];

export function hemAccessoryOptions(product) {
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  if (product?.calculation_type !== 'm2' || !/^(stor|zebra)$/.test(category)) return [];
  return (product.extra_options || []).flatMap((option, index) => {
    const name = normalizeName(option.option_name);
    if (/new\s*tech/.test(name)) return [];
    if (!/aluminyum|metal/.test(name) || !/etek/.test(name)) return [];
    const shape = /yuvarlak/.test(name) ? 'round' : /kare/.test(name) ? 'square' : null;
    return shape ? [{ option, index, shape, label: shape === 'square' ? 'Kare etek çıtası' : 'Yuvarlak etek çıtası' }] : [];
  });
}

export function selectedHemAccessory(product, form = {}) {
  const options = hemAccessoryOptions(product);
  if (!options.length) return null;
  const indices = form.extra_indices || [];
  const includedIndex = (product.extra_options || []).findIndex((option, index) => indices.includes(index) && /new\s*tech/.test(normalizeName(option.option_name)));
  if (includedIndex >= 0) return { index: includedIndex, option: product.extra_options[includedIndex], shape: 'square', label: 'Kare etek çıtası · New Tech mekanizmaya dahil', included: true };
  const selected = options.filter((entry) => indices.includes(entry.index));
  return selected.length === 1 ? selected[0] : null;
}

export function selectHemAccessory(product, form, value) {
  const options = hemAccessoryOptions(product);
  const selected = value === '' ? null : options.find((entry) => String(entry.index) === String(value));
  if (value !== '' && !selected) throw new Error('Etek çıtası modelini ürünün listesinden seçin.');
  const removed = new Set(options.map((entry) => entry.index));
  const indices = (form.extra_indices || []).filter((index) => !removed.has(index));
  if (selected) indices.push(selected.index);
  const colors = { ...(form.accessory_colors || {}) };
  for (const entry of options) if (entry.index !== selected?.index) delete colors[entry.option.option_name];
  return { ...form, extra_indices: indices, accessory_colors: colors };
}

export function normalizeHemForMechanism(product, form = {}) {
  const indices = form.extra_indices || [];
  const hasNewTech = (product.extra_options || []).some((option, index) => indices.includes(index) && /new\s*tech/.test(normalizeName(option.option_name)));
  if (!hasNewTech) return form;
  const options = hemAccessoryOptions(product);
  const removed = new Set(options.map((entry) => entry.index));
  const colors = { ...(form.accessory_colors || {}) };
  for (const entry of options) delete colors[entry.option.option_name];
  return { ...form, extra_indices: indices.filter((index) => !removed.has(index)), accessory_colors: colors };
}

export function hemAccessoryError(product, form = {}) {
  const options = hemAccessoryOptions(product);
  const selection = selectedHemAccessory(product, form);
  if (selection?.included && options.some((entry) => form.extra_indices?.includes(entry.index))) return 'Kare etek çıtası New Tech mekanizmaya dahildir; ayrıca lama farkını kaldırın.';
  if (!selection && options.filter((entry) => form.extra_indices?.includes(entry.index)).length > 1) return 'Tek bir etek çıtası modeli seçin.';
  if (selection && !String(form.accessory_colors?.[selection.option.option_name] || '').trim()) return `${selection.label} için renk seçin.`;
  return '';
}
