import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInvoicePages, matchAccountInvoices } from '../../../frontend/src/libs/accountInvoices.js';

const row = (id, supplier, identifier) => ({ id, number: `SYNTHETIC-${id}`, supplier, supplier_identifier: identifier, date: '2026-10-26', amount: '100.00', currency: 'TRY' });
const oba = id => row(id, 'OBA PERDESAN TEKNİK TEKSTİL ANONİM ŞİRKETİ', '1111111111');
const dmr = id => row(id, 'DEMİR DMR TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ', '2222222222');

test('OBA current account resolves to its verified legal title and only that supplier identity', () => {
  const invoices = [oba('1'), dmr('2'), oba('3'), row('4', 'KOBA TEKSTİL', '3333333333')], original = structuredClone(invoices);
  const match = matchAccountInvoices({ name: 'oba' }, invoices);
  assert.equal(match.matched_supplier.identifier, '1111111111');
  assert.deepEqual(match.invoices.map(invoice => invoice.id), ['1', '3']);
  assert.deepEqual(invoices, original);
  assert.equal(matchAccountInvoices({ name: 'OBA başka firma' }, invoices).matched_supplier, null);
});

test('DMR Lilium and exact person titles work without guessing partial supplier names', () => {
  assert.equal(matchAccountInvoices({ name: 'DMR' }, [dmr('1')]).invoices.length, 1);
  const lilium = row('2', 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.', '4444444444');
  assert.equal(matchAccountInvoices({ name: 'LİLİUM' }, [lilium]).invoices.length, 1);
  assert.equal(matchAccountInvoices({ name: 'Serhat Kartal' }, [row('3', 'SERHAT KARTAL', '55555555555')]).invoices.length, 1);
  assert.equal(matchAccountInvoices({ name: 'Serhat' }, [row('3', 'SERHAT KARTAL', '55555555555')]).invoices.length, 0);
});

test('two legal entities with the same title require an explicit selection, never a silent merge', () => {
  const invoices = [oba('1'), { ...oba('2'), supplier_identifier: '6666666666' }];
  const ambiguous = matchAccountInvoices({ name: 'OBA' }, invoices);
  assert.equal(ambiguous.ambiguous, true); assert.equal(ambiguous.matched_supplier, null);
  assert.equal(ambiguous.invoices.length, 0);
  const selected = matchAccountInvoices({ name: 'OBA' }, invoices, '6666666666');
  assert.deepEqual(selected.invoices.map(invoice => invoice.id), ['2']);
  assert.equal(matchAccountInvoices({ name: 'OBA' }, invoices, '9999999999').matched_supplier, null);
});

test('all pages are read before matching so older company invoices are not silently omitted', async () => {
  const pages = [];
  const result = await loadInvoicePages(async page => { pages.push(page); return { page, total_count: 3, total_pages: 2, invoices: page === 0 ? [dmr('1'), oba('2')] : [oba('3')] }; });
  assert.deepEqual(pages, [0, 1]); assert.equal(result.complete, true);
  assert.deepEqual(matchAccountInvoices({ name: 'OBA' }, result.invoices).invoices.map(invoice => invoice.id), ['2', '3']);
});

test('partial, changing and duplicated lists cannot masquerade as a complete invoice history', async () => {
  for (const mode of ['duplicate', 'changed', 'empty']) {
    await assert.rejects(loadInvoicePages(async page => ({ page, total_count: mode === 'changed' && page ? 3 : 2, total_pages: 2, invoices: page === 0 ? [oba('1')] : mode === 'empty' ? [] : [oba(mode === 'duplicate' ? '1' : '2')] })));
  }
  const bounded = await loadInvoicePages(async page => ({ page, total_count: 1000, total_pages: 40, invoices: [oba(String(page))] }), 2);
  assert.equal(bounded.complete, false); assert.equal(bounded.source_count, 1000); assert.equal(bounded.invoices.length, 2);
  await assert.rejects(loadInvoicePages(async () => { throw new Error('Synthetic service unavailable'); }), /Synthetic service unavailable/);
});

test('empty results remain explicit and original invoice currency/status are preserved', async () => {
  const empty = await loadInvoicePages(async page => ({ page, total_count: 0, total_pages: 0, invoices: [] }));
  assert.equal(empty.complete, true); assert.equal(empty.invoices.length, 0);
  const invoice = { ...oba('1'), currency: 'USD', status: 'WaitingForAprovement' };
  const account = { name: 'OBA', balance_minor: '10000', currency: 'TRY' }, before = structuredClone(account);
  const match = matchAccountInvoices(account, [invoice]);
  assert.equal(match.invoices[0].currency, 'USD'); assert.equal(match.invoices[0].status, 'WaitingForAprovement');
  assert.deepEqual(account, before);
});
