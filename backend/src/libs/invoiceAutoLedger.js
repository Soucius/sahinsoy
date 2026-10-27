import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import LedgerAccount from '../models/LedgerAccount.js';
import User from '../models/User.js';
import { isProductionAdmin } from './productionAccess.js';
import { ledgerMovement, LedgerInputError } from './accountLedger.js';
import { listInboxInvoices, uyumsoftConfig } from './uyumsoftInvoices.js';

const STATE_ID = 'uyumsoft-auto-ledger';
const INTERVAL = 15 * 60 * 1000;
const today = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(now || new Date());
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const fold = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[ıIİ]/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = [
  [['OBA', 'OBA Perdesan'], 'OBA PERDESAN TEKNİK TEKSTİL ANONİM ŞİRKETİ'],
  [['DMR', 'DMR Line'], 'DEMİR DMR TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ'],
  [['Lilium', 'Ustaoğlu'], 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.'],
  [['Sebahattin Akyıldız', 'Vicenta Home'], 'SEBAHATTİN AKYILDIZ TEKSTİL KONFEKSİYON GIDA MOBİLYA TURİZM İNŞAAT TAAHHÜT NAKLİYAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ'],
  [['Storlife'], 'STORLİFE PERDE SİSTEMLERİ SAN.VE TİC. LTD. ŞTİ.'],
  [['Yurtiçi Kargo'], 'Yurtiçi Kargo Servisi A.Ş.'],
  [['CK Boğaziçi Elektrik'], 'CK BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ ANONİM ŞİRKETİ'],
  [['Turkcell'], 'Turkcell Iletisim Hizmetleri A.S.'],
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const invoiceDocumentKey = invoice => hash([invoice.supplier_identifier, invoice.number]);
export const invoiceFingerprint = invoice => hash([invoice.id, invoice.number, invoice.supplier_identifier, invoice.date, invoice.currency, invoice.amount, invoice.tax, invoice.tax_exclusive, invoice.type]);
export function invoiceOperation(id) { const h = hash(['uyumsoft-invoice', id]); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }
export function invoiceAutoPlan(invoice, account, startsOn, actor, now = new Date()) {
  if (!validDate(startsOn) || !validDate(invoice.date) || invoice.date < startsOn) throw new LedgerInputError('Aktarım başlangıç tarihinden önce; açılış bakiyesinde tutulur.');
  if (invoice.date > today(now)) throw new LedgerInputError('İleri tarihli fatura beklemede.');
  if (invoice.status !== 'Approved') throw new LedgerInputError('Belge henüz onaylı değil veya iptal/ret durumunda; inceleme gerekiyor.');
  if (invoice.type !== 'Sales') throw new LedgerInputError('İade, tevkifat veya farklı belge türü; inceleme gerekiyor.');
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(invoice.id || '') || !/^\d{10,11}$/.test(invoice.supplier_identifier || '') || !invoice.number || invoice.number.length > 100) throw new LedgerInputError('Fatura kimliği doğrulanamadı.');
  if (!['TRY', 'EUR', 'USD'].includes(invoice.currency) || account.currency !== invoice.currency || account.category === 'personal') throw new LedgerInputError('Faturanın para birimi veya cari grubu eşleşmiyor.');
  if (account.opening_status !== 'confirmed' || account.balance_minor === null) throw new LedgerInputError('Carinin açılış bakiyesi bekleniyor.');
  if (invoice.date <= account.opening_date) throw new LedgerInputError('Fatura açılış tarihinde veya öncesinde; tekrar borç yazılmadı.');
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/.test(invoice.amount || '')) throw new LedgerInputError('Fatura tutarı doğrulanamadı.');
  const [whole, fraction = ''] = invoice.amount.split('.');
  if (/[1-9]/.test(fraction.slice(2))) throw new LedgerInputError('Fatura tutarında kuruştan küçük fark var; inceleme gerekiyor.');
  const plan = ledgerMovement(account, { operation_id: invoiceOperation(invoice.id), expected_revision: account.revision, type: 'debt', date: invoice.date, amount: `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`, method: '', description: `Uyumsoft fatura · ${invoice.number} · ${invoice.supplier}`.slice(0, 500) }, actor, now);
  return plan.existing ? plan : { ...plan, entry: { ...plan.entry, type: 'invoice', source_invoice_id: invoice.id, source_invoice_number: invoice.number } };
}
export function invoiceAccountMatch(invoice, accounts, invoices) {
  const suppliers = new Set(invoices.filter(item => fold(item.supplier) === fold(invoice.supplier)).map(item => item.supplier_identifier));
  if (suppliers.size !== 1) return null;
  const candidates = accounts.filter(account => account.currency === invoice.currency && account.category !== 'personal' && (() => {
    const names = new Set([fold(account.name)]);
    for (const [shortNames, title] of aliases) if (shortNames.some(name => fold(name) === fold(account.name))) names.add(fold(title));
    return names.has(fold(invoice.supplier));
  })());
  return candidates.length === 1 ? candidates[0] : null;
}
// Fetch a complete snapshot before writing anything. No moving date cursor means
// late-arriving invoices dated after cutover are found on every subsequent scan.
export async function readAutoInvoiceSnapshot(startsOn, endsOn, fetchPage = listInboxInvoices, renew = async () => {}) {
  if (!validDate(startsOn) || !validDate(endsOn)) throw new Error('Geçersiz aktarım tarihi.');
  const invoices = [], ids = new Set(), numbers = new Set();
  if (startsOn > endsOn) return invoices;
  let start = startsOn, calls = 0;
  while (start <= endsOn) {
    const limit = new Date(`${start}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 365);
    const end = [limit.toISOString().slice(0, 10), endsOn].sort()[0];
    let expectedCount, expectedPages, count = 0;
    for (let page = 0; ; page++) {
      if (++calls > 200) throw new Error('Fatura taraması sınırı aşıldı; eksik listeden kayıt yapılmadı.');
      await renew();
      const result = await fetchPage({ start_date: start, end_date: end, page: String(page) });
      if (!result || result.page !== page || !Array.isArray(result.invoices) || !Number.isSafeInteger(result.total_count) || result.total_count < 0 || !Number.isSafeInteger(result.total_pages) || result.total_pages < 0) throw new Error('Fatura sayfalaması doğrulanamadı.');
      if (page === 0) { expectedCount = result.total_count; expectedPages = result.total_pages; }
      if (expectedCount !== result.total_count || expectedPages !== result.total_pages) throw new Error('Sorgu sırasında fatura listesi değişti; tekrar kontrol edilecek.');
      for (const invoice of result.invoices) {
        const key = invoiceDocumentKey(invoice);
        if (!invoice.id || ids.has(invoice.id) || numbers.has(key) || invoice.date < start || invoice.date > end) throw new Error('Yinelenen veya tarih aralığı dışındaki fatura; liste doğrulanamadı.');
        ids.add(invoice.id); numbers.add(key); invoices.push(invoice); count++;
      }
      if (count > expectedCount || (page + 1 < expectedPages && result.invoices.length === 0)) throw new Error('Fatura listesi eksik geldi.');
      if (page + 1 >= expectedPages) { if (count !== expectedCount) throw new Error('Fatura listesi eksik geldi.'); break; }
    }
    const next = new Date(`${end}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); start = next.toISOString().slice(0, 10);
  }
  return invoices;
}

const issueSchema = new mongoose.Schema({ number: String, supplier: String, date: String, reason: String }, { _id: false });
const stateSchema = new mongoose.Schema({
  _id: String, enabled: { type: Boolean, default: false }, starts_on: String,
  actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, actor_name: String,
  lease_token: { type: String, default: '' }, lease_until: Date, write_revision: { type: Number, default: 0 },
  last_attempt: Date, last_success: Date, last_error: { type: String, default: '' },
  scanned: { type: Number, default: 0 }, posted: { type: Number, default: 0 }, existing: { type: Number, default: 0 },
  issue_count: { type: Number, default: 0 }, issues: { type: [issueSchema], default: [] },
}, { timestamps: true });
const postingSchema = new mongoose.Schema({
  _id: String, document_key: { type: String, unique: true, required: true }, fingerprint: { type: String, required: true },
  account_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerAccount', required: true }, entry_id: { type: String, required: true },
  number: String, date: String, posted_at: { type: Date, required: true },
}, { versionKey: false });
export const InvoiceAutoState = mongoose.models.InvoiceAutoState || mongoose.model('InvoiceAutoState', stateSchema);
export const InvoiceLedgerPosting = mongoose.models.InvoiceLedgerPosting || mongoose.model('InvoiceLedgerPosting', postingSchema);
const leaseError = () => new LedgerInputError('Aktarım duraklatıldı veya başka sunucuya geçti.', 409);
export async function postAutomaticInvoice(invoice, invoices, state, deps = {}) {
  const State = deps.State || InvoiceAutoState, Posting = deps.Posting || InvoiceLedgerPosting, Accounts = deps.Accounts || LedgerAccount;
  const transaction = deps.transaction || (fn => mongoose.connection.transaction(fn));
  return transaction(async session => {
    // This write shares the transaction with the balance and receipt. Pausing,
    // a second worker, restart, payment or manual edit cannot leave half a posting.
    const lock = await State.updateOne({ _id: STATE_ID, enabled: true, lease_token: state.lease_token, lease_until: { $gt: new Date() } }, { $inc: { write_revision: 1 } }, { session });
    if (!lock.matchedCount) throw leaseError();
    const accounts = await Accounts.find({ currency: invoice.currency, category: { $ne: 'personal' } }).session(session).lean();
    const prior = await Posting.findOne({ $or: [{ _id: invoice.id }, { document_key: invoiceDocumentKey(invoice) }] }).session(session).lean();
    if (prior) {
      if (prior._id !== invoice.id || prior.fingerprint !== invoiceFingerprint(invoice) || invoice.status !== 'Approved' || invoice.type !== 'Sales') return { issue: 'Daha önce işlenen belge değişmiş veya iptal edilmiş; düzeltme için inceleyin.' };
      const account = accounts.find(item => String(item._id) === String(prior.account_id));
      if (!account?.entries.some(entry => entry.operation_id === prior.entry_id)) return { issue: 'Aktarım kaydı ile cari geçmişi uyuşmuyor; inceleyin.' };
      return { existing: true }; // Includes manually reversed entries: never recreate them.
    }
    const account = invoiceAccountMatch(invoice, accounts, invoices);
    if (!account) return { issue: 'Tek bir cari ve vergi kaydıyla eşleştirilemedi; cariyi/para birimini kontrol edin.' };
    let plan;
    try { plan = invoiceAutoPlan(invoice, account, state.starts_on, { _id: state.actor_id, name: 'Otomatik Uyumsoft aktarımı' }); }
    catch (error) { if (error instanceof LedgerInputError) return { issue: error.message }; throw error; }
    if (plan.existing) return { issue: 'Fatura hareketi var ancak aktarım makbuzu yok; ikinci kez işlenmedi.' };
    await Posting.create([{ _id: invoice.id, document_key: invoiceDocumentKey(invoice), fingerprint: invoiceFingerprint(invoice), account_id: account._id, entry_id: plan.entry.operation_id, number: invoice.number, date: invoice.date, posted_at: new Date() }], { session });
    const saved = await Accounts.updateOne({ _id: account._id, revision: account.revision, 'entries.operation_id': { $ne: plan.entry.operation_id } }, { $push: { entries: plan.entry }, $set: { balance_minor: plan.balance_minor }, $inc: { revision: 1 } }, { session, runValidators: true });
    if (!saved.modifiedCount) throw new LedgerInputError('Cari aynı anda değişti; sonraki taramada yeniden kontrol edilecek.', 409);
    return { posted: true };
  });
}
export async function runInvoiceAutoSync() {
  const token = randomUUID(), now = new Date();
  const state = await InvoiceAutoState.findOneAndUpdate({ _id: STATE_ID, enabled: true, $or: [{ lease_until: { $lte: now } }, { lease_until: null }] }, { $set: { lease_token: token, lease_until: new Date(now.getTime() + INTERVAL), last_attempt: now } }, { new: true }).lean();
  if (!state) return;
  const renew = async () => { const saved = await InvoiceAutoState.updateOne({ _id: STATE_ID, enabled: true, lease_token: token }, { $set: { lease_until: new Date(Date.now() + INTERVAL) } }); if (!saved.matchedCount) throw leaseError(); };
  const result = { scanned: 0, posted: 0, existing: 0, issue_count: 0, issues: [] };
  try {
    if (!uyumsoftConfig().configured) throw new Error('Uyumsoft bağlantısı hazır değil.');
    const user = await User.findById(state.actor_id).select('-user_password').populate('user_role');
    if (!isProductionAdmin(user)) throw new Error('Aktarımı açan yöneticinin yetkisi doğrulanamadı.');
    const invoices = await readAutoInvoiceSnapshot(state.starts_on, today(), listInboxInvoices, renew);
    for (const invoice of invoices) {
      await renew();
      const posted = await postAutomaticInvoice(invoice, invoices, state);
      result.scanned++;
      if (posted.posted) result.posted++; else if (posted.existing) result.existing++;
      else { result.issue_count++; if (result.issues.length < 100) result.issues.push({ number: invoice.number, supplier: invoice.supplier, date: invoice.date, reason: posted.issue }); }
    }
    await InvoiceAutoState.updateOne({ _id: STATE_ID, lease_token: token }, { $set: { ...result, last_success: new Date(), last_error: '' } });
  } catch {
    await InvoiceAutoState.updateOne({ _id: STATE_ID, lease_token: token }, { $set: { ...result, last_error: 'Aktarım tamamlanamadı. Önceden tamamlanan kayıtlar korunur; eksik faturalar sonraki taramada yeniden kontrol edilir.' } });
  } finally { await InvoiceAutoState.updateOne({ _id: STATE_ID, lease_token: token }, { $set: { lease_token: '', lease_until: null } }); }
}
export function kickInvoiceAutoSync() { void runInvoiceAutoSync().catch(() => console.error('Otomatik fatura aktarımı kontrol edilemedi.')); }
export async function startInvoiceAutoWorker() { await InvoiceAutoState.init(); await InvoiceLedgerPosting.init(); kickInvoiceAutoSync(); const timer = setInterval(kickInvoiceAutoSync, INTERVAL); timer.unref(); return timer; }
export function invoiceAutoPublic(state) {
  return { enabled: !!state?.enabled, starts_on: state?.starts_on || null, interval_minutes: 15, running: !!state?.lease_token && new Date(state.lease_until) > new Date(), last_attempt: state?.last_attempt || null, last_success: state?.last_success || null, error: state?.last_error || '', scanned: state?.scanned || 0, posted: state?.posted || 0, existing: state?.existing || 0, issue_count: state?.issue_count || 0, issues: state?.issues || [] };
}
export async function getInvoiceAutoStatus(_req, res) {
  res.set('Cache-Control', 'no-store');
  try { return res.json(invoiceAutoPublic(await InvoiceAutoState.findById(STATE_ID).lean())); }
  catch { return res.status(503).json({ message: 'Otomatik aktarım durumu okunamadı.' }); }
}
export async function configureInvoiceAuto(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!req.body || Object.keys(req.body).some(key => !['enabled', 'starts_on'].includes(key)) || typeof req.body.enabled !== 'boolean') throw new LedgerInputError('Aktarım ayarlarını kontrol edin.');
    const current = await InvoiceAutoState.findById(STATE_ID).lean();
    if (!req.body.enabled) {
      if (current) await InvoiceAutoState.updateOne({ _id: STATE_ID }, { $set: { enabled: false, lease_token: '', lease_until: null } });
    } else {
      if (!uyumsoftConfig().configured) throw new LedgerInputError('Önce Uyumsoft bağlantısını kurun.', 409);
      const start = current?.starts_on || req.body.starts_on;
      const limit = new Date(`${today()}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 31);
      if (!validDate(start) || (!current && (start < today() || start > limit.toISOString().slice(0, 10)))) throw new LedgerInputError('Başlangıcı bugün veya önümüzdeki 31 gün içinde seçin; geçmiş açılış bakiyeleri tekrar işlenmez.');
      if (current && req.body.starts_on && req.body.starts_on !== current.starts_on) throw new LedgerInputError('Aktarım başlangıcı sonradan değiştirilemez.', 409);
      await InvoiceAutoState.updateOne({ _id: STATE_ID }, { $set: { enabled: true, actor_id: req.productionActor._id, actor_name: req.productionActor.name }, $setOnInsert: { starts_on: start } }, { upsert: true, runValidators: true });
      kickInvoiceAutoSync();
    }
    return res.json(invoiceAutoPublic(await InvoiceAutoState.findById(STATE_ID).lean()));
  } catch (error) { return res.status(error instanceof LedgerInputError ? error.status : 503).json({ message: error instanceof LedgerInputError ? error.message : 'Aktarım ayarı kaydedilemedi. Durumu yenileyerek kontrol edin.' }); }
}
export async function checkInvoiceAutoNow(_req, res) { res.set('Cache-Control', 'no-store'); kickInvoiceAutoSync(); return res.status(202).json({ message: 'Sunucuda kontrol başlatıldı. Sonuç birazdan güncellenecek.' }); }
export async function annotateInvoicePostings(result) {
  const receipts = await InvoiceLedgerPosting.find({ _id: { $in: result.invoices.map(invoice => invoice.id) } }).lean();
  const accounts = receipts.length ? await LedgerAccount.find({ _id: { $in: receipts.map(item => item.account_id) } }).select('name entries.operation_id entries.reverses').lean() : [];
  const state = await InvoiceAutoState.findById(STATE_ID).lean();
  return { ...result, invoices: result.invoices.map(invoice => {
    const receipt = receipts.find(item => item._id === invoice.id), account = receipt && accounts.find(item => String(item._id) === String(receipt.account_id));
    const reversed = account?.entries.some(entry => entry.reverses === receipt?.entry_id);
    const posting = receipt ? !account || !account.entries.some(entry => entry.operation_id === receipt.entry_id) || receipt.fingerprint !== invoiceFingerprint(invoice) || invoice.status !== 'Approved' || invoice.type !== 'Sales' ? 'İşlenen belge değişti; inceleyin' : reversed ? 'Cari kaydı geri alındı' : `Cariye işlendi · ${account.name}` : state?.starts_on && invoice.date < state.starts_on ? 'Aktarım tarihi öncesi' : state?.enabled ? 'Kontrol / inceleme bekliyor' : 'Otomatik aktarım kapalı';
    return { ...invoice, posted_to_ledger: !!receipt && !reversed, ledger_status: posting };
  }) };
}
