import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Sale from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';

export class VisitError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const VISIT_KINDS = { measurement: 'Ölçü', installation: 'Montaj', store: 'Mağaza teslimi' };
const activeStatuses = ['beklemede', 'tamamlandi'];
const oid = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const visitToday = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(now || new Date());
export function visitDay(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
  const date = new Date(value); return Number.isFinite(date.getTime()) ? visitToday(date) : '';
}
const method = sale => ['montaj', 'installation'].includes(sale.delivery_method) ? 'installation' : ['store', 'magaza'].includes(sale.delivery_method) ? 'store' : '';
export function visitEligible(sale, kind) {
  return activeStatuses.includes(sale.status) && (kind === 'measurement' || sale.status === 'tamamlandi' && method(sale) === kind);
}
const eventSchema = new mongoose.Schema({ request_id: String, fingerprint: String, at: Date, by: String, name: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }, { _id: false });
const schema = new mongoose.Schema({
  sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
  kind: { type: String, enum: Object.keys(VISIT_KINDS), required: true },
  date: { type: String, required: true }, assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionStaff', default: null },
  note: { type: String, maxlength: 1000, default: '' }, revision: { type: Number, default: 0, min: 0 },
  history: { type: [eventSchema], default: [], validate: value => value.length <= 500 },
}, { timestamps: true });
schema.index({ sale: 1, kind: 1 }, { unique: true });
schema.index({ assigned_to: 1, date: 1 });
export const VisitPlan = mongoose.models.VisitPlan || mongoose.model('VisitPlan', schema);
function cleanNote(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new VisitError('İş notunu kontrol edin.');
  return value.trim();
}
export function visitInput(body) {
  const allowed = ['request_id', 'kind', 'date', 'assigned_to', 'note', 'expected_revision', 'expected_date', 'expected_measurement_revision'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new VisitError('Yalnız randevu alanları güncellenebilir.');
  if (!uuid(body.request_id) || !Object.hasOwn(VISIT_KINDS, body.kind)) throw new VisitError('Randevu kimliği veya türü geçersiz.');
  if (!visitDay(body.date) || body.date !== visitDay(body.date) || body.date < '2020-01-01' || body.date > '2100-12-31') throw new VisitError('Geçerli bir termin tarihi seçin.');
  if (typeof body.assigned_to !== 'string' || body.assigned_to && !oid(body.assigned_to) || body.kind === 'store' && body.assigned_to) throw new VisitError('Randevunun sorumlusunu kontrol edin.');
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < -1 || typeof body.expected_date !== 'string' || body.expected_date && visitDay(body.expected_date) !== body.expected_date || !Number.isSafeInteger(body.expected_measurement_revision) || body.expected_measurement_revision < 0) throw new VisitError('Plan sürümü geçersiz. Günlük planı yenileyin.', 409);
  return { ...body, request_id: body.request_id.toLowerCase(), assigned_to: body.assigned_to.toLowerCase(), note: cleanNote(body.note ?? '') };
}
const dateOf = (sale, kind) => visitDay(kind === 'measurement' ? sale.measurement_date : sale.delivery_date);
const metadata = sale => clone(Object.fromEntries(['measurement_date', 'measurement_status', 'measurement_source', 'measurement_master', 'measurement_note', 'measurement_revision'].map(key => [key, sale[key] ?? null])));
export function visitChange(sale, prior, input, actor, staff, now = new Date()) {
  const fingerprint = digest({ kind: input.kind, date: input.date, assigned_to: input.assigned_to, note: input.note });
  const oldRequest = prior?.history.find(item => item.request_id === input.request_id);
  if (oldRequest) { if (oldRequest.fingerprint !== fingerprint) throw new VisitError('Aynı kayıt kimliği farklı bilgilerle kullanılamaz.', 409); return { existing: true }; }
  if (!visitEligible(sale, input.kind)) throw new VisitError('Bu siparişin durumu veya teslim yöntemi seçilen randevuya uygun değil.', 409);
  if ((prior?.revision ?? -1) !== input.expected_revision || dateOf(sale, input.kind) !== input.expected_date || input.kind === 'measurement' && (sale.measurement_revision || 0) !== input.expected_measurement_revision) throw new VisitError('Randevu başka bir ekranda değişti. Planı yenileyip güncel kaydı kontrol edin.', 409);
  if ((prior?.history.length || 0) >= 500 || input.kind === 'measurement' && (sale.measurement_history?.length || 0) >= 5000) throw new VisitError('Randevu geçmişi sınırına ulaşıldı.', 409);
  if (input.assigned_to && (!staff?.active || !staff.duties.includes('installation') || String(staff._id) !== input.assigned_to)) throw new VisitError('Ölçü / montaj için giriş izni açık ve montaj yetkili bir personel seçin.');
  const target = { date: input.date, assigned_to: input.assigned_to || null, note: input.note };
  const dateChanged = dateOf(sale, input.kind) !== input.date;
  const set = {}, inc = { production_guard: 1 }, push = {};
  if (input.kind === 'measurement') {
    // A date-only reassignment must not invalidate confirmed dimensions. A new
    // measurement date deliberately returns the order to measurement pending.
    if (dateChanged || sale.measurement_status !== 'confirmed') {
      const after = { ...metadata(sale), measurement_date: `${input.date}T00:00:00.000Z`, measurement_status: 'scheduled', measurement_master: staff?.name || '', measurement_revision: (sale.measurement_revision || 0) + 1 };
      Object.assign(set, { measurement_date: new Date(after.measurement_date), measurement_status: after.measurement_status, measurement_master: after.measurement_master });
      inc.measurement_revision = 1;
      push.measurement_history = { kind: 'plan', revision: after.measurement_revision, request_id: input.request_id, changed_at: now, changed_by: actor._id, before: metadata(sale), after };
    }
  } else {
    set.delivery_date = new Date(`${input.date}T00:00:00.000Z`);
    if (sale.pos_details?.header) set['pos_details.header.delivery_date'] = input.date;
  }
  return { existing: false, set, inc, push, visit: target, event: { request_id: input.request_id, fingerprint, at: now, by: String(actor._id), name: actor.name, before: prior ? { date: prior.date, assigned_to: prior.assigned_to, note: prior.note } : { date: input.expected_date, assigned_to: null, note: '' }, after: target } };
}
export function visitCards(sales, plans, staff, actor, orders = []) {
  const admin = actor.kind === 'admin', people = new Map(staff.map(person => [String(person._id), person]));
  return sales.flatMap(sale => Object.keys(VISIT_KINDS).flatMap(kind => {
    const plan = plans.find(item => String(item.sale) === String(sale._id) && item.kind === kind);
    if (!activeStatuses.includes(sale.status) || kind !== 'measurement' && (sale.status !== 'tamamlandi' || method(sale) !== kind)) return [];
    if (!admin && (kind === 'store' || !plan || String(plan.assigned_to || '') !== String(actor._id))) return [];
    const date = dateOf(sale, kind), order = orders.find(item => String(item.sale) === String(sale._id));
    const completed = kind === 'measurement' && sale.measurement_status === 'confirmed' || kind === 'installation' && !!order?.jobs.length && order.jobs.every(job => job.stage === 'installed');
    if (completed && !plan) return [];
    const person = plan?.assigned_to && people.get(String(plan.assigned_to));
    const warnings = [];
    if (!date) warnings.push('Termin tarihi belirlenmedi.');
    if (kind !== 'store' && !person) warnings.push('Sorumlu personel atanmadı.');
    if (person && !person.active) warnings.push('Atanan personelin giriş izni kapalı.');
    if (kind === 'installation') {
      if (sale.measurement_status !== 'confirmed') warnings.push('Kesin ölçü bekleniyor.');
      if (!order) warnings.push('Üretim takibi bulunmuyor; ürünlerin hazırlığını kontrol edin.');
      else if (order.jobs.some(job => job.supply !== 'received' || !['ready', 'installation', 'installed'].includes(job.stage))) warnings.push('Üretim / tedarikte tamamlanmamış kalem var.');
    }
    const result = { key: `${sale._id}-${kind}`, sale_id: String(sale._id), kind, date, customer_name: sale.customer_name || 'Müşteri', assigned_to: plan?.assigned_to ? String(plan.assigned_to) : '', assigned_name: person?.name || '', note: plan?.note || '', completed, revision: plan?.revision ?? -1, measurement_revision: sale.measurement_revision || 0, sale_status: sale.status, warnings, explicit_plan: !!plan, changed_elsewhere: !!plan && plan.date !== date };
    // Staff get only their assigned visits, never other customer contacts, prices,
    // payments, POS links or the contents of the financial / general sale notes.
    if (admin) { result.customer_phone = sale.customer_phone || ''; result.customer_address = sale.customer_address || ''; result.history = plan?.history.map(event => ({ at: event.at, name: event.name, before: event.before, after: event.after })) || []; }
    return [result];
  })).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.kind.localeCompare(b.kind) || a.customer_name.localeCompare(b.customer_name, 'tr'));
}
const fields = 'customer_name customer_phone customer_address status delivery_date delivery_method measurement_date measurement_status measurement_revision measurement_history measurement_source measurement_master measurement_note production_guard pos_details.header.delivery_date';
function fail(res, error) { return res.status(error instanceof VisitError ? error.status : error?.code === 11000 ? 409 : 500).json({ message: error instanceof VisitError ? error.message : error?.code === 11000 ? 'Randevu aynı anda başka bir ekranda kaydedildi. Planı yenileyin.' : 'Günlük plan işlemi tamamlanamadı. Yenileyip kayıt durumunu kontrol edin.' }); }
export async function getVisitPlan(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    if (Object.keys(req.query).length) throw new VisitError('Plan sorgusu geçersiz.');
    const admin = req.productionActor.kind === 'admin';
    if (!admin && !req.productionActor.duties.includes('installation')) return res.json({ today: visitToday(), cards: [], staff: [], truncated: false });
    const plans = await VisitPlan.find(admin ? {} : { assigned_to: req.productionActor._id, kind: { $in: ['measurement', 'installation'] } }).sort({ date: 1 }).limit(2001).lean();
    const query = { status: { $in: activeStatuses }, ...(!admin ? { _id: { $in: plans.map(plan => plan.sale) } } : {}) };
    const sales = await Sale.find(query).select(fields).sort({ createdAt: -1 }).limit(2001).lean();
    const people = await Staff.find(admin ? {} : { _id: req.productionActor._id }).select('name active duties').lean();
    const orders = await ProductionOrder.find({ sale: { $in: sales.map(sale => sale._id) } }).select('sale jobs.supply jobs.stage').lean();
    return res.json({ today: visitToday(), cards: visitCards(sales.slice(0, 2000), plans.slice(0, 2000), people, req.productionActor, orders), staff: admin ? people.map(person => ({ id: String(person._id), name: person.name, active: person.active, duties: person.duties })) : [], truncated: plans.length > 2000 || sales.length > 2000 });
  } catch (error) { return fail(res, error); }
}
export async function saveVisitPlan(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!oid(req.params.saleId)) throw new VisitError('Sipariş bulunamadı.', 404);
    const input = visitInput(req.body);
    await VisitPlan.init();
    await mongoose.connection.transaction(async session => {
      const sale = await Sale.findById(req.params.saleId).select(fields).session(session).lean();
      if (!sale) throw new VisitError('Sipariş bulunamadı.', 404);
      const prior = await VisitPlan.findOne({ sale: sale._id, kind: input.kind }).session(session).lean();
      const person = input.assigned_to ? await Staff.findById(input.assigned_to).select('name active duties').session(session).lean() : null;
      const plan = visitChange(sale, prior, input, req.productionActor, person);
      if (plan.existing) return;
      // Guard the same Sale document used by cancellation, delivery and geometry
      // edits. Dates/assignments never touch prices, stock, payments or report time.
      const written = await Sale.updateOne({ _id: sale._id, status: sale.status, measurement_revision: sale.measurement_revision ?? { $in: [null, 0] } }, { ...(Object.keys(plan.set).length ? { $set: plan.set } : {}), $inc: plan.inc, ...(Object.keys(plan.push).length ? { $push: plan.push } : {}) }, { session, runValidators: true, timestamps: false });
      if (written.modifiedCount !== 1) throw new VisitError('Sipariş aynı anda değişti. Planı yenileyin.', 409);
      if (prior) {
        const saved = await VisitPlan.updateOne({ _id: prior._id, revision: prior.revision }, { $set: plan.visit, $inc: { revision: 1 }, $push: { history: plan.event } }, { session, runValidators: true });
        if (saved.modifiedCount !== 1) throw new VisitError('Randevu aynı anda değişti. Planı yenileyin.', 409);
      } else await VisitPlan.create([{ sale: sale._id, kind: input.kind, ...plan.visit, revision: 0, history: [plan.event] }], { session });
    });
    return res.json({ saved: true, sale_id: req.params.saleId, kind: input.kind });
  } catch (error) { return fail(res, error); }
}
