import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Sale, { hideArchivedSales, withArchivedSales } from '../models/Sale.js';
import { makeArchiveHandlers, archiveFingerprint, archiveInput, testArchiveEnabled } from './testSaleArchive.js';

const saleId = '200000000000000000000001', adminId = '100000000000000000000001';
const operation = '11111111-2222-4333-8444-555555555555';
const admin = { _id: adminId, user_role: { role_name: 'Test Yöneticisi' } };
const response = () => ({ statusCode: 200, data: null, set() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } });
const record = status => ({ _id: saleId, customer_name: 'SYNTHETIC TEST', status, payments: [{ amount: 14000, method: 'Mail Order', ledger_account_id: '300000000000000000000001' }], stock_deductions: [{ product: '400000000000000000000001', quantity: 5 }], grand_total: 28000, payment_revision: 2, measurement_revision: 3, delivery_date: '2026-10-30', createdAt: '2026-10-23', updatedAt: '2026-10-24' });
const query = read => ({ session() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => structuredClone(read()) });
function fixture(status = 'tamamlandi') {
  const db = { sale: record(status), batches: [], writes: [], ledger: { balance_minor: '24159935', entries: [{ amount_minor: '1300000', method: 'Mail Order', description: 'Correct manual Lilium payment' }] }, stock: 33, failInsert: false, failRestoreAudit: false };
  const sales = {
    findById: id => query(() => id === saleId && !db.sale.test_archive_batch ? db.sale : null),
    updateOne(filter, update, options) {
      const operation = { filter, update, options, _includeArchivedSales: false };
      operation.then = (resolve, reject) => Promise.resolve().then(() => {
        if (!operation._includeArchivedSales && db.sale.test_archive_batch) return { modifiedCount: 0 };
        if (filter.test_archive_batch && filter.test_archive_batch !== db.sale.test_archive_batch) return { modifiedCount: 0 };
        assert.equal(options.timestamps, false); db.writes.push(structuredClone({ filter, update }));
        Object.assign(db.sale, update.$set || {}); for (const key of Object.keys(update.$unset || {})) delete db.sale[key];
        return { modifiedCount: 1 };
      }).then(resolve, reject);
      return operation;
    },
  };
  const archives = {
    init: async () => {},
    find: () => query(() => db.batches),
    findOne: filter => query(() => db.batches.find(batch => batch.operation === filter.operation) || null),
    create: async ([batch]) => { if (db.failInsert) throw Error('database failure'); db.batches.push({ _id: '500000000000000000000001', ...structuredClone(batch), restored_at: null }); },
    updateOne: async (filter, update) => { if (db.failRestoreAudit) return { modifiedCount: 0 }; const batch = db.batches.find(b => b._id === filter._id && b.restored_at === null); if (!batch) return { modifiedCount: 0 }; Object.assign(batch, update.$set); return { modifiedCount: 1 }; },
  };
  const transaction = async fn => { const before = structuredClone(db); try { return await fn({}); } catch (e) { Object.assign(db, before); throw e; } };
  return { db, handlers: makeArchiveHandlers({ sales, archives, include: withArchivedSales, transaction, enabled: () => true }) };
}
const request = (sale, overrides = {}) => ({ user: admin, query: {}, body: { request_id: operation, sale_id: saleId, fingerprint: archiveFingerprint(sale) }, ...overrides });

test('only the named TEST service and test database can enable trial archiving', () => {
  const env = { RENDER_SERVICE_ID: 'srv-db3bk5942hec7397afkg' };
  assert.equal(testArchiveEnabled(env, 'sahinsoy_test'), true);
  assert.equal(testArchiveEnabled(env, 'sahinsoy'), false);
  assert.equal(testArchiveEnabled({ RENDER_SERVICE_ID: 'another-service' }, 'sahinsoy_test'), false);
  assert.equal(testArchiveEnabled({}, 'sahinsoy_test'), false);
});

test('all normal sale reads, updates, counts and aggregations exclude archived records', () => {
  const q = Sale.find({ status: 'tamamlandi' }); hideArchivedSales.call(q);
  assert.deepEqual(q.getFilter(), { status: 'tamamlandi', test_archive_batch: { $exists: false } });
  const bypass = withArchivedSales(Sale.updateOne({ _id: saleId, test_archive_batch: operation }, {})); hideArchivedSales.call(bypass);
  assert.deepEqual(bypass.getFilter(), { _id: saleId, test_archive_batch: operation });
  for (const hook of ['find', 'findOne', 'countDocuments', 'distinct', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'aggregate']) assert.ok(Sale.schema.s.hooks._pres.has(hook), hook);
});

test('tampered input cannot change payments, ledger, stock or the archive selector', () => {
  const valid = request(record('tamamlandi')).body;
  for (const patch of [{ request_id: 'bad' }, { sale_id: { $ne: null } }, { fingerprint: 'bad' }, { payments: [] }, { ledger_account_id: 'x' }, { stock_quantity: 0 }, { all: true }]) assert.throws(() => archiveInput({ ...valid, ...patch }));
  assert.throws(() => archiveInput({ request_id: operation, sale_id: saleId }, true));
});

test('preview is read-only; non-admin and non-TEST requests cannot list or modify trials', async () => {
  const { db, handlers } = fixture(), before = structuredClone(db);
  const preview = response(); await handlers.list(request(db.sale, { query: { sale_id: saleId } }), preview);
  assert.equal(preview.statusCode, 200); assert.equal(preview.data.preview.fingerprint, archiveFingerprint(db.sale)); assert.deepEqual(db, before);
  for (const action of ['list', 'archive', 'restore']) { const res = response(); await handlers[action](request(db.sale, { user: { _id: adminId, user_role: { role_name: 'Satış Temsilcisi' } } }), res); assert.equal(res.statusCode, 403); }
  const disabled = makeArchiveHandlers({ enabled: () => false }); const res = response(); await disabled.list(request(db.sale), res); assert.equal(res.statusCode, 404);
  const invalid = response(); await handlers.list(request(db.sale, { query: { includeArchived: true } }), invalid); assert.equal(invalid.statusCode, 400);
  assert.deepEqual(db, before);
});

test('all five statuses archive and restore unchanged with manual Lilium 13,000 and every financial/stock field intact', async () => {
  for (const status of ['beklemede', 'tamamlandi', 'teslim_edildi', 'kaybedildi', 'iptal']) {
    const { db, handlers } = fixture(status), before = structuredClone(db), req = request(db.sale), res = response();
    await handlers.archive(req, res); assert.equal(res.statusCode, 200); assert.equal(db.sale.test_archive_batch, operation);
    const visible = structuredClone(db.sale); delete visible.test_archive_batch; delete visible.test_archive_at; delete visible.test_archive_by;
    assert.deepEqual(visible, before.sale); assert.deepEqual(db.ledger, before.ledger); assert.equal(db.stock, before.stock);
    assert.deepEqual(Object.keys(db.writes[0].update.$set).sort(), ['test_archive_at', 'test_archive_batch', 'test_archive_by']);
    await handlers.archive(req, response()); assert.equal(db.writes.length, 1); assert.equal(db.batches.length, 1);
    const list = response(); await handlers.list(request(db.sale), list); assert.equal(list.data.records[0].sale_id, saleId); assert.equal(list.data.records[0].previous_status, status);
    const restored = response(); await handlers.restore(request(db.sale, { body: { request_id: operation } }), restored);
    assert.equal(restored.statusCode, 200); assert.deepEqual(db.sale, before.sale); assert.deepEqual(db.ledger, before.ledger); assert.equal(db.stock, before.stock);
    await handlers.restore(request(db.sale, { body: { request_id: operation } }), response()); assert.equal(db.writes.length, 2);
    const reuse = response(); await handlers.archive(req, reuse); assert.equal(reuse.statusCode, 409); assert.deepEqual(db.sale, before.sale);
  }
});

test('a changed order, mismatched replay or failed transaction never hides or partially restores an order', async () => {
  const { db, handlers } = fixture(), stale = request(db.sale);
  db.sale.payment_revision++; const res = response(); await handlers.archive(stale, res); assert.equal(res.statusCode, 409); assert.equal(db.writes.length, 0);
  const before = structuredClone(db); db.failInsert = true; const fail = response(); await handlers.archive(request(db.sale), fail); assert.equal(fail.statusCode, 500); assert.equal(db.writes.length, 0); assert.equal(db.batches.length, 0);
  db.failInsert = false; const req = request(db.sale); await handlers.archive(req, response()); const archived = structuredClone(db);
  db.failRestoreAudit = true; const restore = response(); await handlers.restore(request(db.sale, { body: { request_id: operation } }), restore); assert.equal(restore.statusCode, 409); assert.deepEqual(db.sale, archived.sale); assert.equal(db.batches[0].restored_at, null);
  const replay = response(); await handlers.archive({ ...req, body: { ...req.body, sale_id: '200000000000000000000002' } }, replay); assert.equal(replay.statusCode, 409);
  assert.deepEqual(db.ledger, before.ledger);
});

test('archive code has no ledger/payment, inventory, invoice or messaging writes and routes remain protected', async () => {
  const code = await readFile(new URL('./testSaleArchive.js', import.meta.url), 'utf8');
  for (const forbidden of ['LedgerAccount', 'postMailOrderLedger', 'paymentVoid', "models/Product", 'Notification', 'sendMessage', '$inc', 'deleteMany']) assert.ok(!code.includes(forbidden), forbidden);
  const routes = await readFile(new URL('../routes/sale.route.js', import.meta.url), 'utf8');
  for (const route of ["router.get('/test-archive', protect,", "router.post('/test-archive', protect,", "router.post('/test-archive/restore', protect,"]) assert.ok(routes.includes(route));
});
