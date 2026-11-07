import { createHash } from 'node:crypto';
import { ProductionError, productionLines, fingerprint, SUPPLY } from './productionWorkflow.js';
import { refreshSewingJobs } from './orderSewing.js';

const personId = value => value ? String(value).toLowerCase() : null;
const finished = job => ['sewn', 'ready', 'installation', 'installed'].includes(job.stage);
const defaults = line => ({ ...line, supply: 'awaiting_order', stage: 'waiting', cutting: null, sewing: null, installation: null, sewing_override: false, note: '', tracking: '' });

export function preparationPreview(sale, record) {
  const lines = productionLines(sale);
  const jobs = record ? refreshSewingJobs(record, lines, false) : lines.map(defaults);
  const changedStarted = (record?.jobs || []).filter(old => {
    const line = lines.find(item => item.line_id === old.line_id);
    return old.stage !== 'waiting' && (!line || JSON.stringify(line.snapshot) !== JSON.stringify(old.snapshot));
  }).map(job => ({ line_id: job.line_id, product_name: job.snapshot.product_name }));
  return { source_fingerprint: fingerprint(sale), jobs, changed_started: changedStarted };
}

export function preparationDigest(input) {
  return createHash('sha256').update(JSON.stringify({
    source: input.expected_fingerprint, revision: input.expected_revision,
    cutting: input.cutting, sewing: input.sewing, installation: input.installation,
    materials: Array.isArray(input.materials) ? [...input.materials].sort((a, b) => String(a?.line_id).localeCompare(String(b?.line_id))) : input.materials,
    confirm_changed_work: input.confirm_changed_work,
  })).digest('hex');
}

export function preparationReceipt(record, requestId) {
  return (record?.history || []).find(entry => entry.after?.preparation_request?.id === requestId)?.after.preparation_request;
}

// One plan is persisted in one transaction. This never starts cutting, records a wage,
// changes a sale's price/payment, or marks an order ready.
export function buildProductionPreparation(sale, record, input, staff) {
  const allowed = ['request_id', 'expected_fingerprint', 'expected_revision', 'cutting', 'sewing', 'installation', 'materials', 'confirm_changed_work'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new ProductionError('Hazırlık alanlarını kontrol edin.');
  if (typeof input.request_id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.request_id)) throw new ProductionError('İşlem numarası geçersiz.');
  const digest = preparationDigest(input), receipt = preparationReceipt(record, input.request_id);
  if (receipt) {
    if (receipt.digest !== digest) throw new ProductionError('Aynı işlem numarası farklı bilgilerle kullanılamaz.', 409);
    return { existing: true };
  }
  if (sale.status !== 'tamamlandi') throw new ProductionError('Önce siparişi onaylayın. Teslim edilmiş veya iptal edilmiş işler üretime gönderilemez.', 409);
  if (sale.measurement_status !== 'confirmed') throw new ProductionError('Önce bu ekrandaki son ölçüleri kaydedin.', 409);
  const preview = preparationPreview(sale, record);
  if (input.expected_fingerprint !== preview.source_fingerprint || input.expected_revision !== (record?.revision ?? null)) throw new ProductionError('Sipariş veya üretim bilgileri değişti. Son bilgileri yükleyip yeniden kontrol edin.', 409);
  if (typeof input.confirm_changed_work !== 'boolean') throw new ProductionError('Ölçü değişikliği kontrolü geçersiz.');
  if (preview.changed_started.length && !input.confirm_changed_work) throw new ProductionError('Başlamış ürünlerin değişen ölçülerini kontrol edip onaylayın.', 409);
  if (!preview.jobs.length) throw new ProductionError('Siparişte üretime aktarılacak ürün yok.');
  if (!Array.isArray(input.materials) || input.materials.length !== preview.jobs.length) throw new ProductionError('Her ürünün malzeme durumunu seçin.');
  const materials = new Map();
  for (const value of input.materials) {
    if (!value || Object.keys(value).some(key => !['line_id', 'supply'].includes(key)) || typeof value.line_id !== 'string' || materials.has(value.line_id) || !Object.hasOwn(SUPPLY, value.supply)) throw new ProductionError('Malzeme durumlarını kontrol edin.');
    materials.set(value.line_id, value.supply);
  }
  const selected = {};
  for (const duty of ['cutting', 'sewing', 'installation']) {
    const id = input[duty];
    if (id !== null && (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) throw new ProductionError('Sorumlu personeli kontrol edin.');
    const person = id && staff.find(item => personId(item._id) === personId(id));
    if (id && (!person?.active || !person.duties.includes(duty))) throw new ProductionError('Seçilen personelin giriş izni veya görev yetkisi yok.', 409);
    selected[duty] = personId(id);
  }
  const installation = ['montaj', 'installation'].includes(sale.delivery_method);
  const jobs = preview.jobs.map(job => {
    if (!materials.has(job.line_id)) throw new ProductionError('Ürün listesi değişmiş. Son bilgileri yükleyin.', 409);
    const old = record?.jobs.find(item => item.line_id === job.line_id);
    const supply = materials.get(job.line_id);
    if (old && old.stage !== 'waiting' && supply !== 'received') throw new ProductionError('Üretimi başlamış ürünün malzemesi beklemeye alınamaz.', 409);
    // Preserve product-specific assignments and completed work. Order-level choices fill gaps.
    const next = { ...job, supply };
    if (job.snapshot.kind === 'textile' && !finished(job)) {
      if (job.sewing_override && !job.sewing) throw new ProductionError('Ürüne özel dikim seçimi boş bırakılmış. Üretim ayrıntılarında bu ürünün terzisini seçin.');
      next.cutting = personId(job.cutting) || selected.cutting;
      next.sewing = personId(job.sewing) || selected.sewing;
      if (job.stage === 'waiting' && !next.cutting) throw new ProductionError('Kesim sorumlusunu seçin.');
      if (!next.sewing) throw new ProductionError('Dikim sorumlusunu seçin.');
    } else if (job.snapshot.kind !== 'textile') {
      next.cutting = null; next.sewing = null; next.sewing_override = false;
    }
    if (installation && !['installation', 'installed'].includes(job.stage)) {
      next.installation = personId(job.installation) || selected.installation;
      if (!next.installation) throw new ProductionError('Montaj sorumlusunu seçin.');
    }
    return next;
  });
  return { source_fingerprint: preview.source_fingerprint, jobs,
    sewing_default: personId(record?.sewing_default) || selected.sewing,
    receipt: { id: input.request_id, digest },
  };
}
