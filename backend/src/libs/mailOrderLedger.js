import { createHash } from 'node:crypto';
import LedgerAccount from '../models/LedgerAccount.js';
import { ledgerMovement, reverseLedgerMovement, LedgerInputError } from './accountLedger.js';
import { PaymentInputError } from './orderPayments.js';
import { isProductionAdmin } from './productionAccess.js';

// The immutable sale/payment pair identifies one posting across retries and tabs.
export function mailOrderOperation(saleId, paymentId, reversing = false) {
  const h = createHash('sha256').update(JSON.stringify(['pos-mail-order', String(saleId), paymentId, reversing])).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export function mailOrderLedgerPlan(account, sale, payment, actor, now = new Date()) {
  if (account.category !== 'supplier' || account.currency !== 'TRY') throw new PaymentInputError('Mail order için TL cinsinden bir tedarikçi carisi seçin.', 409);
  const source = { source_sale_id: String(sale._id), source_payment_id: payment.request_id };
  const operation = mailOrderOperation(sale._id, payment.request_id);
  const description = `POS mail order · ${payment.company} · Sipariş ${sale._id} · ${payment.kind}`;
  const plan = ledgerMovement(account, { operation_id: operation, expected_revision: account.revision, type: 'receivable', date: payment.paid_date, amount: payment.amount.toFixed(2), method: '', description }, actor, now);
  return plan.existing ? plan : { ...plan, entry: { ...plan.entry, ...source, type: 'mail_order', method: 'Mail Order' } };
}
export function mailOrderReversalPlan(account, sale, payment, reason, actor, now = new Date()) {
  const target = mailOrderOperation(sale._id, payment.request_id);
  const original = account.entries.find(entry => entry.operation_id === target);
  if (!original || original.source_sale_id !== String(sale._id) || original.source_payment_id !== payment.request_id) throw new PaymentInputError('Bağlı mail order cari hareketi bulunamadı. Tahsilat değiştirilmedi.', 409);
  const plan = reverseLedgerMovement(account, target, { operation_id: mailOrderOperation(sale._id, payment.request_id, true), expected_revision: account.revision, reason }, actor, now, true);
  return plan.existing ? plan : { ...plan, entry: { ...plan.entry, source_sale_id: String(sale._id), source_payment_id: payment.request_id } };
}
export async function postMailOrderLedger(sale, payment, user, session, reversalReason = null) {
  if (payment.method !== 'Mail Order') return;
  // Old receipts were part of historical opening statements. Never backfill them.
  if (reversalReason !== null && !payment.ledger_account_id) return;
  if (!isProductionAdmin(user)) throw new PaymentInputError('Firma carisine mail order kaydı yalnız mağaza yöneticisine açıktır.', 403);
  if (!payment.company || !payment.ledger_account_id) throw new PaymentInputError('Mail order firmasını ve düşülecek cari hesabını seçin. Gerekirse önce carinin açılış bakiyesini girin.', 409);
  const account = await LedgerAccount.findById(payment.ledger_account_id).session(session).lean();
  if (!account) throw new PaymentInputError('Seçilen mail order carisi bulunamadı. Tahsilat kaydedilmedi.', 409);
  const actor = { _id: user._id, name: user.user_username || user.name || '' };
  let plan;
  try { plan = reversalReason === null ? mailOrderLedgerPlan(account, sale, payment, actor) : mailOrderReversalPlan(account, sale, payment, reversalReason, actor); }
  catch (error) { if (error instanceof LedgerInputError) throw new PaymentInputError(error.message, error.status); throw error; }
  if (plan.existing) return;
  // Both this change and the Sale save use the same transaction; either both commit or neither does.
  const saved = await LedgerAccount.findOneAndUpdate({ _id: account._id, revision: account.revision, 'entries.operation_id': { $ne: plan.entry.operation_id } }, { $push: { entries: plan.entry }, $set: { balance_minor: plan.balance_minor }, $inc: { revision: 1 } }, { new: true, runValidators: true, session }).lean();
  if (!saved) throw new PaymentInputError('Cari başka bir ekranda değişti. Aynı tahsilatı yeniden doğrulayın.', 409);
}
