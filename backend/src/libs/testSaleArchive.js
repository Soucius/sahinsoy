import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Sale, { withArchivedSales } from '../models/Sale.js';
import { isProductionAdmin } from './productionAccess.js';

const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const oid = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
export const testArchiveEnabled = (env = process.env, database = mongoose.connection.name) => env.RENDER_SERVICE_ID === 'srv-db3bk5942hec7397afkg' && database === 'sahinsoy_test';
export const archiveFingerprint = sale => createHash('sha256').update(JSON.stringify(sale)).digest('hex');
class ArchiveError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function archiveInput(body, restoring = false) {
  const fields = restoring ? ['request_id'] : ['request_id', 'sale_id', 'fingerprint'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)) || !uuid(body.request_id)) throw new ArchiveError('Kaldırma işleminin bilgileri geçersiz.');
  if (!restoring && (!oid(body.sale_id) || typeof body.fingerprint !== 'string' || !/^[a-f\d]{64}$/.test(body.fingerprint))) throw new ArchiveError('Siparişi yeniden açıp güncel kaydı kontrol edin.');
  return body;
}
const schema = new mongoose.Schema({
  operation: { type: String, required: true, unique: true },
  fingerprint: { type: String, required: true },
  sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
  customer_name: String, previous_status: String,
  archived_at: { type: Date, required: true }, archived_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  restored_at: { type: Date, default: null }, restored_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
});
export const TestSaleArchive = mongoose.models.TestSaleArchive || mongoose.model('TestSaleArchive', schema);
const publicArchive = record => ({ id: record.operation, sale_id: String(record.sale), customer_name: record.customer_name || 'Müşteri', previous_status: record.previous_status, archived_at: record.archived_at, restored_at: record.restored_at });

export function makeArchiveHandlers({ sales = Sale, archives = TestSaleArchive, include = withArchivedSales, transaction = fn => mongoose.connection.transaction(fn), enabled = testArchiveEnabled } = {}) {
  function authorize(req) {
    if (!isProductionAdmin(req.user)) throw new ArchiveError('Deneme arşivi yalnız mağaza yöneticisine açıktır.', 403);
    if (!enabled()) throw new ArchiveError('Bu işlem yalnız Şahinsoy TEST ortamında kullanılabilir.', 404);
  }
  const fail = (res, error) => res.status(error instanceof ArchiveError ? error.status : error?.code === 11000 ? 409 : 500).json({ message: error instanceof ArchiveError ? error.message : 'Arşiv sonucu doğrulanamadı. Listeyi yenileyip kaydı kontrol edin.' });
  async function list(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      authorize(req);
      if (Object.keys(req.query).some(key => key !== 'sale_id') || (req.query.sale_id !== undefined && !oid(req.query.sale_id))) throw new ArchiveError('Sipariş numarası geçersiz.');
      if (req.query.sale_id) {
        const sale = await sales.findById(req.query.sale_id).lean();
        if (!sale) throw new ArchiveError('Sipariş bulunamadı veya zaten arşivde.', 404);
        return res.json({ enabled: true, preview: { sale_id: String(sale._id), customer_name: sale.customer_name, status: sale.status, fingerprint: archiveFingerprint(sale) } });
      }
      const records = await archives.find({}).sort({ archived_at: -1 }).limit(501).lean();
      return res.json({ enabled: true, records: records.slice(0, 500).map(publicArchive), truncated: records.length > 500 });
    } catch (error) { return fail(res, error); }
  }
  async function archive(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      authorize(req); const input = archiveInput(req.body); await archives.init();
      await transaction(async session => {
        const prior = await archives.findOne({ operation: input.request_id }).session(session).lean();
        if (prior) {
          if (String(prior.sale) !== input.sale_id || prior.fingerprint !== input.fingerprint || prior.restored_at) throw new ArchiveError('Bu işlem kimliği daha önce kullanıldı. Listeyi yenileyin.', 409);
          return;
        }
        const sale = await sales.findById(input.sale_id).session(session).lean();
        if (!sale) throw new ArchiveError('Sipariş bulunamadı veya zaten kaldırılmış.', 409);
        if (archiveFingerprint(sale) !== input.fingerprint) throw new ArchiveError('Sipariş değişti. Güncel kaydı kontrol edip yeniden kaldırın.', 409);
        const now = new Date();
        await archives.create([{ operation: input.request_id, fingerprint: input.fingerprint, sale: sale._id, customer_name: sale.customer_name, previous_status: sale.status, archived_at: now, archived_by: req.user._id }], { session });
        const result = await sales.updateOne({ _id: sale._id }, { $set: { test_archive_batch: input.request_id, test_archive_at: now, test_archive_by: req.user._id } }, { session, timestamps: false });
        if (result.modifiedCount !== 1) throw new ArchiveError('Kayıt aynı anda değişti. Listeyi yenileyin.', 409);
      });
      return res.json({ archived: true, sale_id: input.sale_id });
    } catch (error) { return fail(res, error); }
  }
  async function restore(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      authorize(req); const input = archiveInput(req.body, true);
      await transaction(async session => {
        const record = await archives.findOne({ operation: input.request_id }).session(session).lean();
        if (!record) throw new ArchiveError('Arşiv kaydı bulunamadı.', 404);
        if (record.restored_at) return;
        const result = await include(sales.updateOne({ _id: record.sale, test_archive_batch: record.operation }, { $unset: { test_archive_batch: '', test_archive_at: '', test_archive_by: '' } }, { session, timestamps: false }));
        if (result.modifiedCount !== 1) throw new ArchiveError('Sipariş arşivi değişti. Listeyi yenileyin.', 409);
        const saved = await archives.updateOne({ _id: record._id, restored_at: null }, { $set: { restored_at: new Date(), restored_by: req.user._id } }, { session });
        if (saved.modifiedCount !== 1) throw new ArchiveError('Geri alma işlemi aynı anda değişti.', 409);
      });
      return res.json({ restored: true });
    } catch (error) { return fail(res, error); }
  }
  return { list, archive, restore };
}
export const testSaleArchiveHandlers = makeArchiveHandlers();
