import { OfficeError, officeObject, officeOperation, officeHash, paymentKey } from './cashPersonnelRules.js';

// Mask only the cash effect of the prior period. Personnel entitlements and
// original journals remain intact, including corrections made after a reset.
export function currentCashEntries(entries, config) {
  const excluded = new Set(config.test_cash_reset?.entry_ids || []);
  return entries.map(entry => excluded.has(String(entry._id)) || excluded.has(String(entry.reverses || ''))
    ? { ...entry, cash: { cash: '0', bank: '0', pos: '0' } } : entry);
}
export function currentCashRows(entries, config) {
  const excluded = new Set(config.test_cash_reset?.entry_ids || []);
  return currentCashEntries(entries, config).filter(entry => !excluded.has(String(entry._id)));
}
export function resetInput(body, restoring = false) {
  officeObject(body, ['operation_id', 'expected_revision', ...(restoring ? ['reset_id'] : ['confirmation'])]);
  officeOperation(body.operation_id);
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new OfficeError('Kasa ekranını yenileyin.', 409);
  if (restoring) officeOperation(body.reset_id);
  else if (body.confirmation !== 'SIFIRLA') throw new OfficeError('Sıfırlama onayı eksik.');
  return body;
}
export function makeCashResetHandlers({ office, entries, sales, include, transaction, enabled }) {
  const fail = (res, error) => res.status(error instanceof OfficeError ? error.status : 500).json({ message: error instanceof OfficeError ? error.message : 'Kasa sıfırlama sonucu doğrulanamadı. Ekranı yenileyin.' });
  async function change(req, res, restoring) {
    try {
      if (!enabled()) throw new OfficeError('Bu işlem yalnız Şahinsoy TEST ortamında kullanılabilir.', 404);
      const input = resetInput(req.body, restoring), fingerprint = officeHash(input);
      await transaction(async session => {
        const config = await office.findById('store').session(session).lean();
        if (!config) throw new OfficeError('Önce kasa başlangıcını kaydedin.', 409);
        const history = config.test_cash_resets || [];
        const repeated = restoring ? history.find(row => row.restored_operation === input.operation_id) : history.find(row => row.id === input.operation_id);
        if (repeated) {
          if ((restoring ? repeated.restored_fingerprint : repeated.fingerprint) !== fingerprint || (!restoring && repeated.restored_at)) throw new OfficeError('İşlem kimliği daha önce farklı kullanıldı.', 409);
          return;
        }
        if (config.revision !== input.expected_revision) throw new OfficeError('Kasa değişti. Yenileyip tekrar kontrol edin.', 409);
        const locked = await office.findOneAndUpdate({ _id: 'store', revision: input.expected_revision }, { $inc: { revision: 1 } }, { new: true, session }).lean();
        if (!locked) throw new OfficeError('Kasa aynı anda değişti.', 409);
        let values;
        if (restoring) {
          const record = history.find(row => row.id === input.reset_id && !row.restored_at);
          if (!record || config.test_cash_reset?.id !== record.id) throw new OfficeError('Yalnız son etkin kasa sıfırlaması geri alınabilir.', 409);
          record.restored_at = new Date(); record.restored_by = String(req.user._id);
          record.restored_operation = input.operation_id; record.restored_fingerprint = fingerprint;
          values = { ...record.before, test_cash_resets: history };
        } else {
          if (history.length >= 5) throw new OfficeError('TEST sıfırlama arşivi sınırına ulaşıldı.', 409);
          if (await sales.countDocuments().session(session)) throw new OfficeError('Önce TEST siparişlerini deneme arşivine kaldırın.', 409);
          const oldEntries = await entries.find().select('_id').limit(10001).session(session).lean();
          const oldSales = await include(sales.find()).select('payments.request_id').limit(2001).session(session).lean();
          const excluded = [...new Set([...(config.excluded_payment_keys || []), ...oldSales.flatMap(sale => (sale.payments || []).map(payment => paymentKey(sale._id, payment)))])];
          if (oldEntries.length > 10000 || oldSales.length > 2000 || excluded.length > 20000) throw new OfficeError('Kasa kapsamı sıfırlama sınırını aşıyor.', 409);
          const reset = { id: input.operation_id, at: new Date(), entry_ids: oldEntries.map(row => String(row._id)) };
          history.push({ ...reset, fingerprint, by: String(req.user._id), before: { openings: config.openings, excluded_payment_keys: config.excluded_payment_keys || [], test_cash_reset: config.test_cash_reset || null } });
          values = { openings: { cash: '0', bank: '0', pos: '0' }, excluded_payment_keys: excluded, test_cash_reset: reset, test_cash_resets: history };
        }
        const saved = await office.updateOne({ _id: 'store', revision: locked.revision }, { $set: values }, { session });
        if (saved.modifiedCount !== 1) throw new OfficeError('Kasa aynı anda değişti.', 409);
      });
      return res.json({ saved: true, restored: restoring });
    } catch (error) { return fail(res, error); }
  }
  return { reset: (req, res) => change(req, res, false), restore: (req, res) => change(req, res, true) };
}
