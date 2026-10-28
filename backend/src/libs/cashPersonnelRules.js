import { createHash } from 'node:crypto';
import { ledgerDate, ledgerMinor, ledgerNameKey } from './accountLedger.js';
export class OfficeError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const officeToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(now);
export const officeHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const officeId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
export function officeObject(value, fields) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new OfficeError('Gönderilen kasa / personel alanlarını kontrol edin.'); }
export function officeOperation(value) { if (typeof value !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)) throw new OfficeError('İşlem kimliği geçersiz.'); return value.toLowerCase(); }
export function officeText(value, max, required = false) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new OfficeError('Ad / açıklama alanını kontrol edin.'); value = value.trim(); if (required && !value) throw new OfficeError('Ad / açıklama girin.'); return value; }
export function officeDate(value, config, now = new Date()) { const date = ledgerDate(value, now); if (config && date < config.start_date) throw new OfficeError('Kayıt tarihi kasa başlangıcından önce olamaz.'); return date; }
export function personInput(input, previous = null) {
  officeObject(input, ['operation_id', 'expected_revision', 'name', 'kind', 'staff_id', 'monthly_salary', 'rates']);
  const name = officeText(input.name, 120, true), kind = input.kind;
  if (!['salary', 'piece'].includes(kind) || (previous && previous.kind !== kind)) throw new OfficeError('Personelin çalışma türü oluşturulduktan sonra değiştirilemez.');
  if (input.staff_id && !officeId(input.staff_id)) throw new OfficeError('Üretim personeli seçimi geçersiz.');
  if (!Array.isArray(input.rates) || input.rates.length > 20) throw new OfficeError('Dikim fiyat listesini kontrol edin.');
  const used = new Set();
  input.rates.forEach(row => officeObject(row, ['key', 'amount']));
  const rates = input.rates.filter(row => row.amount !== '').map(row => {
    if (!/^(?:tul|fon):(?:\*|sik|orta|seyrek|amerikan|kapama|s)$/.test(row.key) || used.has(row.key)) throw new OfficeError('Fiyat listesindeki ürün / pile seçimi tekrarlanıyor veya geçersiz.');
    used.add(row.key); return { key: row.key, minor: ledgerMinor(row.amount) };
  });
  return { name, name_key: ledgerNameKey(name), kind, staff_id: input.staff_id || null, monthly_minor: kind === 'salary' && input.monthly_salary !== '' ? ledgerMinor(input.monthly_salary) : null, rates: kind === 'piece' ? rates : [] };
}
export function sewingMeter(sale, job) {
  if (job.snapshot?.kind !== 'textile') return { meter_units: null, rate_key: '', reason: 'Mekanik ürün dikim hakedişine alınmaz.' };
  const index = (sale.sale_items || []).findIndex(item => String(item._id) === String(job.line_id));
  const item = sale.sale_items?.[index], line = sale.pos_details?.cart?.[index];
  if (!item || !line || String(line.product_id) !== String(item.product?._id || item.product) || !['textile', 'fon'].includes(line.mode) || line.unit_label !== 'm' || typeof line.quantity !== 'number' || line.quantity <= 0 || line.quantity > 100000 || Math.abs(line.quantity - Number(item.quantity)) > 0.000001) return { meter_units: null, rate_key: '', reason: 'Kayıtlı kumaş metre hesabı doğrulanamadı; mağaza kontrolü gerekiyor.' };
  const units = Math.round(line.quantity * 10000);
  if (units < 1 || Math.abs(units / 10000 - line.quantity) > 0.000001) return { meter_units: null, rate_key: '', reason: 'Metrajın hassasiyeti kontrol edilmeli.' };
  return { meter_units: units, rate_key: `${line.mode === 'fon' ? 'fon' : 'tul'}:${line.pleat_id || ({ 'Sık pile': 'sik', 'Orta pile': 'orta', 'Seyrek pile': 'seyrek', 'Amerikan pile': 'amerikan', 'Kapama Amerikan pile': 'kapama', 'S pile': 's' }[line.pleat_name]) || '*'}`, reason: '' };
}
export function priceSewing(work, person) {
  if (person.kind !== 'piece' || !work.meter_units) return null;
  const rate = person.rates.find(row => row.key === work.rate_key) || person.rates.find(row => row.key === `${work.rate_key.split(':')[0]}:*`);
  if (!rate) return null;
  const minor = (BigInt(work.meter_units) * BigInt(rate.minor) + 5000n) / 10000n;
  return { amount_minor: minor.toString(), rate_minor: rate.minor };
}
const zeroCash = () => ({ cash: '0', bank: '0', pos: '0' });
export function officeEntry(input, config, person = null, now = new Date()) {
  officeObject(input, ['operation_id', 'type', 'date', 'account', 'to_account', 'amount', 'description', 'person_id', 'period', 'payment_kind', 'expected_person_revision']);
  const operation = officeOperation(input.operation_id), date = officeDate(input.date, config, now), description = officeText(input.description ?? '', 500, true), cash = zeroCash();
  const data = { operation, date, type: input.type, description, person: null, person_delta_minor: '0', cash, amount_minor: '0' };
  if (['income', 'expense', 'transfer', 'payout'].includes(input.type)) {
    if (!['cash', 'bank', 'pos'].includes(input.account)) throw new OfficeError('Nakit / banka / POS hesabını seçin.');
    const amount = ledgerMinor(input.amount); data.amount_minor = amount;
    cash[input.account] = (BigInt(amount) * (input.type === 'income' ? 1n : -1n)).toString();
    if (input.type === 'transfer') { if (!['cash', 'bank', 'pos'].includes(input.to_account) || input.to_account === input.account) throw new OfficeError('Aktarılacak farklı bir hesap seçin.'); cash[input.to_account] = amount; }
    if (input.type === 'payout') { if (!person || input.person_id !== String(person._id) || !['advance', 'salary', 'sewing'].includes(input.payment_kind) || input.account === 'pos') throw new OfficeError('Personeli, ödeme türünü ve nakit / banka hesabını seçin.'); data.person = person._id; data.person_delta_minor = (-BigInt(amount)).toString(); data.payment_kind = input.payment_kind; }
  } else if (['salary', 'earning'].includes(input.type)) {
    if (!person || input.person_id !== String(person._id)) throw new OfficeError('Personeli seçin.');
    data.person = person._id;
    if (input.type === 'salary') {
      if (person.kind !== 'salary' || !person.monthly_minor) throw new OfficeError('Önce personelin aylık maaşını belirleyin.');
      if (input.expected_person_revision !== person.revision) throw new OfficeError('Personelin maaşı değişti. Ekranı yenileyin.', 409);
      if (typeof input.period !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.period) || input.period < config.start_date.slice(0, 7) || input.period > officeToday(now).slice(0, 7)) throw new OfficeError('Geçerli ve gerçekleşmiş bir maaş dönemi seçin.');
      if (input.amount) throw new OfficeError('Maaş tutarı personel kaydından hesaplanır.');
      data.amount_minor = person.monthly_minor; data.source_key = `salary:${person._id}:${input.period}`; data.period = input.period;
    } else data.amount_minor = ledgerMinor(input.amount);
    data.person_delta_minor = data.amount_minor;
  } else throw new OfficeError('Kasa / personel işlem türü geçersiz.');
  data.fingerprint = officeHash({ ...data, operation: undefined }); return data;
}
export function officeReverse(entry, input) {
  officeObject(input, ['operation_id', 'reason']); const operation = officeOperation(input.operation_id), reason = officeText(input.reason, 500, true);
  if (entry.type === 'reversal') throw new OfficeError('Düzeltme kaydı tekrar düzeltilemez.');
  const data = { operation, date: officeToday(), type: 'reversal', description: reason, person: entry.person || null, person_delta_minor: (-BigInt(entry.person_delta_minor)).toString(), cash: Object.fromEntries(Object.entries(entry.cash).map(([key, value]) => [key, (-BigInt(value)).toString()])), amount_minor: entry.amount_minor, reverses: String(entry._id), reversed_type: entry.type };
  if (entry.sewing) data.sewing = entry.sewing;
  data.fingerprint = officeHash({ ...data, operation: undefined }); return data;
}
export const paymentKey = (saleId, payment) => `${saleId}:${payment.request_id}`;
export function cashReceipts(sales, config) {
  const excluded = new Set(config.excluded_payment_keys || []), rows = [];
  for (const sale of sales) for (const payment of sale.payments || []) {
    const key = paymentKey(sale._id, payment); if (excluded.has(key) || payment.paid_date < config.start_date) continue;
    const cash = zeroCash(), minor = Math.round(Number(payment.amount) * 100);
    if (!Number.isSafeInteger(minor) || minor <= 0 || Math.abs(minor / 100 - payment.amount) > 0.0000001 || !/^\d{4}-\d{2}-\d{2}$/.test(payment.paid_date) || !['Nakit', 'Havale / EFT', 'Kredi Kartı', 'Mail Order'].includes(payment.method)) throw new OfficeError('Bir sipariş tahsilatının tutarı / yöntemi doğrulanamadı.', 409);
    const account = { Nakit: 'cash', 'Havale / EFT': 'bank', 'Kredi Kartı': 'pos' }[payment.method];
    if (account && !payment.voided_at) cash[account] = String(minor);
    rows.push({ _id: `receipt:${key}`, date: payment.paid_date, type: payment.method === 'Mail Order' ? 'mail_order' : 'receipt', cash, person_delta_minor: '0', amount_minor: String(minor), description: `${sale.customer_name || 'Müşteri'} · ${payment.kind} · ${payment.method}${payment.company ? ` · ${payment.company}` : ''}${payment.voided_at ? ' · Hatalı kayıt düzeltildi' : ''}`, sale_id: String(sale._id), voided: !!payment.voided_at });
  }
  return rows;
}
export function officeSummary(entries, receipts, config, people) {
  const result = { cash: 0n, bank: 0n, pos: 0n }, staff = new Map(people.map(person => [String(person._id), { balance: 0n, earned: 0n, paid: 0n, meter_units: 0n }]));
  for (const entry of [...entries, ...receipts]) {
    for (const key of Object.keys(result)) result[key] += BigInt(entry.cash[key] || '0');
    const totals = staff.get(String(entry.person)); if (totals) { const delta = BigInt(entry.person_delta_minor || '0'); totals.balance += delta; if (entry.type === 'payout') totals.paid -= delta; else if (entry.type === 'reversal' && entry.reversed_type === 'payout') totals.paid -= delta; else totals.earned += delta; if (entry.type === 'sewing') totals.meter_units += BigInt(entry.sewing.meter_units); if (entry.type === 'reversal' && entry.reversed_type === 'sewing') totals.meter_units -= BigInt(entry.sewing.meter_units); }
  }
  return { accounts: Object.fromEntries(Object.entries(result).map(([key, delta]) => [key, { movement_minor: String(delta), balance_minor: config.openings[key] == null ? null : String(delta + BigInt(config.openings[key])) }])), people: Object.fromEntries([...staff].map(([key, value]) => [key, Object.fromEntries(Object.entries(value).map(([field, amount]) => [field, String(amount)]))])) };
}
