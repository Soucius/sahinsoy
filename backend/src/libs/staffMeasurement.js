import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Sale from '../models/Sale.js';
import { VisitPlan, VisitError } from './visitPlanning.js';
import { fingerprint } from './productionWorkflow.js';
import { measurementFormForLine } from './orderMeasurement.js';
import { usesWidthOnlyMeasurements } from './curtainCalculation.js';
import { applySaleMeasurementRevision } from '../controllers/sale.controller.js';
const id = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const rawId = value => String(value?._id || value || '');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireAssignedMeasurement(actor, plan, sale) {
  if (actor?.kind !== 'staff' || !actor.duties.includes('installation') || !plan || plan.kind !== 'measurement' || rawId(plan.assigned_to) !== rawId(actor._id) || rawId(plan.sale) !== rawId(sale?._id)) throw new VisitError('Bu ölçü işi size atanmamış.', 403);
  if (!['beklemede', 'tamamlandi'].includes(sale.status)) throw new VisitError('Bu iş kapandı; ölçü değiştirilemez.', 409);
}
export function staffMeasurementInput(body) {
  const fields = ['request_id', 'expected_revision', 'expected_visit_revision', 'expected_fingerprint', 'measurements', 'note'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw new VisitError('Yalnız ölçü alanları gönderilebilir.');
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(body.request_id || '') || !/^[a-f\d]{64}$/.test(body.expected_fingerprint || '') || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0 || !Number.isSafeInteger(body.expected_visit_revision) || body.expected_visit_revision < 0) throw new VisitError('Ölçü ekranını yenileyin.');
  if (!Array.isArray(body.measurements) || body.measurements.length < 1 || body.measurements.length > 500 || typeof body.note !== 'string' || body.note.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.note)) throw new VisitError('Ölçüleri ve notu kontrol edin.');
  return { ...body, request_id: body.request_id.toLowerCase(), note: body.note.trim() };
}
export function staffMeasurementView(sale, plan, actor) {
  requireAssignedMeasurement(actor, plan, sale);
  const cart = sale.pos_details?.cart;
  if (!Array.isArray(cart) || !cart.length || cart.length > 500 || cart.length !== sale.sale_items.length) throw new VisitError('Bu eski işin ayrıntılı ölçü kaydı yok. Mağazayla görüşün.', 409);
  const lines = cart.map((line, index) => {
    if (rawId(line.product_id) !== rawId(sale.sale_items[index].product)) throw new VisitError('Ürün ölçü kaydı eşleşmiyor. Mağazayla görüşün.', 409);
    let form; try { form = measurementFormForLine(line); } catch { throw new VisitError('Ürünün ölçü kaydı çözümlenemedi. Mağazayla görüşün.', 409); }
    return { id: String(line.id), name: line.product_name || 'Ürün', room: line.room_name || '', area: line.area || '', variant: line.variant || '', width_only: usesWidthOnlyMeasurements(line), motor: line.motor_system?.role === 'motor', dual_group: line.dual_plise?.group_id || '', shared_measurements: line.dual_plise?.shared_measurements === true, dual_role: line.dual_plise?.role || '', panel_labels: (line.mechanical_panels || []).map((panel, i) => panel.position || panel.label || `${i + 1}. parça`), form };
  });
  // Never return the sale/cart, prices, FX, payments, stock, customer contacts or financial audit.
  return { sale_id: rawId(sale), customer_name: sale.customer_name || 'Müşteri', expected_revision: sale.measurement_revision || 0, expected_visit_revision: plan.revision, expected_fingerprint: fingerprint(sale), confirmed: sale.measurement_status === 'confirmed', planned_date: plan.date, lines, note: '' };
}
async function context(saleId, actor, session = null, document = false) {
  if (!id(saleId)) throw new VisitError('Ölçü işi bulunamadı.', 404);
  if (actor?.kind !== 'staff' || !actor.duties.includes('installation')) throw new VisitError('Bu işlem ölçü / montaj personeline açıktır.', 403);
  const plan = await VisitPlan.findOne({ sale: saleId, kind: 'measurement', assigned_to: actor._id }).session(session).lean();
  if (!plan) throw new VisitError('Bu ölçü işi size atanmamış.', 403);
  const query = Sale.findById(saleId).session(session), sale = document ? await query : await query.lean();
  if (!sale) throw new VisitError('Ölçü işi bulunamadı veya arşivde.', 404);
  requireAssignedMeasurement(actor, plan, sale); return { sale, plan };
}
function fail(res, error) { const known = error instanceof VisitError; return res.status(known ? error.status : 409).json({ message: known ? error.message : 'Ölçü kaydedilemedi. Ölçüleri tekrar kontrol edin; stok veya eski sipariş kaydı için mağazayla görüşün.' }); }
export async function getStaffMeasurement(req, res) {
  res.set('Cache-Control', 'no-store');
  try { if (Object.keys(req.query).length) throw new VisitError('Ölçü sorgusu geçersiz.'); const { sale, plan } = await context(req.params.saleId, req.productionActor); res.json(staffMeasurementView(sale, plan, req.productionActor)); }
  catch (error) { fail(res, error); }
}
export async function saveStaffMeasurement(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const input = staffMeasurementInput(req.body), actor = req.productionActor;
    let revision;
    await mongoose.connection.transaction(async session => {
      const { sale, plan } = await context(req.params.saleId, actor, session, true), requestId = `staff-${actor._id}-${input.request_id}`, requestHash = hash(input);
      const prior = sale.measurement_history.find(row => row.request_id === requestId);
      if (prior) { if (prior.request_fingerprint !== requestHash || rawId(prior.changed_by_staff) !== rawId(actor._id)) throw new VisitError('İşlem kimliği farklı ölçülerle kullanıldı.', 409); revision = sale.measurement_revision; return; }
      if (plan.revision !== input.expected_visit_revision || (sale.measurement_revision || 0) !== input.expected_revision || fingerprint(sale.toObject()) !== input.expected_fingerprint) throw new VisitError('İş veya ölçü başka bir ekranda değişti. Son ölçüleri yeniden yükleyin.', 409);
      const locked = await VisitPlan.updateOne({ _id: plan._id, revision: plan.revision, assigned_to: actor._id }, { $inc: { revision: 1 } }, { session });
      if (locked.modifiedCount !== 1) throw new VisitError('İşin ataması değişti. Listeyi yenileyin.', 409);
      await Sale.updateOne({ _id: sale._id }, { $inc: { production_guard: 1 } }, { session, timestamps: false });
      await applySaleMeasurementRevision(sale, { expected_revision: input.expected_revision, measurements: input.measurements, client_request_id: requestId, request_fingerprint: requestHash, measurement_source: 'team', measurement_master: actor.name, measurement_note: input.note, measurement_date: sale.measurement_date }, { staff_id: actor._id, name: actor.name }, session);
      revision = sale.measurement_revision;
    });
    res.json({ saved: true, measurement_revision: revision, measurement_status: 'confirmed' });
  } catch (error) { fail(res, error); }
}
