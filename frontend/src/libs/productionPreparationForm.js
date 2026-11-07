const key = value => value ? String(value) : null;
const common = (jobs, duty) => {
  const values = [...new Set(jobs.map(job => key(job[duty])).filter(Boolean))];
  return values.length === 1 ? values[0] : '';
};
export function initialProductionForm(data, previous) {
  // The first React state updater receives null, not undefined.
  previous ??= {};
  const validPerson = (id, duty) => data.staff.some(person => person._id === id && person.active && person.duties.includes(duty)) ? id : '';
  return { cutting: validPerson(common(data.jobs, 'cutting') || previous.cutting, 'cutting'),
    sewing: validPerson(data.order?.sewing_default || common(data.jobs, 'sewing') || previous.sewing, 'sewing'),
    installation: validPerson(common(data.jobs, 'installation') || previous.installation, 'installation'),
    materials: Object.fromEntries(data.jobs.map(job => [job.line_id, data.order ? job.supply : previous.materials?.[job.line_id] || job.supply])),
    confirm_changed_work: false };
}

export function groupProductionMaterials(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const s = job.snapshot;
    // Dimensions and rooms identify individual pieces, not separate purchases.
    const id = JSON.stringify([s.kind, s.brand_name, s.category_name, s.product_name, s.variant, s.case_color].map(value => value || ''));
    if (!groups.has(id)) groups.set(id, { id, snapshot: s, jobs: [] });
    groups.get(id).jobs.push(job);
  }
  return [...groups.values()];
}

export function changeMaterialGroup(materials, jobs, supply) {
  if (!['awaiting_order', 'ordered', 'in_transit', 'received'].includes(supply)) return materials;
  const next = { ...materials };
  for (const job of jobs) {
    // Started/completed production keeps its received material state.
    if (job.stage === 'waiting') next[job.line_id] = supply;
  }
  return next;
}

export function materialGroupStatus(materials, jobs) {
  const values = new Set(jobs.map(job => materials[job.line_id] ?? job.supply));
  return values.size === 1 ? [...values][0] : '';
}
