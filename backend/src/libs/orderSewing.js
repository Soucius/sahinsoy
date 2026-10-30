import { ProductionError } from './productionWorkflow.js';
const key = value => value ? String(value).toLowerCase() : null;
const completed = job => ['sewn', 'ready', 'installation', 'installed'].includes(job.stage);
export const sewingOverride = (selected, orderDefault) => key(selected) !== key(orderDefault);

// Only assignment data changes: no production stage, material, payment or wage entry.
export function assignOrderSewing(jobs, selected) {
  if (!jobs.some(job => job.snapshot.kind === 'textile')) throw new ProductionError('Bu siparişte dikilecek ürün yok.', 409);
  return jobs.map(job => job.snapshot.kind !== 'textile' || job.sewing_override || completed(job)
    ? job : { ...job, sewing: key(selected), sewing_override: false });
}

export function refreshSewingJobs(record, lines, defaultActive) {
  return lines.map(line => {
    const old = record.jobs.find(job => job.line_id === line.line_id);
    if (!old) return { supply: 'awaiting_order', stage: 'waiting', cutting: null, sewing: null, installation: null, sewing_override: false, ...line, ...(line.snapshot.kind === 'textile' && defaultActive && record.sewing_default ? { sewing: key(record.sewing_default) } : {}) };
    const next = { ...old, snapshot: line.snapshot, stage: JSON.stringify(old.snapshot) === JSON.stringify(line.snapshot) ? old.stage : 'waiting' };
    if (line.snapshot.kind !== 'textile') return { ...next, cutting: null, sewing: null, sewing_override: false };
    if (!old.sewing_override && !completed(old) && defaultActive && record.sewing_default) return { ...next, sewing: key(record.sewing_default), sewing_override: false };
    return next;
  });
}
