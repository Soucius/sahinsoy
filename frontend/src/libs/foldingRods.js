import { normalizeName } from './curtainCalculation.js';

export function foldingRodOption(product) {
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  if (product?.calculation_type !== 'mt' || category !== 'katlama sistemi') return null;
  const index = (product.extra_options || []).findIndex((option) => normalizeName(option.option_name) === 'ilave ara cubuk' && option.pricing_basis === 'mt');
  return index < 0 ? null : { index, option: product.extra_options[index] };
}

export function setFoldingRodCount(product, form, value) {
  const entry = foldingRodOption(product);
  if (!entry) throw new Error('Bu üründe ilave ara çubuk seçeneği bulunmuyor.');
  const count = value === '' ? 0 : Number(value);
  const counts = { ...(form.accessory_counts || {}) };
  const indices = (form.extra_indices || []).filter((index) => index !== entry.index);
  if (count === 0) delete counts[entry.option.option_name];
  else {
    counts[entry.option.option_name] = count;
    indices.push(entry.index);
  }
  return { ...form, extra_indices: indices, accessory_counts: counts };
}
