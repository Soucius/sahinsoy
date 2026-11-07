import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProductionForm } from './productionPreparationForm.js';
const staff = [
  { _id: 'nevzat', name: 'Nevzat', active: true, duties: ['cutting', 'installation'] },
  { _id: 'hayati', name: 'Hayati', active: true, duties: ['sewing'] },
  { _id: 'nurten', name: 'Nurten', active: true, duties: ['sewing'] },
  { _id: 'inactive', name: 'Eski kayıt', active: false, duties: ['sewing'] },
];
const data = () => ({ staff: structuredClone(staff), order: null, jobs: Array.from({ length: 7 }, (_, i) => ({ line_id: String(i), cutting: null, sewing: null, installation: null, supply: 'awaiting_order' })) });

test('first opening a seven-line unassigned order accepts the actual null React state', () => {
  const source = data(), result = initialProductionForm(source, null);
  assert.equal(result.cutting, ''); assert.equal(result.sewing, ''); assert.equal(result.installation, '');
  assert.equal(Object.keys(result.materials).length, 7); assert.ok(Object.values(result.materials).every(value => value === 'awaiting_order'));
  assert.equal(result.confirm_changed_work, false);
});
test('undefined and empty drafts behave like the initial null draft', () => {
  assert.deepEqual(initialProductionForm(data()), initialProductionForm(data(), null));
  assert.deepEqual(initialProductionForm(data(), {}), initialProductionForm(data(), null));
});
test('valid draft staff and material choices survive the measurement reload before first transfer', () => {
  const draft = { cutting: 'nevzat', sewing: 'hayati', installation: 'nevzat', materials: { '0': 'received', '1': 'in_transit', removed: 'ordered' }, confirm_changed_work: true };
  const source = data(), before = structuredClone({ source, draft }), result = initialProductionForm(source, draft);
  assert.equal(result.cutting, 'nevzat'); assert.equal(result.sewing, 'hayati'); assert.equal(result.installation, 'nevzat');
  assert.equal(result.materials['0'], 'received'); assert.equal(result.materials['1'], 'in_transit'); assert.equal(result.materials['2'], 'awaiting_order');
  assert.equal(Object.hasOwn(result.materials, 'removed'), false); assert.equal(result.confirm_changed_work, false);
  assert.deepEqual({ source, draft }, before);
});
test('saved production assignments and supplies take precedence over an unsaved draft', () => {
  const source = data(); source.order = { sewing_default: 'nurten' };
  source.jobs.forEach(job => { job.cutting = 'nevzat'; job.sewing = 'nurten'; job.supply = 'ordered'; });
  const result = initialProductionForm(source, { cutting: 'other', sewing: 'hayati', materials: { '0': 'received' } });
  assert.equal(result.cutting, 'nevzat'); assert.equal(result.sewing, 'nurten'); assert.equal(result.materials['0'], 'ordered');
});
test('inactive, missing and wrong-duty draft staff are not silently selected', () => {
  const result = initialProductionForm(data(), { cutting: 'hayati', sewing: 'inactive', installation: 'missing' });
  assert.equal(result.cutting, ''); assert.equal(result.sewing, ''); assert.equal(result.installation, '');
});
test('a mixture of assigned and unassigned jobs and an empty order both initialize without crashing', () => {
  const source = data(); source.jobs[0].cutting = 'nevzat'; source.jobs[0].sewing = 'hayati';
  assert.equal(initialProductionForm(source, null).cutting, 'nevzat'); assert.equal(initialProductionForm(source, null).sewing, 'hayati');
  source.jobs = [];
  assert.deepEqual(initialProductionForm(source, null), { cutting: '', sewing: '', installation: '', materials: {}, confirm_changed_work: false });
});
