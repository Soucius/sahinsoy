import { isObaFoldingProduct, normalizeName } from './curtainCalculation.js';

export function foldingRodOption(product) {
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  if (product?.calculation_type !== 'mt' || (category !== 'katlama sistemi' && !isObaFoldingProduct(product))) return null;
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

export function prepareObaFoldingProduct(product, catalog) {
  if (!isObaFoldingProduct(product)) return product;
  const currency = product.currency || 'TRY';
  const rods = catalog.filter((item) => normalizeName(item.product_brand?.brand_name || item.brand_name) === 'oba perdesan'
    && normalizeName(item.product_name) === 'katlama ara cubuk' && item.calculation_type === 'mt'
    && (item.currency || 'TRY') === currency);
  if (!rods.length || rods.some((item) => !Number.isFinite(item.sale_price) || item.sale_price < 0 || item.sale_price !== rods[0].sale_price)) throw new Error('OBA katlama ara çubuk fiyatı doğrulanamadı.');
  const extras = (product.extra_options || []).filter((option) => normalizeName(option.option_name) !== 'ilave ara cubuk');
  return { ...product, extra_options: [...extras, { option_name: 'İlave ara çubuk', price_impact: rods[0].sale_price, pricing_basis: 'mt', pricing_scope: 'parca', currency }] };
}
