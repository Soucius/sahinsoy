import { createHash } from 'node:crypto';
import { readyMessage } from './whatsappNotifications.js';
import { lineAttention } from './orderAttentionRules.js';
export const SUPPLY = { awaiting_order: 'Ürün siparişi verilecek', ordered: 'Ürün siparişi verildi', in_transit: 'Kargoda', received: 'Ürün mağazaya geldi' };
export const STAGES = { waiting: 'Üretim bekliyor', cutting: 'Kesimde', cut: 'Kesildi', sewing: 'Dikim sırasında', sewn: 'Dikildi', ready: 'Teslime / montaja hazır', installation: 'Montajda', installed: 'Montaj tamamlandı' };
export class ProductionError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const text = (value, max = 500) => String(value ?? '').slice(0, max);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const fields = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, typeof value[k] === 'number' ? number(value[k]) : text(value[k])]));
// Explicit allowlists: never send POS cart objects, prices, payments or stock to staff.
export function productionLines(sale) {
  const cart = sale.pos_details?.cart;
  return (sale.sale_items || []).map((item, index) => {
    const line = Array.isArray(cart) && String(cart[index]?.product_id) === String(item.product?._id || item.product) ? cart[index] : null;
    const category = text(line?.category_name || item.product?.product_category?.category_name);
    const mode = line?.mode || '';
    const kind = ['textile', 'fon'].includes(mode) || (['', 'standard'].includes(mode) && /tül|fon|kumaş/iu.test(category)) ? 'textile' : 'mechanical';
    return {
      line_id: String(item._id),
      snapshot: {
        kind, product_name: text(line?.product_name || item.product?.product_name || 'Ürün'),
        brand_name: text(line?.brand_name || item.product?.product_brand?.brand_name), category_name: category,
        room_name: text(line?.room_name || item.room_name), area: text(line?.area), facade: text(line?.facade || item.facade),
        window_name: text(line?.window_name || item.window_name), variant: text(line?.variant),
        width: number(line?.width ?? item.width), height: number(line?.height ?? item.height),
        quantity: number(line?.quantity ?? item.quantity), unit_label: text(line?.unit_label, 20),
        pieces: number(line?.pieces || line?.count || 1), pleat_name: text(line?.pleat_name),
        item_note: text(line?.item_note || item.item_note, 1000),
        panels: (Array.isArray(line?.panels) ? line.panels : []).slice(0, 200).map(p => fields(p, ['label', 'width', 'height', 'cut_width'])),
        mechanical_panels: (Array.isArray(line?.mechanical_panels) ? line.mechanical_panels : []).slice(0, 200).map(p => fields(p, ['label', 'width', 'height', 'count', 'case_color', 'chain_direction', 'position', 'facade', 'variant'])),
        accessories: (Array.isArray(line?.accessories) ? line.accessories : []).map(p => fields(p, ['name', 'color', 'count_per_piece', 'quantity', 'unit'])),
        case_color: text(line?.case_color || line?.dual_plise?.case_color), chain_direction: text(line?.chain_direction),
        case_mode: text(line?.case_mode), case_count: number(line?.case_count), profile_width_cm: number(line?.profile_width_cm),
        glass_label: text(line?.dual_plise?.glass_label), dual_group: text(line?.dual_plise?.group_id), dual_role: text(line?.dual_plise?.role),
        motor_group: text(line?.motor_system?.group_id), motor_role: text(line?.motor_system?.role),
      },
    };
  });
}
export function fingerprint(sale) {
  return createHash('sha256').update(JSON.stringify({ lines: productionLines(sale), measurement_revision: sale.measurement_revision || 0, measurement_status: sale.measurement_status, delivery_method: sale.delivery_method })).digest('hex');
}
export const assigned = (job, staff) => Object.keys({ cutting: 1, sewing: 1, installation: 1 }).some(duty => staff.duties.includes(duty) && String(job[duty] || '') === String(staff._id));
export function visibleOrder(record, sale, actor) {
  const admin = actor.kind === 'admin';
  const jobs = admin ? record.jobs : record.jobs.filter(job => assigned(job, actor));
  if (!jobs.length && !admin) return null;
  const allowedIds = new Set(jobs.map(j => j.line_id));
  const needsRefresh = record.source_fingerprint !== fingerprint(sale);
  return {
    _id: String(record._id), sale_id: String(sale._id), customer_name: sale.customer_name,
    delivery_date: sale.delivery_date, delivery_method: sale.delivery_method,
    sale_status: sale.status, measurement_status: sale.measurement_status,
    revision: record.revision, needs_refresh: needsRefresh,
    sewing_default: admin ? String(record.sewing_default || '') || null : undefined,
    closed: sale.status !== 'tamamlandi',
    jobs: jobs.map(job => ({ warnings: ['beklemede', 'tamamlandi'].includes(sale.status) ? [...(sale.measurement_status !== 'confirmed' ? [{ kind: 'measurement', code: 'measurement_pending', label: 'Kesin ölçü bekleniyor.' }] : []), ...lineAttention(sale, sale.sale_items.find(item => String(item._id) === job.line_id) || {}, sale.sale_items.findIndex(item => String(item._id) === job.line_id), job, !needsRefresh)] : [], line_id: job.line_id, snapshot: job.snapshot, supply: job.supply, stage: job.stage, cutting: job.cutting, sewing: job.sewing, sewing_override: admin ? Boolean(job.sewing_override) : undefined, installation: job.installation, note: job.note, tracking: admin ? job.tracking : undefined })),
    history: (record.history || []).filter(event => admin || allowedIds.has(event.line_id)).map(event => ({ at: event.at, actor_name: event.actor_name, line_id: event.line_id, action: event.action,
      // Assignment IDs, carrier references and previous snapshots belong to admin only.
      before: admin ? event.before : fields(event.before, ['stage', 'supply', 'note']),
      after: admin ? event.after : fields(event.after, ['stage', 'supply', 'note']) })),
  };
}
export function stageChoices(job, actor, sale) {
  if (sale.status !== 'tamamlandi' || job.supply !== 'received') return [];
  const admin = actor.kind === 'admin';
  const owns = duty => admin || (actor.duties.includes(duty) && String(job[duty] || '') === String(actor._id));
  const measured = sale.measurement_status === 'confirmed';
  const textile = job.snapshot.kind === 'textile';
  const next = [];
  if (textile && measured && job.stage === 'waiting' && owns('cutting')) next.push('cutting');
  if (textile && job.stage === 'cutting' && owns('cutting')) next.push('cut');
  if (textile && job.stage === 'cut' && owns('sewing')) next.push('sewing');
  if (textile && job.stage === 'sewing' && owns('sewing')) next.push('sewn');
  if (textile && job.stage === 'sewn' && owns('sewing')) next.push('ready');
  if (!textile && measured && job.stage === 'waiting' && (admin || owns('installation'))) next.push('ready');
  if (['installation', 'montaj'].includes(sale.delivery_method) && measured && job.stage === 'ready' && owns('installation')) next.push('installation');
  if (job.stage === 'installation' && owns('installation')) next.push('installed');
  return next;
}
export function applyJobChange(job, input, actor, sale) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProductionError('İşlem bilgisi geçersiz.');
  const admin = actor.kind === 'admin';
  const allowed = admin ? ['stage', 'supply', 'cutting', 'sewing', 'installation', 'note', 'tracking'] : ['stage', 'note'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new ProductionError('Bu alanı değiştirme yetkiniz yok.', 403);
  if (!admin && !assigned(job, actor)) throw new ProductionError('Bu iş size atanmamış.', 403);
  if (sale.status !== 'tamamlandi') throw new ProductionError('İptal veya teslim edilmiş sipariş değiştirilemez.', 409);
  const patch = {};
  for (const key of ['note', 'tracking']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].length > (key === 'note' ? 1000 : 200)) throw new ProductionError('Not veya kargo bilgisi çok uzun.');
    patch[key] = input[key].trim();
  }
  if (input.supply !== undefined) {
    if (!SUPPLY[input.supply]) throw new ProductionError('Tedarik durumu geçersiz.');
    if (job.stage !== 'waiting' && input.supply !== 'received') throw new ProductionError('Üretimi başlayan işin malzeme durumunu geri alamazsınız.', 409);
    patch.supply = input.supply;
  }
  for (const key of ['cutting', 'sewing', 'installation']) if (input[key] !== undefined) {
    if (input[key] !== null && !/^[a-f\d]{24}$/i.test(input[key])) throw new ProductionError('Personel seçimi geçersiz.');
    if (job.snapshot.kind !== 'textile' && ['cutting', 'sewing'].includes(key) && input[key] !== null) throw new ProductionError('Mekanik ürünler kesim ve dikime atanamaz.');
    patch[key] = input[key];
  }
  if (input.stage !== undefined && input.stage !== job.stage) {
    if (!stageChoices(job, actor, sale).includes(input.stage)) throw new ProductionError('Bu aşama için görev, malzeme veya kesin ölçü koşulu sağlanmıyor.', 409);
    patch.stage = input.stage;
  }
  if (!Object.keys(patch).length) throw new ProductionError('Kaydedilecek değişiklik yok.');
  return patch;
}
export function notificationDraft(sale, record) {
  const allReady = record.jobs.length > 0 && record.jobs.every(j => ['ready', 'installation', 'installed'].includes(j.stage));
  const allInstalled = record.jobs.length > 0 && record.jobs.every(j => j.stage === 'installed');
  if (allReady && !allInstalled) return readyMessage(sale);
  return `Sayın ${text(sale.customer_name || 'Müşterimiz', 120)}, Şahinsoy Perde siparişinizin ${allInstalled ? 'montajı tamamlandı' : 'hazırlık süreci devam ediyor'}. Sipariş no: ${String(sale._id).slice(-8).toUpperCase()}`;
}
