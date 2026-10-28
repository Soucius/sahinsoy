import { createHash } from 'node:crypto';

export class ProfitError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const profitHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const profitId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const pid = value => String(value?._id || value || '');
export function profitObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ProfitError('Maliyet alanlarını kontrol edin.');
}
export function scaledAmount(value, places = 2, nullable = true) {
  if (nullable && (value === '' || value === null)) return null;
  if (typeof value !== 'string' || !new RegExp(`^(?:0|[1-9]\\d{0,7})(?:[.,]\\d{1,${places}})?$`).test(value)) throw new ProfitError(`Tutarı binlik ayırıcı olmadan, en fazla ${places} ondalıkla girin.`);
  const [whole, part = ''] = value.replace(',', '.').split('.');
  return (BigInt(whole) * 10n ** BigInt(places) + BigInt(part.padEnd(places, '0'))).toString();
}
export function profitDecimal(units, places = 2) {
  if (units == null) return '';
  const n = BigInt(units), factor = 10n ** BigInt(places);
  return `${n / factor}.${String(n % factor).padStart(places, '0')}`;
}
function storedUnits(value, places) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999) return null;
  const units = Math.round(value * 10 ** places);
  if (!Number.isSafeInteger(units) || Math.abs(units / 10 ** places - value) > 0.000001) return null;
  return String(units);
}
export function profitSource(sale) {
  return profitHash({ items: sale.sale_items, cart: sale.pos_details?.cart || null, grand: sale.grand_total, subtotal: sale.sub_total, discount: sale.discount_amount, fee: sale.credit_card_fee, delivery: sale.delivery_method, revision: sale.measurement_revision || 0 });
}
export function profitLines(sale, products = []) {
  if (!Array.isArray(sale.sale_items) || !sale.sale_items.length || sale.sale_items.length > 500) throw new ProfitError('Sipariş ürün kapsamı kontrol edilmeli.', 409);
  return sale.sale_items.map((item, index) => {
    const cart = sale.pos_details?.cart?.[index], matched = cart && pid(cart.product_id) === pid(item.product) && cart.quantity === item.quantity;
    const product = products.find(row => pid(row) === pid(item.product));
    const textile = matched && ['textile', 'fon'].includes(cart.mode);
    const quantity_units = storedUnits(item.quantity, 4);
    const currency = product?.currency || 'TRY';
    let suggestion = null, suggestion_note = 'Alış fiyatı eksik; maliyeti girin.';
    if (product?.purchase_price > 0 && quantity_units) {
      if (currency === 'TRY') {
        suggestion = storedUnits(product.purchase_price, 4);
        suggestion_note = 'Güncel katalog alış fiyatı · KDV dahil varsayımıyla kontrol edin.';
      } else if (matched && cart.original_currency === currency && typeof cart.currency_rate === 'number' && cart.currency_rate > 0 && cart.currency_rate < 1000000) {
        suggestion = storedUnits(Math.round(product.purchase_price * cart.currency_rate * 10000) / 10000, 4);
        suggestion_note = `Katalog alış fiyatı × siparişte kayıtlı ${currency}/TL kuru; gerçek alış kurunu kontrol edin.`;
      } else suggestion_note = `${currency} alış fiyatı var; TL alış maliyeti için kur doğrulanmalı.`;
    }
    if (matched && cart.rustic_pricing) { suggestion = null; suggestion_note = 'Rustik ölçü kademesinin gerçek alış fiyatını girin; başka ölçünün katalog fiyatı kullanılmaz.'; }
    return { id: pid(item), product_id: pid(item.product), name: matched && cart.product_name || product?.product_name || 'Ürün', brand: matched && cart.brand_name || product?.product_brand?.brand_name || 'Firma belirtilmedi', room: item.room_name || '', kind: textile ? 'fabric' : 'mechanism', textile, unknown_mode: !matched, quantity: item.quantity, quantity_units, unit: matched ? cart.unit_label || '' : '', suggestion_units: suggestion, suggestion_note, extras: matched && Array.isArray(cart.accessories) ? cart.accessories.map(row => String(row.name || 'Ek seçenek')) : [], extras_unknown: !matched || !Array.isArray(cart.accessories), width: item.width, height: item.height };
  });
}
export function automaticSewing(sale, lines, entries = [], truncated = false) {
  const fabrics = lines.filter(line => line.textile);
  const relevant = entries.filter(row => String(row.sewing?.sale_id) === pid(sale) && (row.type === 'sewing' || row.type === 'reversal' && row.reversed_type === 'sewing'));
  const token = profitHash(relevant.map(row => [pid(row), row.person_delta_minor, row.sewing]));
  const breakdown = fabrics.map(line => {
    const rows = relevant.filter(row => row.sewing.line_id === line.id);
    let amount = 0n, meters = 0n, invalid = !line.quantity_units;
    for (const row of rows) {
      if (!/^-?\d+$/.test(String(row.person_delta_minor)) || !Number.isSafeInteger(row.sewing.meter_units)) { invalid = true; continue; }
      const delta = BigInt(row.person_delta_minor), sign = row.type === 'reversal' ? -1n : 1n;
      amount += delta; meters += sign * BigInt(row.sewing.meter_units);
    }
    const complete = !invalid && rows.length > 0 && meters === BigInt(line.quantity_units || 0) && amount >= 0n;
    return { line_id: line.id, name: line.name, amount_minor: complete ? String(amount) : null, meters: Number(meters) / 10000 };
  });
  const orphan = relevant.some(row => !fabrics.some(line => line.id === row.sewing.line_id));
  const complete = !truncated && !orphan && !lines.some(line => line.unknown_mode) && breakdown.every(row => row.amount_minor !== null);
  return { token, complete, amount_minor: complete ? String(breakdown.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n)) : null, breakdown, note: complete ? fabrics.length ? 'Kasa / Personel ekranındaki gerçekleşen dikim hakedişi. Avans ve ödemeler tekrar düşülmez.' : 'Bu siparişte dikim gerektiren kumaş kalemi yok.' : 'Dikim hakedişi veya metrajı tamamlanmadı. Ücret listesini / atamayı kontrol edin ya da bu siparişin işçiliğini elle girin.' };
}
export function normalizeProfit(input, lines) {
  profitObject(input, ['operation_id', 'expected_revision', 'view_token', 'lines', 'labor_mode', 'labor_amount', 'installation_amount', 'other_amount', 'estimate', 'note']);
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.operation_id || '') || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 || !/^[a-f\d]{64}$/.test(input.view_token || '')) throw new ProfitError('Maliyet ekranını yenileyin.');
  if (!Array.isArray(input.lines) || input.lines.length !== lines.length || !['auto', 'manual'].includes(input.labor_mode) || typeof input.estimate !== 'boolean' || typeof input.note !== 'string' || input.note.length > 1000) throw new ProfitError('Maliyet formunu kontrol edin.');
  const seen = new Set();
  const normalized = input.lines.map(row => {
    profitObject(row, ['id', 'unit_cost', 'extra_cost']);
    if (!lines.some(line => line.id === row.id) || seen.has(row.id)) throw new ProfitError('Ürün satırları değişti. Yenileyin.', 409);
    seen.add(row.id);
    return { id: row.id, unit_units: scaledAmount(row.unit_cost, 4), extra_minor: scaledAmount(row.extra_cost) };
  });
  if (input.labor_mode === 'auto' && input.labor_amount !== '') throw new ProfitError('Otomatik ve manuel dikim tutarı birlikte kullanılamaz.');
  return { lines: normalized, labor_mode: input.labor_mode, labor_minor: input.labor_mode === 'manual' ? scaledAmount(input.labor_amount) : null, installation_minor: scaledAmount(input.installation_amount), other_minor: scaledAmount(input.other_amount), estimate: input.estimate, note: input.note.trim() };
}
export function calculateProfit(sale, lines, sheet, sewing) {
  const missing = [], stale = !!sheet && sheet.source !== profitSource(sale);
  let fabric = 0n, mechanism = 0n, extras = 0n;
  const brands = new Map();
  for (const line of lines) {
    if (!brands.has(line.brand)) brands.set(line.brand, { name: line.brand, known_minor: 0n, missing: 0 });
    const brand = brands.get(line.brand);
    const saved = sheet?.costs?.lines?.find(row => row.id === line.id);
    if (!saved || saved.unit_units === null || !line.quantity_units) { missing.push(`${line.name}: alış maliyeti`); brand.missing++; }
    else {
      const base = (BigInt(saved.unit_units) * BigInt(line.quantity_units) + 500000n) / 1000000n;
      if (line.kind === 'fabric') fabric += base; else mechanism += base;
      brand.known_minor += base;
    }
    if (!saved || saved.extra_minor === null) { missing.push(`${line.name}: ek seçenek alış maliyeti`); brand.missing++; } else { extras += BigInt(saved.extra_minor); brand.known_minor += BigInt(saved.extra_minor); }
  }
  const costs = sheet?.costs, labor = costs?.labor_mode === 'manual' ? costs.labor_minor : sewing.amount_minor;
  if (labor == null) missing.push('Dikim / işçilik');
  if (costs?.installation_minor == null) missing.push('Montaj');
  if (costs?.other_minor == null) missing.push('Diğer giderler');
  const revenue = storedUnits(sale.grand_total, 2);
  if (revenue === null) missing.push('Sipariş satış tutarı');
  const total = fabric + mechanism + extras + BigInt(labor || '0') + BigInt(costs?.installation_minor || '0') + BigInt(costs?.other_minor || '0');
  const complete = !!sheet && !stale && missing.length === 0;
  const profit = complete ? BigInt(revenue) - total : null;
  return { complete, stale, estimate: costs?.estimate !== false, missing, revenue_minor: revenue, brands: [...brands.values()].map(row => ({ ...row, known_minor: String(row.known_minor) })), known_cost_minor: String(total), fabric_minor: String(fabric), mechanism_minor: String(mechanism), extras_minor: String(extras), labor_minor: labor, installation_minor: costs?.installation_minor ?? null, other_minor: costs?.other_minor ?? null, cost_minor: complete ? String(total) : null, profit_minor: profit === null ? null : String(profit), margin_percent: profit !== null && BigInt(revenue) > 0n ? Number(profit * 10000n / BigInt(revenue)) / 100 : null };
}
