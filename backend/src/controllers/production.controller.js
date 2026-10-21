import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Sale from '../models/Sale.js';
import ProductionStaff from '../models/ProductionStaff.js';
import ProductionOrder from '../models/ProductionOrder.js';
import { ENV } from '../libs/env.js';
import { STAFF_PRESETS, DUTIES } from '../libs/productionAccess.js';
import { ProductionError, productionLines, fingerprint, visibleOrder, applyJobChange, stageChoices, notificationDraft } from '../libs/productionWorkflow.js';
const populate = query => query.populate({ path: 'sale_items.product', select: 'product_name product_category product_brand', populate: [{ path: 'product_category', select: 'category_name' }, { path: 'product_brand', select: 'brand_name' }] });
const saleFields = 'sale_items pos_details customer_name customer_phone delivery_date delivery_method status measurement_revision measurement_status production_guard';
const id = value => { if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new ProductionError('Kayıt numarası geçersiz.'); return value; };
const bodyKeys = (body, allowed) => { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw new ProductionError('Gönderilen alanları kontrol edin.'); };
const revision = body => { if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new ProductionError('Ekranı yenileyip tekrar deneyin.', 409); };
const fail = (res, error) => res.status(error instanceof ProductionError ? error.status : error.code === 11000 ? 409 : 500).json({ message: error instanceof ProductionError ? error.message : error.code === 11000 ? 'Bu kayıt zaten var. Ekranı yenileyin.' : 'Üretim işlemi tamamlanamadı. Tekrar deneyin.' });
const publicStaff = staff => ({ _id: String(staff._id), name: staff.name, username: staff.username, duties: staff.duties, active: staff.active, session_version: staff.session_version, access_history: staff.access_history });
const attempts = new Map();
export async function staffLogin(req, res) {
  try {
    bodyKeys(req.body, ['username', 'password']);
    const key = `${req.ip}:${String(req.body.username || '').toLowerCase().slice(0, 40)}`;
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const limit = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (limit.count >= 10) return res.status(429).json({ message: 'Çok sayıda giriş denemesi yapıldı. 15 dakika sonra deneyin.' });
    limit.count++; attempts.set(key, limit);
    const { username, password } = req.body;
    if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/i.test(username) || typeof password !== 'string' || Buffer.byteLength(password) > 72) throw new ProductionError('Kullanıcı adı veya parola yanlış.', 401);
    const staff = await ProductionStaff.findOne({ username: username.toLowerCase(), active: true }).select('+password_hash');
    if (!staff || !await bcrypt.compare(password, staff.password_hash)) throw new ProductionError('Kullanıcı adı veya parola yanlış.', 401);
    attempts.delete(key);
    const token = jwt.sign({ id: String(staff._id), scope: 'production', version: staff.session_version }, ENV.JWT_SECRET, { audience: 'sahinsoy-production', expiresIn: '12h' });
    res.json({ token, staff: { name: staff.name, duties: staff.duties } });
  } catch (error) { fail(res, error); }
}
export function productionMe(req, res) { res.json(req.productionActor); }
export async function getStaff(req, res) {
  try { res.json({ staff: (await ProductionStaff.find().sort({ name: 1 }).lean()).map(publicStaff), presets: STAFF_PRESETS }); }
  catch (error) { fail(res, error); }
}
function staffInput(body, creating) {
  bodyKeys(body, ['name', 'username', 'password', 'duties', 'active', 'expected_version']);
  const data = {};
  for (const key of ['name', 'username']) if (creating || body[key] !== undefined) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > (key === 'name' ? 80 : 40)) throw new ProductionError('Ad ve kullanıcı adını kontrol edin.');
    data[key] = body[key].trim();
  }
  if (data.username) { data.username = data.username.toLowerCase(); if (!/^[a-z0-9._-]{3,40}$/.test(data.username)) throw new ProductionError('Kullanıcı adı 3–40 harf/rakam olmalı; Türkçe karakter veya boşluk içermemeli.'); }
  if (creating || body.duties !== undefined) {
    if (!Array.isArray(body.duties) || !body.duties.length || body.duties.some(d => !DUTIES[d]) || new Set(body.duties).size !== body.duties.length) throw new ProductionError('En az bir görev seçin.');
    data.duties = body.duties;
  }
  if (body.active !== undefined) { if (typeof body.active !== 'boolean') throw new ProductionError('Giriş izni geçersiz.'); data.active = body.active; }
  if (creating || body.password) {
    if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password) > 72) throw new ProductionError('Parola en az 12 karakter, en fazla 72 bayt olmalı.');
    data.password = body.password;
  }
  return data;
}
export async function createStaff(req, res) {
  try {
    const data = staffInput(req.body, true);
    data.password_hash = await bcrypt.hash(data.password, 12); delete data.password;
    const staff = await ProductionStaff.create({ ...data, created_by: req.productionActor._id, access_history: [{ at: new Date(), by: req.productionActor.name, action: 'Personel hesabı oluşturuldu' }] });
    res.status(201).json(publicStaff(staff));
  } catch (error) { fail(res, error); }
}
export async function updateStaff(req, res) {
  try {
    const data = staffInput(req.body, false);
    if (!Number.isSafeInteger(req.body.expected_version)) throw new ProductionError('Personel ekranını yenileyin.', 409);
    const passwordReset = Boolean(data.password);
    if (data.password) { data.password_hash = await bcrypt.hash(data.password, 12); delete data.password; }
    const staff = await ProductionStaff.findOneAndUpdate({ _id: id(req.params.id), session_version: req.body.expected_version }, {
      $set: data, $inc: { session_version: 1 }, $push: { access_history: { at: new Date(), by: req.productionActor.name, action: `Giriş / görev izinleri güncellendi${passwordReset ? '; parola yenilendi' : ''}` } },
    }, { new: true, runValidators: true });
    if (!staff) throw new ProductionError('Personel bilgileri değişmiş. Ekranı yenileyin.', 409);
    res.json(publicStaff(staff));
  } catch (error) { fail(res, error); }
}
function present(record, sale, actor) {
  const result = visibleOrder(record, sale, actor);
  if (!result) return null;
  result.jobs = result.jobs.map(job => ({ ...job, next_stages: result.needs_refresh ? [] : stageChoices(job, actor, sale) }));
  if (actor.kind === 'admin') { result.customer_phone = sale.customer_phone; result.message_draft = notificationDraft(sale, record); }
  return result;
}
export async function getProductionOrders(req, res) {
  try {
    const actor = req.productionActor;
    const filter = actor.kind === 'admin' ? {} : { $or: actor.duties.map(duty => ({ [`jobs.${duty}`]: actor._id })) };
    const records = await ProductionOrder.find(filter).sort({ updatedAt: -1 }).lean();
    const sales = await populate(Sale.find({ _id: { $in: records.map(r => r.sale) } }).select(saleFields)).lean();
    const byId = new Map(sales.map(s => [String(s._id), s]));
    res.json(records.flatMap(r => { const sale = byId.get(String(r.sale)); const out = sale && present(r, sale, actor); return out ? [out] : []; }));
  } catch (error) { fail(res, error); }
}
export async function getCandidates(req, res) {
  try {
    const existing = await ProductionOrder.find().select('sale').lean();
    const sales = await Sale.find({ status: 'tamamlandi', _id: { $nin: existing.map(r => r.sale) } }).select('customer_name delivery_date measurement_status sale_items._id').sort({ createdAt: -1 }).lean();
    res.json(sales.map(s => ({ _id: s._id, customer_name: s.customer_name, delivery_date: s.delivery_date, measurement_status: s.measurement_status, item_count: s.sale_items.length })));
  } catch (error) { fail(res, error); }
}
const audit = (actor, action, line_id = '', before = null, after = null) => ({ at: new Date(), actor_id: actor._id, actor_name: actor.name, actor_kind: actor.kind, action, line_id, before, after });
async function transaction(work) {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; }
  finally { await session.endSession(); }
}
async function lockedSale(saleId, session) {
  const sale = await populate(Sale.findById(saleId).select(saleFields).session(session)).lean();
  if (!sale || sale.status !== 'tamamlandi') throw new ProductionError('Yalnız onaylanan, henüz teslim edilmemiş siparişlerde işlem yapılabilir.', 409);
  // Lock the sale document without changing its financial report / approval fallback date.
  await Sale.updateOne({ _id: sale._id }, { $inc: { production_guard: 1 } }, { session, timestamps: false });
  return sale;
}
export async function createProductionOrder(req, res) {
  try {
    bodyKeys(req.body, ['sale_id']);
    const saleId = id(req.body.sale_id);
    const result = await transaction(async session => {
      const sale = await lockedSale(saleId, session);
      const existing = await ProductionOrder.findOne({ sale: saleId }).session(session).lean();
      if (existing) return present(existing, sale, req.productionActor);
      const lines = productionLines(sale);
      if (!lines.length) throw new ProductionError('Siparişin ürün satırı yok.');
      const [record] = await ProductionOrder.create([{ sale: saleId, source_fingerprint: fingerprint(sale), jobs: lines, history: [audit(req.productionActor, 'Üretim takibine aktarıldı')] }], { session });
      return present(record.toObject(), sale, req.productionActor);
    });
    res.status(201).json(result);
  } catch (error) { fail(res, error); }
}
export async function refreshProductionOrder(req, res) {
  try {
    bodyKeys(req.body, ['expected_revision']); revision(req.body);
    const result = await transaction(async session => {
      const record = await ProductionOrder.findById(id(req.params.id)).session(session).lean();
      if (!record) throw new ProductionError('Üretim kaydı bulunamadı.', 404);
      const sale = await lockedSale(record.sale, session);
      const jobs = productionLines(sale).map(line => {
        const old = record.jobs.find(j => j.line_id === line.line_id);
        if (!old) return line;
        return { ...old, snapshot: line.snapshot, stage: JSON.stringify(old.snapshot) === JSON.stringify(line.snapshot) ? old.stage : 'waiting' };
      });
      const updated = await ProductionOrder.findOneAndUpdate({ _id: record._id, revision: req.body.expected_revision }, { $set: { jobs, source_fingerprint: fingerprint(sale) }, $inc: { revision: 1 }, $push: { history: audit(req.productionActor, 'Güncel ölçü ve ürünler alındı; değişen satırlar üretim beklemeye döndü', '', { jobs: record.jobs }, { jobs }) } }, { new: true, session, runValidators: true }).lean();
      if (!updated) throw new ProductionError('Başka biri bu kaydı değiştirdi. Yenileyin.', 409);
      return present(updated, sale, req.productionActor);
    });
    res.json(result);
  } catch (error) { fail(res, error); }
}
export async function updateProductionJob(req, res) {
  try {
    bodyKeys(req.body, ['expected_revision', 'changes']); revision(req.body);
    const result = await transaction(async session => {
      const record = await ProductionOrder.findById(id(req.params.id)).session(session).lean();
      if (!record) throw new ProductionError('Üretim kaydı bulunamadı.', 404);
      const sale = await lockedSale(record.sale, session);
      if (record.source_fingerprint !== fingerprint(sale)) throw new ProductionError('Sipariş ölçüleri veya ürünleri değişti. Yönetici üretim kaydını güncellemeli.', 409);
      const job = record.jobs.find(j => j.line_id === id(req.params.lineId));
      if (!job) throw new ProductionError('İş satırı bulunamadı.', 404);
      const patch = applyJobChange(job, req.body.changes, req.productionActor, sale);
      for (const duty of ['cutting', 'sewing', 'installation']) if (patch[duty]) {
        const staff = await ProductionStaff.findOne({ _id: patch[duty], active: true, duties: duty }).session(session).lean();
        if (!staff) throw new ProductionError('Seçilen personelin giriş izni veya bu görev yetkisi yok.', 409);
      }
      const before = Object.fromEntries(Object.keys(patch).map(k => [k, job[k]]));
      const jobs = record.jobs.map(j => j.line_id === job.line_id ? { ...j, ...patch } : j);
      const updated = await ProductionOrder.findOneAndUpdate({ _id: record._id, revision: req.body.expected_revision }, { $set: { jobs }, $inc: { revision: 1 }, $push: { history: audit(req.productionActor, 'İş güncellendi', job.line_id, before, patch) } }, { new: true, session, runValidators: true }).lean();
      if (!updated) throw new ProductionError('Başka biri bu kaydı değiştirdi. Yenileyin.', 409);
      return present(updated, sale, req.productionActor);
    });
    res.json(result);
  } catch (error) { fail(res, error); }
}
