import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { XMLParser } from 'fast-xml-parser';
import User from '../models/User.js';
import Staff from '../models/ProductionStaff.js';
import { ENV } from './env.js';
import router from '../routes/accounting.route.js';
import { uyumsoftConfig, publicInvoiceConnection, invoiceQuery, testInvoiceConnection, listInboxInvoices, UYUMSOFT_ENDPOINT } from './uyumsoftInvoices.js';

const config = uyumsoftConfig({ UYUMSOFT_ENABLED: 'true', UYUMSOFT_USERNAME: 'TEST_ONLY_USER', UYUMSOFT_PASSWORD: 'TEST_ONLY_PASSWORD' });
const input = { start_date: '2026-10-01', end_date: '2026-10-23', page: '0' };
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const wrap = (operation, content) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${operation}Response xmlns="http://tempuri.org/">${content}</${operation}Response></s:Body></s:Envelope>`;
const row = (changes = {}) => `<Items>${Object.entries({ InvoiceId: '11111111-2222-4333-8444-555555555555', DocumentId: 'TEST2026000000001', TargetTcknVkn: '1234567890', TargetTitle: 'ÖRNEK & DENEME', ExecutionDate: '2026-10-22T13:00:00', CreateDateUtc: '2026-10-23T00:00:00Z', PayableAmount: '1200.50', TaxTotal: '200.50', TaxExclusiveAmount: '1000.00', DocumentCurrencyCode: 'TRY', Status: 'Approved', InvoiceTipType: 'Sales', Type: 'BaseInvoice', IsArchived: 'false', ...changes }).map(([k, v]) => `<${k}>${xml(v)}</${k}>`).join('')}</Items>`;
const listXml = (items = row(), attrs = '', success = 'true') => wrap('GetInboxInvoiceList', `<GetInboxInvoiceListResult IsSucceded="${success}"><Value PageIndex="0" PageSize="25" TotalCount="1" TotalPages="1" ${attrs}>${items}</Value></GetInboxInvoiceListResult>`);
const fetchXml = body => async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });

test('accounting connection fails closed and exposes no service credentials', async () => {
  for (const env of [{}, { UYUMSOFT_ENABLED: 'TRUE', UYUMSOFT_USERNAME: 'user', UYUMSOFT_PASSWORD: 'secret' }, { UYUMSOFT_ENABLED: 'true', UYUMSOFT_USERNAME: 'user' }]) {
    const c = uyumsoftConfig(env);
    assert.equal(c.configured, false);
    await assert.rejects(testInvoiceConnection(c, () => { throw Error('must not send'); }), /henüz kurulmadı/);
  }
  assert.deepEqual(publicInvoiceConnection(config), { provider: 'Uyumsoft Kurumsal', configured: true, read_only: true, opening_balances_pending: true });
});

test('date and page validation prevents unbounded or malformed provider queries', () => {
  assert.deepEqual(invoiceQuery(input), { start: '2026-10-01', end: '2026-10-23', page: 0, size: 25 });
  for (const q of [{ start_date: '2026-02-30' }, { start_date: ['2026-01-01'] }, { end_date: '2026-01-01' }, { start_date: '2024-01-01' }, { page: '-1' }, { page: '1e2' }, { page: ['0'] }, { page: '1000000' }]) assert.throws(() => invoiceQuery({ ...input, ...q }));
});

test('HTTPS SOAP requests use the Integration WS-Security contract and never mutate invoice flags', async () => {
  const special = { ...config, username: 'u"<&', password: "p'>&" };
  let captured;
  const result = await listInboxInvoices(input, special, async (url, options) => { captured = { url, options }; return new Response(listXml()); });
  assert.equal(captured.url, UYUMSOFT_ENDPOINT);
  assert.equal(captured.url, 'https://edonusumapi.uyum.com.tr/Services/Integration');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.headers.SOAPAction, '"http://tempuri.org/IIntegration/GetInboxInvoiceList"');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(captured.options.body);
  const request = parsed.Envelope.Body.GetInboxInvoiceList;
  const security = parsed.Envelope.Header.Security;
  assert.equal(security['@_mustUnderstand'], '1');
  assert.equal(security.UsernameToken.Username, special.username);
  assert.equal(security.UsernameToken.Password['#text'], special.password);
  assert.match(security.UsernameToken.Password['@_Type'], /#PasswordText$/);
  assert.equal(Date.parse(security.Timestamp.Expires) - Date.parse(security.Timestamp.Created), 300000);
  assert.ok(Math.abs(Date.now() - Date.parse(security.Timestamp.Created)) < 5000);
  assert.equal(request.userInfo, undefined);
  assert.equal(request.query['@_PageIndex'], '0');
  assert.equal(request.query['@_OnlyNewestInvoices'], 'false');
  assert.equal(request.query.IsArchived['@_nil'], 'true');
  assert.equal(request.query.ExecutionStartDate, '2026-10-01T00:00:00+03:00');
  assert.equal(request.query.ExecutionEndDate, '2026-10-23T23:59:59.9999999+03:00');
  for (const forbidden of ['SetInvoice', 'Mark', 'ArchiveInvoice', 'SendInvoice', 'ChangeInvoice']) assert.ok(!captured.options.body.includes(forbidden));
  assert.equal(result.invoices[0].supplier, 'ÖRNEK & DENEME');
  assert.equal(result.invoices[0].payment_status, 'unknown');
  assert.equal(result.invoices[0].posted_to_ledger, false);
});

test('invoice amounts remain exact decimal strings, including returns and mixed currencies', async () => {
  const rows = row({ PayableAmount: '9999999999999999.12345678' }) + row({ InvoiceId: '66666666-7777-4888-8999-000000000000', PayableAmount: '-20.00', DocumentCurrencyCode: 'EUR', InvoiceTipType: 'Return' });
  const response = listXml(rows).replace('TotalCount="1"', 'TotalCount="2"');
  const result = await listInboxInvoices(input, config, fetchXml(response));
  assert.equal(result.invoices[0].amount, '9999999999999999.12345678');
  assert.equal(result.invoices[1].amount, '-20.00');
  assert.equal(result.invoices[1].currency, 'EUR');
  assert.equal(Object.hasOwn(result, 'balance'), false);
});

test('empty and paginated invoice responses retain the provider totals without creating debts', async () => {
  const empty = listXml('').replace('TotalCount="1"', 'TotalCount="0"').replace('TotalPages="1"', 'TotalPages="0"');
  assert.deepEqual((await listInboxInvoices(input, config, fetchXml(empty))).invoices, []);
  const second = listXml().replace('PageIndex="0"', 'PageIndex="1"').replace('TotalCount="1"', 'TotalCount="26"').replace('TotalPages="1"', 'TotalPages="2"');
  const result = await listInboxInvoices({ ...input, page: '1' }, config, fetchXml(second));
  assert.equal(result.page, 1); assert.equal(result.total_count, 26); assert.equal(result.total_pages, 2);
});

test('malformed amounts, missing supplier identity, duplicate UUIDs and inconsistent pages reject the entire result', async () => {
  const invalid = [listXml(row({ PayableAmount: '1,200.00' })), listXml(row({ TaxTotal: 'NaN' })), listXml(row({ TargetTcknVkn: '' })), listXml(row({ DocumentCurrencyCode: '' })), listXml(row({ ExecutionDate: '2026-02-30T00:00:00' })), listXml(row() + row()).replace('TotalCount="1"', 'TotalCount="2"'), listXml().replace('PageIndex="0"', 'PageIndex="1"'), listXml().replace('TotalCount="1"', 'TotalCount="26"'), listXml('')];
  for (const body of invalid) await assert.rejects(listInboxInvoices(input, config, fetchXml(body)));
});

test('SOAP faults, HTML errors, DTD/entity payloads, oversized responses and timeouts disclose no secrets', async () => {
  const bodies = [wrap('GetInboxInvoiceList', '<s:Fault><faultstring>TEST_ONLY_PASSWORD</faultstring></s:Fault>'), '<html>TEST_ONLY_PASSWORD</html>', '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///private">]>' + listXml(), listXml().replace('IsSucceded="true"', 'IsSucceded="false"'), 'x'.repeat(2 * 1024 * 1024 + 1)];
  for (const body of bodies) await assert.rejects(listInboxInvoices(input, config, fetchXml(body)), error => !error.message.includes('TEST_ONLY_PASSWORD'));
  for (const status of [401, 403, 500]) await assert.rejects(listInboxInvoices(input, config, async () => new Response('TEST_ONLY_PASSWORD', { status })), error => !error.message.includes('TEST_ONLY_PASSWORD'));
  await assert.rejects(listInboxInvoices(input, config, async () => { throw Error('TEST_ONLY_PASSWORD'); }), error => !error.message.includes('TEST_ONLY_PASSWORD'));
});

test('connection testing accepts only the exact successful flag response', async () => {
  const body = wrap('TestConnection', '<TestConnectionResult IsSucceded="true" Value="true"/>');
  let requestBody;
  assert.deepEqual(await testInvoiceConnection(config, async (_, options) => { requestBody = options.body; return new Response(body); }), { connected: true, read_only: true });
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(requestBody);
  assert.match(requestBody, /<TestConnection xmlns="http:\/\/tempuri\.org\/"><\/TestConnection>/);
  assert.equal(parsed.Envelope.Body.TestConnection.userInfo, undefined);
  await assert.rejects(testInvoiceConnection(config, fetchXml(body.replace('Value="true"', 'Value="false"'))));
});

test('financial API requires a real POS administrator; production staff and sales representatives cannot read invoices', async t => {
  const originalSecret = ENV.JWT_SECRET;
  ENV.JWT_SECRET = 'synthetic-invoice-route-secret';
  t.after(() => { ENV.JWT_SECRET = originalSecret; });
  let role = 'Satış Temsilcisi';
  t.mock.method(User, 'findById', () => ({ select: () => ({ populate: async () => ({ _id: '111111111111111111111111', user_username: 'TEST_USER', user_role: { role_name: role } }) }) }));
  t.mock.method(Staff, 'findById', () => ({ lean: async () => ({ _id: '222222222222222222222222', name: 'TEST_STAFF', active: true, session_version: 1, duties: ['cutting'] }) }));
  const app = express(); app.use('/accounting', express.json(), router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/accounting/connection`;
  assert.equal((await fetch(url)).status, 401);
  const token = jwt.sign({ id: '111111111111111111111111' }, ENV.JWT_SECRET);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  const staffToken = jwt.sign({ id: '222222222222222222222222', scope: 'production', aud: 'sahinsoy-production', version: 1 }, ENV.JWT_SECRET);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${staffToken}` } })).status, 403);
  role = 'Yönetici';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const publicStatus = await response.json();
  assert.equal(publicStatus.read_only, true);
  assert.equal(Object.hasOwn(publicStatus, 'password'), false);
});
