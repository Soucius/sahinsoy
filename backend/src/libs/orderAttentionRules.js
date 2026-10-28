const pid = value => String(value?._id || value || '');
const text = value => typeof value === 'string' ? value.trim() : '';
const normalized = value => text(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const specified = value => !!text(value) && !['belirtilmedi', 'belirsiz', 'bilinmiyor', 'seciniz', 'secilmedi', '-', '—'].includes(normalized(value));
export const attentionDay = value => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date(value)) : '';
export function lineAttention(sale, item, index, job, fresh = true) {
  const warnings = [], cart = sale.pos_details?.cart?.[index];
  const line = cart && pid(cart.product_id) === pid(item.product) ? cart : null;
  const product = item.product && typeof item.product === 'object' ? item.product : {};
  const name = text(line?.product_name) || product.product_name || 'Ürün', room = text(item.room_name), prefix = [name, room, Number(item.width) > 0 ? `${item.width}${Number(item.height) > 0 ? ` × ${item.height}` : ''} cm` : ''].filter(Boolean).join(' · ');
  const add = (kind, code, label) => warnings.push({ kind, code, line_id: pid(item), label: `${prefix}: ${label}` });
  const category = normalized(line?.category_name || product.product_category?.category_name);
  const motor = line?.motor_system?.role === 'motor' || /motor|kumanda/.test(category);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const required = !motor && (['textile', 'fon'].includes(line?.mode) || /tul|fon|kumas|stor|zebra|jaluzi|plise|dikey/.test(category) || variants.length > 0);
  const fixedColor = specified(product.product_color);
  const hasCodes = variants.some(variant => specified(variant.vr));
  if (required) {
    const panels = Array.isArray(line?.mechanical_panels) ? line.mechanical_panels : [];
    const missingPanels = panels.map((panel, i) => !specified(panel.variant || line.variant) && (!fixedColor || hasCodes) ? text(panel.position || panel.label) || `${i + 1}. parça` : '').filter(Boolean);
    if (missingPanels.length) add('color', 'panel_variant', `renk / VR eksik (${missingPanels.join(', ')}).`);
    else if (!panels.length && !specified(line?.variant) && (!fixedColor || hasCodes)) add('color', 'variant', 'renk / VR bilgisi eksik.');
    if (!line) add('color', 'legacy_variant', 'renk / VR bilgisi eski kayıttan doğrulanamadı; kontrol edin.');
  }
  if (sale.status === 'tamamlandi') {
    if (!job || !fresh) add('material', 'supply_unknown', 'malzeme durumu takipte doğrulanmadı.');
    else if (job.supply !== 'received') add('material', job.supply || 'supply_unknown', ({ awaiting_order: 'ürün siparişi verilecek.', ordered: 'ürün siparişi verildi, malzeme bekleniyor.', in_transit: 'malzeme kargoda.' })[job.supply] || 'malzeme durumu bilinmiyor.');
  }
  return warnings;
}
export function orderAttention(sale, record, fresh, today = attentionDay(new Date())) {
  if (!['beklemede', 'tamamlandi'].includes(sale.status)) return [];
  const warnings = [], day = attentionDay(sale.measurement_date);
  if (sale.measurement_status !== 'confirmed') {
    warnings.push({ kind: 'measurement', code: !day ? 'measurement_undated' : day < today ? 'measurement_overdue' : 'measurement_pending', label: !day ? 'Kesin ölçü bekleniyor; ölçü günü belirlenmedi.' : day < today ? `Ölçü günü geçti (${day.split('-').reverse().join('.')}); kesin ölçü bekleniyor.` : `Ölçü alınacak: ${day.split('-').reverse().join('.')}.` });
  }
  for (const [index, item] of (sale.sale_items || []).entries()) warnings.push(...lineAttention(sale, item, index, record?.jobs.find(job => job.line_id === pid(item)), fresh));
  return warnings;
}
export function variantEdit(sale, input) {
  const allowed = ['request_id', 'expected_fingerprint', 'line_id', 'variant', 'panel_variants'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.request_id || '') || !/^[a-f\d]{64}$/.test(input.expected_fingerprint || '')) throw new Error('Renk / VR formunu yenileyin.');
  if (!['beklemede', 'tamamlandi'].includes(sale.status)) throw new Error('Yalnız açık teklif / siparişin renk bilgisi tamamlanabilir.');
  const index = sale.sale_items.findIndex(item => pid(item) === input.line_id), item = sale.sale_items[index], line = sale.pos_details?.cart?.[index];
  if (!item || !line || pid(line.product_id) !== pid(item.product)) throw new Error('Ürün ayrıntısı doğrulanamadı. Eski kaydı mağazada kontrol edin.');
  const clean = value => { if (typeof value !== 'string' || value.length > 150 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Renk / VR en fazla 150 karakter olmalı.'); return value.trim(); };
  const variant = clean(input.variant), panels = Array.isArray(line.mechanical_panels) ? line.mechanical_panels : [];
  if (!Array.isArray(input.panel_variants) || input.panel_variants.length !== panels.length || input.panel_variants.length > 200) throw new Error('Parça renklerini kontrol edin.');
  const values = input.panel_variants.map(clean);
  if (panels.length ? values.some(value => !specified(value || variant)) : !specified(variant)) throw new Error('Her parçanın renk / VR bilgisini girin; ortak seçim de kullanabilirsin.');
  const next = { ...line, variant, ...(panels.length ? { mechanical_panels: panels.map((panel, i) => ({ ...panel, variant: values[i] || variant })) } : {}) };
  return { index, next, before: { variant: line.variant || '', panel_variants: panels.map(panel => panel.variant || '') }, after: { variant, panel_variants: values.map(value => value || variant) } };
}
