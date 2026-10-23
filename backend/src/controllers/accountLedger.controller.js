import LedgerAccount from '../models/LedgerAccount.js';
import { LedgerInputError, ledgerNameKey, newLedgerAccount, ledgerMovement, reverseLedgerMovement, confirmLedgerOpening, ledgerPublic } from '../libs/accountLedger.js';

const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
function fail(res, error) {
  if (error instanceof LedgerInputError) return res.status(error.status).json({ message: error.message });
  if (error?.code === 11000) return res.status(409).json({ message: 'Aynı isim ve para biriminde cari zaten var. Mevcut hesabı açın.' });
  return res.status(500).json({ message: 'Cari kaydı tamamlanamadı. Yenileyip kayıt durumunu kontrol edin.' });
}
export async function getLedgerAccounts(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 120)) throw new LedgerInputError('Arama metnini kontrol edin.');
    const q = ledgerNameKey(req.query.q || '');
    const filter = q ? { name_key: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } } : {};
    const accounts = await LedgerAccount.find(filter).select('-entries').sort({ name_key: 1, currency: 1 }).limit(201).lean();
    return res.json({ accounts: accounts.slice(0, 200).map(account => ledgerPublic(account)), truncated: accounts.length > 200 });
  } catch (error) { return fail(res, error); }
}
export async function getLedgerAccount(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!validId(req.params.id)) throw new LedgerInputError('Cari bulunamadı.', 404);
    const account = await LedgerAccount.findById(req.params.id).lean();
    if (!account) throw new LedgerInputError('Cari bulunamadı.', 404);
    return res.json(ledgerPublic(account, true));
  } catch (error) { return fail(res, error); }
}
export async function createLedgerAccount(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const data = newLedgerAccount(req.body, req.productionActor);
    const prior = await LedgerAccount.findOne({ create_operation: data.create_operation }).lean();
    if (prior) {
      if (prior.create_fingerprint !== data.create_fingerprint) throw new LedgerInputError('Aynı cari işlem kimliği farklı bilgilerle kullanılamaz.', 409);
      return res.json(ledgerPublic(prior, true));
    }
    await LedgerAccount.init();
    try { return res.status(201).json(ledgerPublic((await LedgerAccount.create(data)).toObject(), true)); }
    catch (error) {
      if (error?.code === 11000) {
        const saved = await LedgerAccount.findOne({ create_operation: data.create_operation }).lean();
        if (saved?.create_fingerprint === data.create_fingerprint) return res.json(ledgerPublic(saved, true));
      }
      throw error;
    }
  } catch (error) { return fail(res, error); }
}
async function append(req, res, reverse) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!validId(req.params.id)) throw new LedgerInputError('Cari bulunamadı.', 404);
    const account = await LedgerAccount.findById(req.params.id).lean();
    if (!account) throw new LedgerInputError('Cari bulunamadı.', 404);
    const plan = current => reverse === 'opening' ? confirmLedgerOpening(current, req.body, req.productionActor) : reverse ? reverseLedgerMovement(current, req.params.entryId, req.body, req.productionActor) : ledgerMovement(current, req.body, req.productionActor);
    const change = plan(account);
    if (change.existing) return res.json(ledgerPublic(account, true));
    // One atomic document update protects balance and history together, including
    // concurrent tabs and retries. No separate balance write or Mongo transaction.
    const changes = { balance_minor: change.balance_minor, ...(change.opening_date ? { opening_date: change.opening_date, opening_status: 'confirmed' } : {}) };
    const saved = await LedgerAccount.findOneAndUpdate({ _id: account._id, revision: account.revision, 'entries.operation_id': { $ne: change.entry.operation_id } }, { $push: { entries: change.entry }, $set: changes, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
    if (saved) return res.json(ledgerPublic(saved, true));
    const current = await LedgerAccount.findById(req.params.id).lean();
    if (!current) throw new LedgerInputError('Cari bulunamadı.', 404);
    const replay = plan(current);
    if (replay.existing) return res.json(ledgerPublic(current, true));
    throw new LedgerInputError('Cari başka bir ekranda değişti. Yenileyip tekrar inceleyin.', 409);
  } catch (error) { return fail(res, error); }
}
export function addLedgerMovement(req, res) { return append(req, res, false); }
export function reverseLedgerEntry(req, res) { return append(req, res, true); }
export function setLedgerOpening(req, res) { return append(req, res, 'opening'); }
