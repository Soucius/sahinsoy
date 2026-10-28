import mongoose from 'mongoose';
import express from 'express';
import protect from '../middlewares/auth.middleware.js';
import Sale, { withArchivedSales } from '../models/Sale.js';
import Staff from '../models/ProductionStaff.js';
import { isProductionAdmin } from './productionAccess.js';
import { ledgerMinor, ledgerNameKey, LedgerInputError } from './accountLedger.js';
import { OfficeError, officeToday, officeHash, officeId, officeObject, officeOperation, officeDate, officeText, personInput, sewingMeter, priceSewing, officeEntry, officeReverse, paymentKey, cashReceipts, officeSummary } from './cashPersonnelRules.js';

const oid = mongoose.Schema.Types.ObjectId, mixed = mongoose.Schema.Types.Mixed;
const officeSchema = new mongoose.Schema({ _id: String, operation: String, fingerprint: String, start_date: String, activated_at: Date, openings: { cash: { type: String, default: null }, bank: { type: String, default: null }, pos: { type: String, default: '0' } }, excluded_payment_keys: [String], revision: { type: Number, default: 0 }, created_by: oid, opening_history: [mixed] });
const personSchema = new mongoose.Schema({ operation: { type: String, unique: true }, fingerprint: String, name: String, name_key: { type: String, unique: true }, kind: { type: String, enum: ['salary', 'piece'] }, staff_id: { type: oid, default: null }, monthly_minor: { type: String, default: null }, rates: [{ _id: false, key: String, minor: String }], revision: { type: Number, default: 0 }, history: [mixed] }, { timestamps: true });
personSchema.index({ staff_id: 1 }, { unique: true, partialFilterExpression: { staff_id: { $type: 'objectId' } } });
const eventSchema = new mongoose.Schema({ operation: { type: String, required: true, unique: true }, fingerprint: String, request_fingerprint: String, source_key: { type: String }, date: String, type: String, description: String, cash: { cash: { type: String, default: '0' }, bank: { type: String, default: '0' }, pos: { type: String, default: '0' } }, person: { type: oid, default: null }, person_delta_minor: { type: String, default: '0' }, amount_minor: String, payment_kind: String, period: String, reverses: String, reversed_type: String, sewing: mixed, recorded_by: oid, recorded_name: String }, { timestamps: true });
eventSchema.index({ source_key: 1 }, { unique: true, sparse: true }); eventSchema.index({ reverses: 1 }, { unique: true, sparse: true });
const workSchema = new mongoose.Schema({ source_key: { type: String, unique: true }, person: oid, sale: oid, production_order: oid, line_id: String, customer_name: String, product_name: String, room_name: String, meter_units: { type: Number, default: null }, rate_key: String, reason: String, completed_date: String, measurement_revision: Number, journal: { type: oid, default: null } }, { timestamps: true });
export const CashOffice = mongoose.models.CashOffice || mongoose.model('CashOffice', officeSchema);
export const PayPerson = mongoose.models.PayPerson || mongoose.model('PayPerson', personSchema);
export const OfficeEntry = mongoose.models.OfficeEntry || mongoose.model('OfficeEntry', eventSchema);
export const SewingWork = mongoose.models.SewingWork || mongoose.model('SewingWork', workSchema);
let officeActive = false;
export async function startCashOffice() { await Promise.all([CashOffice.init(), PayPerson.init(), OfficeEntry.init(), SewingWork.init()]); officeActive = !!await CashOffice.exists({ _id: 'store' }); }
const inTransaction = fn => mongoose.connection.transaction(fn);
async function lockOffice(session) {
  const office = await CashOffice.findOneAndUpdate({ _id: 'store' }, { $inc: { revision: 1 } }, { new: true, session }).lean();
  if (!office) throw new OfficeError('Önce kasa başlangıcını kaydedin.', 409); return office;
}
const actorFields = actor => ({ recorded_by: actor._id, recorded_name: actor.name || actor.user_username || '' });
async function appendEntry(data, actor, session) {
  const prior = data.source_key ? await OfficeEntry.findOne({ source_key: data.source_key }).session(session).lean() : null;
  if (prior) return prior;
  if (await OfficeEntry.countDocuments().session(session) >= 10000) throw new OfficeError('Kasa hareket sınırına ulaşıldı. Yeni dönem düzenlemesi gerekiyor.', 409);
  const [entry] = await OfficeEntry.create([{ ...data, ...actorFields(actor) }], { session }); return entry;
}
export async function postSewingPrice(work, person, actor, session) {
  if (work.journal) return;
  const price = priceSewing(work, person); if (!price) return;
  const source_key = `sewing:${work.source_key}`;
  const data = { operation: source_key, source_key, date: work.completed_date, type: 'sewing', description: `${work.customer_name} · ${work.product_name} · ${work.room_name || 'Oda belirtilmedi'}`, cash: { cash: '0', bank: '0', pos: '0' }, person: person._id, person_delta_minor: price.amount_minor, amount_minor: price.amount_minor, sewing: { meter_units: work.meter_units, rate_minor: price.rate_minor, rate_key: work.rate_key, sale_id: String(work.sale), line_id: work.line_id } };
  data.fingerprint = officeHash(data); const entry = await appendEntry(data, actor, session);
  await SewingWork.updateOne({ _id: work._id, journal: null }, { $set: { journal: entry._id, reason: '' } }, { session });
}
export async function captureSewingWork(record, sale, oldJob, newJob, actor, session) {
  if (!officeActive || oldJob.stage === 'sewn' || newJob.stage !== 'sewn' || newJob.snapshot.kind !== 'textile' || !newJob.sewing) return;
  const office = await lockOffice(session), person = await PayPerson.findOne({ staff_id: newJob.sewing, kind: 'piece' }).session(session).lean();
  if (!person) return;
  const source_key = `${record._id}:${newJob.line_id}`;
  // A repeat completion or a later measurement revision never pays the same line twice.
  if (await SewingWork.exists({ source_key }).session(session)) return;
  const meter = sewingMeter(sale, newJob), [work] = await SewingWork.create([{ source_key, person: person._id, sale: sale._id, production_order: record._id, line_id: newJob.line_id, customer_name: sale.customer_name, product_name: newJob.snapshot.product_name, room_name: newJob.snapshot.room_name, ...meter, completed_date: officeToday(), measurement_revision: sale.measurement_revision || 0 }], { session });
  if (work.completed_date < office.start_date) throw new OfficeError('Dikim tarihi kasa başlangıcından önce.', 409);
  await postSewingPrice(work, person, actor, session);
}
async function pricePending(person, actor, session) {
  const works = await SewingWork.find({ person: person._id, journal: null }).limit(1000).session(session).lean();
  for (const work of works) if (await Sale.exists({ _id: work.sale }).session(session)) await postSewingPrice(work, person, actor, session);
}
const fail = (res, error) => res.status(error instanceof OfficeError || error instanceof LedgerInputError ? error.status || 400 : error?.code === 11000 ? 409 : 500).json({ message: error instanceof OfficeError || error instanceof LedgerInputError ? error.message : error?.code === 11000 ? 'Bu kayıt zaten var veya aynı anda kaydedildi. Ekranı yenileyin.' : 'Kasa / personel kaydı doğrulanamadı. Listeyi yenileyip kontrol edin.' });
export const cashPersonnelRouter = express.Router();
cashPersonnelRouter.use(protect, (req, res, next) => isProductionAdmin(req.user) ? next() : res.status(403).json({ message: 'Kasa ve personel hesapları yalnız mağaza yöneticisine açıktır.' }));
cashPersonnelRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
cashPersonnelRouter.get('/', async (req, res) => {
  try {
    if (Object.keys(req.query).some(key => key !== 'date')) throw new OfficeError('Kasa sorgusu geçersiz.');
    const selectedDate = req.query.date === undefined ? officeToday() : officeDate(req.query.date);
    const config = await CashOffice.findById('store').lean(), people = await PayPerson.find().sort({ name: 1 }).lean(), staff = await Staff.find({}).select('name active duties').sort({ name: 1 }).lean();
    if (!config) return res.json({ configured: false, today: officeToday(), people: [], staff });
    const entries = await OfficeEntry.find().sort({ createdAt: -1 }).limit(10001).lean();
    const sales = await Sale.find({ 'payments.paid_date': { $gte: config.start_date } }).select('customer_name payments').limit(2001).lean();
    const receipts = cashReceipts(sales.slice(0, 2000), config), pending = await SewingWork.find({ journal: null }).sort({ createdAt: -1 }).limit(501).lean();
    const summary = officeSummary(entries, receipts, config, people), incomplete = sales.length > 2000 || entries.length > 10000;
    if (incomplete) for (const account of Object.values(summary.accounts)) account.balance_minor = null;
    const all = [...entries, ...receipts].sort((a, b) => b.date.localeCompare(a.date) || String(b._id).localeCompare(String(a._id))), dailyRows = all.filter(row => row.date === selectedDate);
    let incoming = 0n, outgoing = 0n;
    for (const row of dailyRows) { const delta = Object.values(row.cash).reduce((sum, value) => sum + BigInt(value), 0n); if (delta > 0n) incoming += delta; else outgoing -= delta; }
    res.json({ configured: true, today: officeToday(), config: { start_date: config.start_date, openings: config.openings }, people, staff, summary, entries: all.slice(0, 500), day_entries: dailyRows.slice(0, 500), daily: incomplete ? null : { incoming_minor: String(incoming), outgoing_minor: String(outgoing), net_minor: String(incoming - outgoing) }, list_truncated: all.length > 500 || dailyRows.length > 500, incomplete, pending: pending.slice(0, 500), pending_truncated: pending.length > 500 });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/setup', async (req, res) => {
  try {
    officeObject(req.body, ['operation_id', 'start_date', 'cash', 'bank', 'pos']);
    const operation = officeOperation(req.body.operation_id), start = officeDate(req.body.start_date), openings = Object.fromEntries(['cash', 'bank', 'pos'].map(key => [key, req.body[key] === '' ? null : ledgerMinor(req.body[key], true)])), fingerprint = officeHash({ start, openings });
    await inTransaction(async session => {
      const prior = await CashOffice.findById('store').session(session).lean();
      if (prior) { if (prior.operation !== operation || prior.fingerprint !== fingerprint) throw new OfficeError('Kasa başlangıcı zaten kaydedildi.', 409); return; }
      const old = await withArchivedSales(Sale.find()).select('payments.request_id').limit(2001).session(session).lean();
      if (old.length > 2000) throw new OfficeError('Eski tahsilat kapsamı başlangıçtan önce kontrol edilmeli.', 409);
      const excluded = old.flatMap(sale => (sale.payments || []).map(payment => paymentKey(sale._id, payment)));
      if (excluded.length > 20000) throw new OfficeError('Eski tahsilat sayısı başlangıç sınırını aşıyor.', 409);
      const staff = await Staff.find().select('name').session(session).lean();
      await CashOffice.create([{ _id: 'store', operation, fingerprint, start_date: start, activated_at: new Date(), openings, excluded_payment_keys: excluded, created_by: req.user._id, revision: 0, opening_history: [] }], { session });
      for (const [name, kind] of [['Nurten', 'piece'], ['Hayati', 'piece'], ['Nevzat', 'salary'], ['Zeki', 'salary'], ['Ahmet', 'salary'], ['Mesut', 'salary'], ['Salih', 'salary']]) {
        const matches = staff.filter(person => ledgerNameKey(person.name).split(' ')[0] === ledgerNameKey(name));
        await PayPerson.create([{ operation: `initial:${name}`, fingerprint: operation, name, name_key: ledgerNameKey(name), kind, staff_id: matches.length === 1 ? matches[0]._id : null, monthly_minor: null, rates: [], revision: 0, history: [{ at: new Date(), by: req.user.user_username, action: 'Kasa başlangıcında oluşturuldu' }] }], { session });
      }
    }); officeActive = true; res.json({ configured: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/opening', async (req, res) => {
  try {
    officeObject(req.body, ['account', 'amount']); if (!['cash', 'bank', 'pos'].includes(req.body.account)) throw new OfficeError('Hesap seçin.'); const amount = ledgerMinor(req.body.amount, true);
    await inTransaction(async session => { const config = await lockOffice(session), key = req.body.account; if (config.openings[key] !== null) { if (config.openings[key] === amount) return; throw new OfficeError('Açılış daha önce belirlendi; farkı açıklamalı kasa düzeltmesiyle kaydedin.', 409); } await CashOffice.updateOne({ _id: 'store' }, { $set: { [`openings.${key}`]: amount }, $push: { opening_history: { at: new Date(), by: req.user.user_username, account: key, amount } } }, { session }); }); res.json({ saved: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/people', async (req, res) => {
  try {
    const operation = officeOperation(req.body.operation_id), normalized = personInput(req.body), fingerprint = officeHash(normalized);
    await inTransaction(async session => { await lockOffice(session); const prior = await PayPerson.findOne({ operation }).session(session).lean(); if (prior) { if (prior.fingerprint !== fingerprint) throw new OfficeError('İşlem kimliği farklı bilgilerle kullanıldı.', 409); return; } if (await PayPerson.countDocuments().session(session) >= 200) throw new OfficeError('Personel hesap sınırına ulaşıldı.'); if (normalized.staff_id && !await Staff.exists({ _id: normalized.staff_id }).session(session)) throw new OfficeError('Üretim personeli bulunamadı.'); await PayPerson.create([{ ...normalized, operation, fingerprint, history: [{ at: new Date(), by: req.user.user_username, after: normalized }] }], { session }); }); res.json({ saved: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.put('/people/:id', async (req, res) => {
  try {
    if (!officeId(req.params.id)) throw new OfficeError('Personel numarası geçersiz.');
    await inTransaction(async session => { await lockOffice(session); const person = await PayPerson.findById(req.params.id).session(session).lean(); if (!person) throw new OfficeError('Personel bulunamadı.', 404); const normalized = personInput(req.body, person); if (req.body.expected_revision !== person.revision) throw new OfficeError('Personel bilgisi değişti. Yenileyin.', 409); if (normalized.staff_id && !await Staff.exists({ _id: normalized.staff_id }).session(session)) throw new OfficeError('Üretim personeli bulunamadı.'); const updated = await PayPerson.findOneAndUpdate({ _id: person._id, revision: person.revision }, { $set: normalized, $inc: { revision: 1 }, $push: { history: { at: new Date(), by: req.user.user_username, before: { name: person.name, monthly_minor: person.monthly_minor, rates: person.rates, staff_id: person.staff_id }, after: normalized } } }, { new: true, session }).lean(); if (!updated) throw new OfficeError('Personel aynı anda değişti.', 409); await pricePending(updated, req.user, session); }); res.json({ saved: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/entries', async (req, res) => {
  try {
    const operation = officeOperation(req.body.operation_id), request_fingerprint = officeHash(req.body);
    await inTransaction(async session => { const config = await lockOffice(session), prior = await OfficeEntry.findOne({ operation }).session(session).lean(); if (prior) { if (prior.request_fingerprint !== request_fingerprint) throw new OfficeError('Aynı işlem kimliği farklı bilgilerle kullanıldı.', 409); return; } const person = req.body.person_id && officeId(req.body.person_id) ? await PayPerson.findById(req.body.person_id).session(session).lean() : null; const entry = officeEntry(req.body, config, person); if (entry.source_key && await OfficeEntry.exists({ source_key: entry.source_key }).session(session)) throw new OfficeError('Bu ayın maaşı zaten işlendi. Ek fark için ayrı hakediş kaydı girin.', 409); await appendEntry({ ...entry, request_fingerprint }, req.user, session); }); res.json({ saved: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/entries/:id/reverse', async (req, res) => {
  try {
    if (!officeId(req.params.id)) throw new OfficeError('Yalnız kasa defterindeki manuel / hakediş kayıtları bu ekrandan düzeltilir.');
    const operation = officeOperation(req.body.operation_id), request_fingerprint = officeHash({ target: req.params.id, ...req.body });
    await inTransaction(async session => { await lockOffice(session); const prior = await OfficeEntry.findOne({ operation }).session(session).lean(); if (prior) { if (prior.request_fingerprint !== request_fingerprint) throw new OfficeError('İşlem kimliği farklı kullanıldı.', 409); return; } const entry = await OfficeEntry.findById(req.params.id).session(session).lean(); if (!entry) throw new OfficeError('Kasa kaydı bulunamadı.', 404); if (await OfficeEntry.exists({ reverses: String(entry._id) }).session(session)) throw new OfficeError('Bu kayıt zaten düzeltildi.', 409); await appendEntry({ ...officeReverse(entry, req.body), request_fingerprint }, req.user, session); }); res.json({ saved: true });
  } catch (error) { fail(res, error); }
});
cashPersonnelRouter.post('/reconcile', async (req, res) => { try { officeObject(req.body, []); await inTransaction(async session => { await lockOffice(session); const people = await PayPerson.find({ kind: 'piece' }).session(session).lean(); for (const person of people) await pricePending(person, req.user, session); }); res.json({ saved: true }); } catch (error) { fail(res, error); } });
