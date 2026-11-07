import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProductionForm, groupProductionMaterials, changeMaterialGroup, materialGroupStatus } from './productionPreparationForm.js';
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

const materialJob = (id, snapshot = {}, stage = 'waiting') => ({ line_id: id, stage, supply: stage === 'waiting' ? 'awaiting_order' : 'received', snapshot: { kind: 'mechanical', brand_name: 'OBA', category_name: 'Plise', product_name: 'LANTANA', variant: '150', case_color: 'Beyaz', ...snapshot } });
test('six plise measurements across different rooms form one purchase group beside a textile product', () => {
  const jobs = [materialJob('textile', { kind: 'textile', product_name: 'SULTAN' }), ...Array.from({ length: 6 }, (_, i) => materialJob(String(i), { width: 50 + i, height: 100 + i, room_name: i ? 'Salon' : 'Mutfak' }))];
  const before = structuredClone(jobs), groups = groupProductionMaterials(jobs);
  assert.deepEqual(groups.map(group => group.jobs.length), [1, 6]);
  assert.deepEqual(groups[1].jobs.map(job => job.line_id), ['0', '1', '2', '3', '4', '5']);
  assert.deepEqual(jobs, before);
});
test('different products, brands, fabric variants and case colors stay separate', () => {
  const jobs = [materialJob('base'), materialJob('color', { variant: '151' }), materialJob('case', { case_color: 'Siyah' }), materialJob('brand', { brand_name: 'Diğer' }), materialJob('product', { product_name: 'VEGA' })];
  assert.equal(groupProductionMaterials(jobs).length, 5);
  assert.deepEqual(groupProductionMaterials([]), []);
});
test('a group change updates all six waiting rows, preserves a different product and does not mutate the draft', () => {
  const jobs = Array.from({ length: 6 }, (_, i) => materialJob(String(i)));
  const materials = { other: 'received', ...Object.fromEntries(jobs.map(job => [job.line_id, job.supply])) };
  const before = structuredClone(materials), next = changeMaterialGroup(materials, jobs, 'ordered');
  assert.equal(next.other, 'received'); assert.ok(jobs.every(job => next[job.line_id] === 'ordered')); assert.deepEqual(materials, before);
});
test('bulk changes never downgrade started or completed jobs and ignore the empty selector', () => {
  const jobs = [materialJob('waiting'), materialJob('cutting', {}, 'cutting'), materialJob('ready', {}, 'ready')];
  const materials = Object.fromEntries(jobs.map(job => [job.line_id, job.supply]));
  assert.deepEqual(changeMaterialGroup(materials, jobs, 'ordered'), { waiting: 'ordered', cutting: 'received', ready: 'received' });
  assert.equal(changeMaterialGroup(materials, jobs, ''), materials);
});
test('mixed group status becomes uniform after bulk selection and individual exceptions remain visible', () => {
  const jobs = [materialJob('a'), materialJob('b')], materials = { a: 'ordered', b: 'awaiting_order' };
  assert.equal(materialGroupStatus(materials, jobs), '');
  const next = changeMaterialGroup(materials, jobs, 'in_transit');
  assert.equal(materialGroupStatus(next, jobs), 'in_transit');
  const exception = changeMaterialGroup(next, [jobs[0]], 'received');
  assert.equal(materialGroupStatus(exception, jobs), ''); assert.equal(exception.b, 'in_transit');
});
