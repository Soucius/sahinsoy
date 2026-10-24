import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingMailOrderAccount, availableMailOrderAccount } from './mailOrderAccounts.js';
const a = (id, name, extra = {}) => ({ id, name, category: 'supplier', currency: 'TRY', opening_status: 'confirmed', balance_minor: '100000', ...extra });
test('mail order firm defaults use only unambiguous exact names and known DMR/OBA aliases', () => {
  const accounts = [a('1', 'DMR'), a('2', 'OBA'), a('3', 'Lilium')];
  assert.equal(matchingMailOrderAccount(accounts, 'DMR Line').id, '1');
  assert.equal(matchingMailOrderAccount(accounts, 'OBA Perdesan').id, '2');
  assert.equal(matchingMailOrderAccount(accounts, 'LİLİUM').id, '3');
  assert.equal(matchingMailOrderAccount(accounts, 'AS'), null);
  assert.equal(matchingMailOrderAccount(accounts, 'DMR unknown'), null);
  assert.equal(matchingMailOrderAccount([...accounts, a('4', 'DMR Line')], 'DMR'), null);
});
test('pending, personal and foreign-currency accounts cannot silently receive TL mail orders', () => {
  for (const extra of [{ opening_status: 'pending', balance_minor: null }, { currency: 'EUR' }, { category: 'personal' }]) {
    assert.equal(availableMailOrderAccount(a('1', 'OBA', extra)), false);
    assert.equal(matchingMailOrderAccount([a('1', 'OBA', extra)], 'OBA'), null);
  }
});
