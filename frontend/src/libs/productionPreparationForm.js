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
