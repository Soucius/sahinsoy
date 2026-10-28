import express from 'express';
import mongoose from 'mongoose';
import protect from '../middlewares/auth.middleware.js';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { CashOffice, OfficeEntry } from './cashPersonnel.js';
import { isProductionAdmin } from './productionAccess.js';
import { ProfitError, profitHash, profitId, profitSource, profitLines, automaticSewing, normalizeProfit, calculateProfit, profitDecimal } from './orderProfitRules.js';

const schema = new mongoose.Schema({ sale: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true }, revision: { type: Number, default: 0 }, source: String, costs: mongoose.Schema.Types.Mixed, history: [mongoose.Schema.Types.Mixed] }, { timestamps: true });
export const OrderProfit = mongoose.models.OrderProfit || mongoose.model('OrderProfit', schema);
export const orderProfitRouter = express.Router();
orderProfitRouter.use(protect, (req, res, next) => isProductionAdmin(req.user) ? next() : res.status(403).json({ message: 'Maliyet ve kâr hesabı yalnız mağaza yöneticisine açıktır.' }));
orderProfitRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fail = (res, error) => res.status(error instanceof ProfitError ? error.status : error?.code === 11000 ? 409 : 500).json({ message: error instanceof ProfitError ? error.message : error?.code === 11000 ? 'Maliyet aynı anda değişti. Yenileyin.' : 'Sipariş maliyeti yüklenemedi / kaydedilemedi.' });
async function context(id, session = null) {
  if (!profitId(id)) throw new ProfitError('Sipariş numarası geçersiz.');
  const sale = await Sale.findById(id).session(session).lean();
  if (!sale) throw new ProfitError('Sipariş bulunamadı veya deneme arşivine kaldırıldı.', 404);
  if (!['beklemede', 'tamamlandi', 'teslim_edildi'].includes(sale.status)) throw new ProfitError('İptal edilen / kaybedilen iş için aktif kâr hesabı yapılmaz.', 409);
  const products = await Product.find({ _id: { $in: sale.sale_items.map(row => row.product) } }).select('product_name product_brand purchase_price currency').populate('product_brand', 'brand_name').session(session).lean();
  const lines = profitLines(sale, products), sheet = await OrderProfit.findOne({ sale: id }).session(session).lean();
  const entries = await OfficeEntry.find({ 'sewing.sale_id': id }).sort({ _id: 1 }).limit(2001).session(session).lean();
  const sewing = automaticSewing(sale, lines, entries.slice(0, 2000), entries.length > 2000);
  const source = profitSource(sale), view_token = profitHash([source, sewing.token, sewing.complete, sheet?.revision || 0]);
  return { sale, lines, sheet, sewing, source, view_token };
}
function dto(ctx) {
  const { sale, lines, sheet, sewing, view_token } = ctx, costs = sheet?.costs;
  return { sale: { id: String(sale._id), customer_name: sale.customer_name, status: sale.status, grand_total: sale.grand_total, discount_amount: sale.discount_amount, credit_card_fee: sale.credit_card_fee, delivery_method: sale.delivery_method }, lines, sewing, view_token, revision: sheet?.revision || 0, saved_at: sheet?.updatedAt || null, history: (sheet?.history || []).slice(-10).reverse().map(row => ({ at: row.at, name: row.name, estimate: row.costs.estimate })), summary: calculateProfit(sale, lines, sheet, sewing), form: { lines: lines.map(line => { const saved = costs?.lines?.find(row => row.id === line.id); return { id: line.id, unit_cost: profitDecimal(saved ? saved.unit_units : line.suggestion_units, 4), extra_cost: profitDecimal(saved ? saved.extra_minor : line.extras_unknown || line.extras.length ? null : '0') }; }), labor_mode: costs?.labor_mode || 'auto', labor_amount: profitDecimal(costs?.labor_minor), installation_amount: profitDecimal(costs ? costs.installation_minor : ['store', 'magaza'].includes(sale.delivery_method) ? '0' : null), other_amount: profitDecimal(costs?.other_minor), estimate: costs?.estimate ?? true, note: costs?.note || '' } };
}
orderProfitRouter.get('/', async (_req, res) => {
  try { const sales = await Sale.find({ status: { $in: ['beklemede', 'tamamlandi', 'teslim_edildi'] } }).select('customer_name grand_total status createdAt').sort({ createdAt: -1 }).limit(501).lean(); res.json({ sales: sales.slice(0, 500), truncated: sales.length > 500 }); }
  catch (error) { fail(res, error); }
});
orderProfitRouter.get('/:id', async (req, res) => { try { res.json(dto(await context(req.params.id))); } catch (error) { fail(res, error); } });
orderProfitRouter.post('/:id', async (req, res) => {
  try {
    await OrderProfit.init();
    await mongoose.connection.transaction(async session => {
      if (!profitId(req.params.id)) throw new ProfitError('Sipariş numarası geçersiz.');
      // Serialize against measurement/cancellation and sewing accrual. No ledger or payment is posted here.
      const sale = await Sale.findOneAndUpdate({ _id: req.params.id }, { $inc: { production_guard: 1 } }, { new: true, session, timestamps: false }).lean();
      if (!sale) throw new ProfitError('Sipariş bulunamadı.', 404);
      await CashOffice.findOneAndUpdate({ _id: 'store' }, { $inc: { revision: 1 } }, { session });
      const ctx = await context(req.params.id, session), costs = normalizeProfit(req.body, ctx.lines), fingerprint = profitHash(req.body);
      const prior = ctx.sheet?.history?.find(row => row.operation === req.body.operation_id);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new ProfitError('İşlem kimliği farklı bilgilerle kullanıldı.', 409); return; }
      if (ctx.view_token !== req.body.view_token || (ctx.sheet?.revision || 0) !== req.body.expected_revision) throw new ProfitError('Sipariş veya dikim maliyeti değişti. Yenileyip tekrar kontrol edin.', 409);
      if ((ctx.sheet?.history?.length || 0) >= 200) throw new ProfitError('Maliyet revizyon sınırına ulaşıldı.', 409);
      const audit = { operation: req.body.operation_id, fingerprint, at: new Date(), by: req.user._id, name: req.user.user_username || req.user.name || 'Yönetici', source: ctx.source, costs };
      if (ctx.sheet) await OrderProfit.updateOne({ _id: ctx.sheet._id, revision: ctx.sheet.revision }, { $set: { costs, source: ctx.source }, $inc: { revision: 1 }, $push: { history: audit } }, { session });
      else await OrderProfit.create([{ sale: sale._id, revision: 1, costs, source: ctx.source, history: [audit] }], { session });
    });
    res.json(dto(await context(req.params.id)));
  } catch (error) { fail(res, error); }
});
