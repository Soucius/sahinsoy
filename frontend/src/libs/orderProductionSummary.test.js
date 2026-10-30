import test from 'node:test';
import assert from 'node:assert/strict';
import { orderProductionSummary as summary } from './orderProductionSummary.js';
const sale = { status: 'tamamlandi', measurement_status: 'confirmed', sale_items: [{ _id: 'a' }, { _id: 'b' }] };
const job = (line_id, stage, kind = 'textile', supply = 'received') => ({ line_id, stage, supply, snapshot: { kind } });
test('one ready line never makes the whole order ready', () => {
  assert.deepEqual(summary(sale, { jobs: [job('a', 'ready'), job('b', 'sewing')] }), { key: 'partial', label: 'Kısmen hazır', ready: 1, total: 2 });
});
test('all textile and mechanical lines count toward readiness', () => {
  assert.equal(summary(sale, { jobs: [job('a', 'ready'), job('b', 'waiting', 'mechanical', 'ordered')] }).key, 'partial');
  assert.equal(summary(sale, { jobs: [job('a', 'ready'), job('b', 'ready', 'mechanical')] }).key, 'ready');
});
test('cutting, sewing and sewn jobs remain in workshop until marked ready', () => {
  for (const stage of ['waiting', 'cutting', 'cut', 'sewing', 'sewn']) assert.equal(summary(sale, { jobs: [job('a', stage), job('b', 'waiting', 'mechanical', 'ordered')] }).key, 'workshop');
});
test('supplier orders and mechanical products are never claimed as workshop work', () => {
  assert.equal(summary(sale, { jobs: [job('a', 'waiting', 'textile', 'in_transit'), job('b', 'waiting', 'mechanical')] }).key, 'waiting');
});
test('changed measurements, missing and replaced lines cannot show ready', () => {
  for (const record of [{ needs_refresh: true, jobs: [job('a', 'ready'), job('b', 'ready')] }, { jobs: [job('a', 'ready')] }, { jobs: [job('a', 'ready'), job('c', 'ready')] }]) assert.equal(summary(sale, record).key, 'refresh');
});
test('unconfirmed measurements cannot show an entirely ready order', () => {
  assert.equal(summary({ ...sale, measurement_status: 'preliminary' }, { jobs: [job('a', 'ready'), job('b', 'ready')] }).key, 'waiting');
});
test('cancelled, delivered and pending sales are excluded from production tabs', () => {
  for (const status of ['iptal', 'teslim_edildi', 'beklemede', 'kaybedildi']) assert.equal(summary({ ...sale, status }, { jobs: [job('a', 'ready'), job('b', 'ready')] }), null);
});
test('failed loading and untracked orders are explicit, not false zero readiness', () => {
  assert.equal(summary(sale, undefined, false).key, 'unknown');
  assert.equal(summary(sale).key, 'untracked');
});
test('summary is read only and does not change stages, payments or defaults', () => {
  const record = { jobs: [job('a', 'ready'), job('b', 'sewing')], sewing_default: 'hayati' };
  const original = JSON.stringify({ sale, record });
  summary(sale, record);
  assert.equal(JSON.stringify({ sale, record }), original);
});
