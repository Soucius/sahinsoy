import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceAccountMatch, invoiceAutoPlan } from './invoiceAutoLedger.js';
import { matchAccountInvoices } from '../../../frontend/src/libs/accountInvoices.js';
const titles = {
  usta: 'USTA PERDE SİSTEMLERİ SANAYİ VE TİCARET LTD.ŞTİ',
  lilium: 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.',
  vicenta: 'SEBAHATTİN AKYILDIZ TEKSTİL KONFEKSİYON GIDA MOBİLYA TURİZM İNŞAAT TAAHHÜT NAKLİYAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
};
const rows = Object.entries(titles).map(([id, supplier], index) => ({ id, supplier, supplier_identifier: String(index + 1).repeat(10), currency: 'TRY' }));
const account = (name, id = 'A') => ({ _id: id, name, currency: 'TRY', category: 'supplier' });
test('Teleda account labels resolve identically in display and automatic posting', () => {
  for (const name of ['usta perde (teleda)', 'Usta Perde', 'Teleda', 'TELEDA TEKSTİL', 'Usta Perde (Teleda Tekstil)']) {
    const a = account(name);
    assert.equal(invoiceAccountMatch(rows[0], [a], rows), a);
    assert.deepEqual(matchAccountInvoices(a, rows).invoices.map(row => row.id), ['usta']);
  }
});
test('Usta, Ustaoğlu/Lilium and Sebahattin/Vicenta remain different supplier identities', () => {
  const accounts = [account('usta perde (teleda)', 'A'), account('Lilium', 'B'), account('Sebahattin Akyıldız', 'C')];
  for (let index = 0; index < rows.length; index++) {
    assert.equal(invoiceAccountMatch(rows[index], accounts, rows), accounts[index]);
    assert.deepEqual(matchAccountInvoices(accounts[index], rows).invoices.map(row => row.id), [rows[index].id]);
  }
  assert.deepEqual(matchAccountInvoices(account('Vicenta Home'), rows).invoices.map(row => row.id), ['vicenta']);
  assert.equal(invoiceAccountMatch(rows[0], [account('Usta başka firma')], rows), null);
  assert.equal(invoiceAccountMatch(rows[1], [account('Usta Perde')], rows), null);
});
test('duplicate accounts, ambiguous tax identity and currency mismatch never silently post', () => {
  const a = account('usta perde (teleda)');
  assert.equal(invoiceAccountMatch(rows[0], [a, account('Teleda', 'B')], rows), null);
  const ambiguous = [...rows, { ...rows[0], id: 'duplicate', supplier_identifier: '9999999999' }];
  assert.equal(invoiceAccountMatch(rows[0], [a], ambiguous), null);
  assert.equal(matchAccountInvoices(a, ambiguous).matched_supplier, null);
  assert.equal(invoiceAccountMatch(rows[0], [{ ...a, currency: 'USD' }], rows), null);
});
test('alias does not bypass pending approval, original cutover or opening balance protection', () => {
  const a = { ...account('usta perde (teleda)'), opening_status: 'confirmed', opening_date: '2026-10-29', balance_minor: '202752', revision: 1, entries: [] };
  const invoice = { ...rows[0], id: '00000000-0000-4000-8000-000000000001', number: 'SYNTHETIC', date: '2026-10-27', amount: '2027.52', status: 'WaitingForAprovement', type: 'Sales' };
  const now = new Date('2026-10-29T10:00:00Z');
  assert.throws(() => invoiceAutoPlan(invoice, a, '2026-10-28', {}, now), /başlangıç/);
  assert.throws(() => invoiceAutoPlan({ ...invoice, date: '2026-10-29' }, a, '2026-10-28', {}, now), /onaylı/);
  assert.throws(() => invoiceAutoPlan({ ...invoice, date: '2026-10-29', status: 'Approved' }, a, '2026-10-28', {}, now), /açılış tarihinde/);
  assert.equal(a.balance_minor, '202752'); assert.deepEqual(a.entries, []);
});
