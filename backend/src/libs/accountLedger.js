import { createHash } from 'node:crypto';

export class LedgerInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const LEDGER_METHODS = ['Nakit', 'Havale / EFT', 'Mail Order', 'Kredi Kartı', 'Diğer'];
export const LEDGER_CURRENCIES = ['TRY', 'EUR', 'USD'];
export const LEDGER_CATEGORIES = ['supplier', 'cargo', 'electricity', 'communication', 'personal', 'other'];
export const LEDGER_ENTRY_LIMIT = 5000;
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new LedgerInputError('Cari kayıt alanlarını kontrol edin.');
}
function text(value, limit, label, required = false) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new LedgerInputError(`${label} geçersiz.`);
  const result = value.trim();
  if (required && !result) throw new LedgerInputError(`${label} girin.`);
  return result;
}
export function ledgerNameKey(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[ıIİ]/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim(); }
export function ledgerDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31') throw new LedgerInputError('Geçerli bir kayıt tarihi seçin.');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(now);
  if (value > today) throw new LedgerInputError('İleri tarihli borç veya ödeme kaydı girilemez. Gerçekleşen işlem tarihini kullanın.');
  return value;
}
export function ledgerMinor(value, allowZero = false) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(value)) throw new LedgerInputError('Tutarı binlik ayırıcı olmadan, en fazla iki ondalıkla girin. Örnek: 25000,50');
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (!allowZero && minor === 0n) throw new LedgerInputError('Tutar sıfırdan büyük olmalı.');
  return minor.toString();
}
function operationId(value) { if (!uuid(value)) throw new LedgerInputError('Kayıt kimliği geçersiz. Ekranı yenileyin.'); return value.toLowerCase(); }
function revision(account, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new LedgerInputError('Kayıt sürümü geçersiz. Cariyi yenileyin.');
  if (expected !== account.revision) throw new LedgerInputError('Bu cari başka bir ekranda değişti. Yenileyip tekrar inceleyin.', 409);
  if ((account.entries?.length || 0) >= LEDGER_ENTRY_LIMIT) throw new LedgerInputError('Cari hareket sınırına ulaşıldı. Yeni dönem hesabı açın.', 409);
}
function priorOperation(account, operation, fingerprint) {
  const prior = account.entries.find(entry => entry.operation_id === operation);
  if (!prior) return null;
  if (prior.fingerprint !== fingerprint) throw new LedgerInputError('Aynı kayıt kimliği farklı bilgilerle kullanılamaz.', 409);
  return { existing: true, entry: prior, balance_minor: account.balance_minor };
}
function recorded(entry, actor, now) { return { ...entry, recorded_by: String(actor._id), recorded_name: actor.name || '', recorded_at: now }; }
export function newLedgerAccount(input, actor, now = new Date()) {
  object(input, ['operation_id', 'name', 'category', 'currency', 'opening_known', 'opening_date', 'opening_amount', 'opening_direction', 'description']);
  const name = text(input.name, 120, 'Kişi / firma adı', true);
  if (!ledgerNameKey(name) || /[\r\n\t]/.test(name)) throw new LedgerInputError('Kişi / firma adı geçersiz.');
  if (!LEDGER_CURRENCIES.includes(input.currency)) throw new LedgerInputError('Hesabın para birimini seçin.');
  const category = input.category ?? 'other';
  if (!LEDGER_CATEGORIES.includes(category)) throw new LedgerInputError('Cari grubunu seçin.');
  if (input.opening_known !== undefined && typeof input.opening_known !== 'boolean') throw new LedgerInputError('Açılış bakiyesi durumunu kontrol edin.');
  const known = input.opening_known !== false;
  const description = text(input.description ?? '', 500, 'Açıklama');
  const operation = operationId(input.operation_id);
  if (!known) {
    if (input.opening_amount !== '' && input.opening_amount !== undefined) throw new LedgerInputError('Bakiye bilinmiyorsa tutar girmeyin.');
    const fingerprint = hash({ name, category, currency: input.currency, opening_known: false, description });
    return { name, name_key: ledgerNameKey(name), category, note: description, currency: input.currency, opening_status: 'pending', opening_date: null, balance_minor: null, revision: 0, create_operation: operation, create_fingerprint: fingerprint, created_by: String(actor._id), entries: [] };
  }
  if (!['owe', 'receivable'].includes(input.opening_direction)) throw new LedgerInputError('Açılış bakiyesinin borç yönünü seçin.');
  const normalized = { name, category, currency: input.currency, opening_date: ledgerDate(input.opening_date, now), amount_minor: ledgerMinor(input.opening_amount, true), direction: input.opening_direction, description };
  const fingerprint = hash(normalized);
  const delta = (BigInt(normalized.amount_minor) * (normalized.direction === 'owe' ? 1n : -1n)).toString();
  return { name, name_key: ledgerNameKey(name), category, note: description, currency: normalized.currency, opening_status: 'confirmed', opening_date: normalized.opening_date, balance_minor: delta, revision: 0, create_operation: operation, create_fingerprint: fingerprint, created_by: String(actor._id), entries: [recorded({ operation_id: operation, fingerprint, type: 'opening', date: normalized.opening_date, amount_minor: normalized.amount_minor, delta_minor: delta, description: normalized.description, method: '', reverses: '' }, actor, now)] };
}
export function confirmLedgerOpening(account, input, actor, now = new Date()) {
  object(input, ['operation_id', 'expected_revision', 'opening_date', 'opening_amount', 'opening_direction', 'description']);
  if (!['owe', 'receivable'].includes(input.opening_direction)) throw new LedgerInputError('Açılış bakiyesinin borç yönünü seçin.');
  const data = { date: ledgerDate(input.opening_date, now), amount_minor: ledgerMinor(input.opening_amount, true), direction: input.opening_direction, description: text(input.description ?? '', 500, 'Açıklama') };
  const operation = operationId(input.operation_id), fingerprint = hash(data), prior = priorOperation(account, operation, fingerprint);
  if (prior) return prior;
  if (account.opening_status !== 'pending' || account.entries.length) throw new LedgerInputError('Bu carinin açılış bakiyesi zaten girilmiş.', 409);
  revision(account, input.expected_revision);
  const delta = (BigInt(data.amount_minor) * (data.direction === 'owe' ? 1n : -1n)).toString();
  return { existing: false, opening_date: data.date, entry: recorded({ operation_id: operation, fingerprint, type: 'opening', date: data.date, amount_minor: data.amount_minor, delta_minor: delta, description: data.description, method: '', reverses: '' }, actor, now), balance_minor: delta };
}
export function ledgerMovement(account, input, actor, now = new Date()) {
  object(input, ['operation_id', 'expected_revision', 'type', 'date', 'amount', 'method', 'description']);
  if (account.opening_status === 'pending') throw new LedgerInputError('Önce bu carinin güncel açılış bakiyesini girin.', 409);
  if (!['debt', 'receivable', 'payment_sent', 'payment_received'].includes(input.type)) throw new LedgerInputError('Hareket türünü seçin.');
  const date = ledgerDate(input.date, now);
  if (date < account.opening_date) throw new LedgerInputError('Açılış tarihinden önce hareket eklenemez. O tarihteki net bakiyeyi kullanın.');
  const amount = ledgerMinor(input.amount), description = text(input.description ?? '', 500, 'Açıklama', true);
  const payment = input.type.startsWith('payment_');
  const method = input.method ?? '';
  if ((payment && !LEDGER_METHODS.includes(method)) || (!payment && method !== '')) throw new LedgerInputError('Ödeme yöntemini kontrol edin.');
  const data = { type: input.type, date, amount_minor: amount, description, method };
  const operation = operationId(input.operation_id), fingerprint = hash(data), prior = priorOperation(account, operation, fingerprint);
  if (prior) return prior;
  revision(account, input.expected_revision);
  const positive = ['debt', 'payment_received'].includes(input.type);
  const delta = (BigInt(amount) * (positive ? 1n : -1n)).toString();
  return { existing: false, entry: recorded({ ...data, operation_id: operation, fingerprint, delta_minor: delta, reverses: '' }, actor, now), balance_minor: (BigInt(account.balance_minor) + BigInt(delta)).toString() };
}
export function reverseLedgerMovement(account, targetId, input, actor, now = new Date(), linkedPayment = false) {
  object(input, ['operation_id', 'expected_revision', 'reason']);
  const target = account.entries.find(entry => entry.operation_id === targetId);
  if (!target) throw new LedgerInputError('Hareket bulunamadı.', 404);
  if (target.source_payment_id && !linkedPayment) throw new LedgerInputError('Bu hareket POS tahsilatına bağlı. Düzeltmeyi siparişin tahsilat ekranından yapın.', 409);
  if (target.type === 'reversal' || BigInt(target.amount_minor) === 0n) throw new LedgerInputError('Bu hareket ters kayıtla düzeltilemez.');
  const reason = text(input.reason ?? '', 500, 'Düzeltme gerekçesi', true);
  const operation = operationId(input.operation_id), fingerprint = hash({ target: targetId, reason }), prior = priorOperation(account, operation, fingerprint);
  if (prior) return prior;
  if (account.entries.some(entry => entry.reverses === targetId)) throw new LedgerInputError('Bu hareket daha önce geri alındı.', 409);
  revision(account, input.expected_revision);
  const delta = (-BigInt(target.delta_minor)).toString();
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(now);
  return { existing: false, entry: recorded({ operation_id: operation, fingerprint, type: 'reversal', date, amount_minor: target.amount_minor, delta_minor: delta, description: reason, method: target.method, reverses: targetId }, actor, now), balance_minor: (BigInt(account.balance_minor) + BigInt(delta)).toString() };
}
export function ledgerPublic(account, detail = false) {
  const result = { id: String(account._id), name: account.name, category: account.category, note: account.note, currency: account.currency, opening_status: account.opening_status, opening_date: account.opening_date, balance_minor: account.balance_minor, revision: account.revision, updated_at: account.updatedAt };
  if (detail) result.entries = account.entries.map(entry => ({ id: entry.operation_id, type: entry.type, date: entry.date, amount_minor: entry.amount_minor, delta_minor: entry.delta_minor, method: entry.method, description: entry.description, reverses: entry.reverses, source_sale_id: entry.source_sale_id || '', source_payment_id: entry.source_payment_id || '', recorded_at: entry.recorded_at, recorded_name: entry.recorded_name }));
  return result;
}
