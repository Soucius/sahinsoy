import Sale from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';
import { VisitPlan, visitCards, visitToday } from './visitPlanning.js';
import { fingerprint } from './productionWorkflow.js';
import { orderAttention, variantEdit } from './orderAttentionRules.js';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { salePayload } from './curtainCalculation.js';
const editSchema = new mongoose.Schema({ sale: { type: mongoose.Schema.Types.ObjectId, required: true }, request_id: String, fingerprint: String, line_id: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed, by: String, name: String }, { timestamps: true });
editSchema.index({ sale: 1, request_id: 1 }, { unique: true });
export const OrderVariantEdit = mongoose.models.OrderVariantEdit || mongoose.model('OrderVariantEdit', editSchema);
const populateAttention = query => query.populate({ path: 'sale_items.product', select: 'product_name product_category product_brand product_color variants', populate: [{ path: 'product_category', select: 'category_name' }, { path: 'product_brand', select: 'brand_name' }] });

export async function getOrderAttention(req, res) {
  res.set('Cache-Control', 'no-store');
  if (req.productionActor?.kind !== 'admin') return res.status(403).json({ message: 'Sipariş eksik bilgi listesi yalnız yöneticilere açıktır.' });
  if (Object.keys(req.query).length) return res.status(400).json({ message: 'Eksik bilgi sorgusu geçersiz.' });
  try {
    const sales = await populateAttention(Sale.find({ status: { $in: ['beklemede', 'tamamlandi'] } }).select('sale_items pos_details customer_name status measurement_date measurement_status measurement_revision measurement_source measurement_master delivery_method delivery_date')).sort({ createdAt: -1 }).limit(1001).lean();
    const ids = sales.slice(0, 1000).map(sale => sale._id);
    const records = await ProductionOrder.find({ sale: { $in: ids } }).lean();
    const plans = await VisitPlan.find({ sale: { $in: ids }, kind: 'measurement' }).lean();
    const staff = await Staff.find({}).select('name active duties').lean(), today = visitToday();
    const visits = visitCards(sales.slice(0, 1000), plans, staff, req.productionActor);
    const orders = sales.slice(0, 1000).map(sale => {
      const record = records.find(row => String(row.sale) === String(sale._id)), fresh = !!record && record.source_fingerprint === fingerprint(sale);
      const warnings = orderAttention(sale, record, fresh, today);
      const colorIds = new Set(warnings.filter(row => row.kind === 'color').map(row => row.line_id));
      const color_lines = sale.sale_items.flatMap((item, index) => { const line = sale.pos_details?.cart?.[index]; return colorIds.has(String(item._id)) && line && String(line.product_id) === String(item.product?._id || item.product) ? [{ id: String(item._id), name: [line.product_name || 'Ürün', item.room_name || '', Number(item.width) > 0 ? `${item.width}${Number(item.height) > 0 ? ` × ${item.height}` : ''} cm` : ''].filter(Boolean).join(' · '), room: item.room_name || '', variant: line.variant || '', panels: (line.mechanical_panels || []).map((panel, i) => ({ label: panel.position || panel.label || `${i + 1}. parça`, variant: panel.variant || '' })) }] : []; });
      return { id: String(sale._id), customer_name: sale.customer_name || 'Müşteri', status: sale.status, fingerprint: fingerprint(sale), color_lines, warnings, visit: visits.find(card => card.sale_id === String(sale._id) && card.kind === 'measurement') || null };
    }).filter(order => order.warnings.length).sort((a, b) => Number(b.warnings.some(row => row.code === 'measurement_overdue')) - Number(a.warnings.some(row => row.code === 'measurement_overdue')));
    res.json({ today, orders, truncated: sales.length > 1000, staff: staff.map(person => ({ id: String(person._id), name: person.name, active: person.active, duties: person.duties })) });
  } catch { res.status(500).json({ message: 'Eksik bilgi uyarıları yüklenemedi. Siparişleri kontrol edin; uyarı yok anlamına gelmez.' }); }
}
export async function saveOrderVariant(req, res) {
  if (req.productionActor?.kind !== 'admin') return res.status(403).json({ message: 'Renk / VR bilgisini yalnız yönetici tamamlayabilir.' });
  if (!/^[a-f\d]{24}$/i.test(req.params.saleId || '')) return res.status(400).json({ message: 'Sipariş numarası geçersiz.' });
  try {
    await OrderVariantEdit.init();
    await mongoose.connection.transaction(async session => {
      const sale = await populateAttention(Sale.findOneAndUpdate({ _id: req.params.saleId }, { $inc: { production_guard: 1 } }, { new: true, session, timestamps: false })).lean();
      if (!sale) throw new Error('Sipariş bulunamadı veya arşivde.');
      const change = variantEdit(sale, req.body), hash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      const prior = await OrderVariantEdit.findOne({ sale: sale._id, request_id: req.body.request_id }).session(session).lean();
      if (prior) { if (prior.fingerprint !== hash) throw new Error('İşlem kimliği farklı bilgilerle kullanıldı.'); return; }
      if (fingerprint(sale) !== req.body.expected_fingerprint) throw new Error('Sipariş veya ölçü değişti. Listeyi yenileyin.');
      if (await OrderVariantEdit.countDocuments({ sale: sale._id }).session(session) >= 500) throw new Error('Renk / VR revizyon sınırına ulaşıldı.');
      // Generate only the descriptive note; never persist recalculated prices or quantities.
      const note = salePayload([change.next], {}, 0, sale.status).sale_items[0].item_note;
      const set = { [`pos_details.cart.${change.index}.variant`]: change.next.variant, [`sale_items.${change.index}.item_note`]: note };
      if (change.next.mechanical_panels?.length) set[`pos_details.cart.${change.index}.mechanical_panels`] = change.next.mechanical_panels;
      await Sale.updateOne({ _id: sale._id }, { $set: set }, { session, timestamps: false, runValidators: true });
      await OrderVariantEdit.create([{ sale: sale._id, request_id: req.body.request_id, fingerprint: hash, line_id: req.body.line_id, before: change.before, after: change.after, by: req.productionActor._id, name: req.productionActor.name }], { session });
    });
    res.json({ saved: true });
  } catch (error) { res.status(error?.code === 11000 ? 409 : 400).json({ message: error?.name === 'Error' ? error.message : 'Renk / VR kaydı doğrulanamadı. Listeyi yenileyin.' }); }
}
