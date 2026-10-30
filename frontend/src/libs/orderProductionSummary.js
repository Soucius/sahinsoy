export const PRODUCTION_TABS = { workshop: 'Atölyede', ready: 'Hazır', partial: 'Kısmen hazır' };
const readyStages = new Set(['ready', 'installation', 'installed']);
const workshopStages = new Set(['waiting', 'cutting', 'cut', 'sewing', 'sewn']);

// These are views of production, never a second editable order status.
export function orderProductionSummary(sale, record, loaded = true) {
  if (sale.status !== 'tamamlandi') return null;
  if (!loaded) return { key: 'unknown', label: 'Üretim durumu alınamadı', ready: 0, total: 0 };
  if (!record) return { key: 'untracked', label: 'Üretim takibine aktarılmadı', ready: 0, total: sale.sale_items?.length || 0 };
  const jobs = record.jobs || [];
  const total = jobs.length;
  if (record.needs_refresh || total !== sale.sale_items?.length || jobs.some(job => !sale.sale_items.some(item => String(item._id) === job.line_id))) {
    return { key: 'refresh', label: 'Ölçü / ürün bilgileri güncellenecek', ready: 0, total };
  }
  if (!total) return { key: 'untracked', label: 'Üretim takibi bekleniyor', ready: 0, total };
  const ready = jobs.filter(job => job.supply === 'received' && readyStages.has(job.stage)).length;
  if (ready === total && sale.measurement_status === 'confirmed') return { key: 'ready', label: 'Hazır', ready, total };
  if (ready > 0 && ready < total) return { key: 'partial', label: 'Kısmen hazır', ready, total };
  if (jobs.some(job => job.snapshot?.kind === 'textile' && job.supply === 'received' && workshopStages.has(job.stage))) return { key: 'workshop', label: 'Atölyede', ready, total };
  return { key: 'waiting', label: sale.measurement_status !== 'confirmed' && ready === total ? 'Kesin ölçü bekleniyor' : 'Tedarik / üretim bekleniyor', ready, total };
}
