import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceAmount, invoiceDate, invoiceStatus, invoiceType } from './invoiceDisplay.js';
test('invoice totals display exact original decimal strings without currency conversion or rounding', () => {
  assert.equal(invoiceAmount('9999999999999999.12345678', 'TRY'), '9.999.999.999.999.999,12345678 TL');
  assert.equal(invoiceAmount('-1200.00', 'EUR'), '−1.200,00 EUR');
  assert.equal(invoiceAmount('0.1', 'USD'), '0,10 USD');
  assert.equal(invoiceAmount('20', 'TRY'), '20,00 TL');
  assert.equal(invoiceAmount('NaN', 'TRY'), 'Tutar doğrulanamadı');
});
test('invoice document approval is never labelled as a payment', () => {
  assert.equal(invoiceStatus('Approved'), 'Onaylandı');
  assert.equal(invoiceStatus('WaitingForAprovement'), 'Onay bekliyor');
  assert.equal(invoiceType('Return'), 'İade');
  assert.equal(invoiceDate('2026-10-23'), '23.10.2026');
});
