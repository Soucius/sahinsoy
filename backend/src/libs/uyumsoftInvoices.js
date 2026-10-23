import { XMLParser, XMLValidator } from 'fast-xml-parser';

// Uyumsoft Kurumsal HTTPS Integration WSDL, retrieved 2026-10-23.
// This adapter exposes only TestConnection and GetInboxInvoiceList.
export const UYUMSOFT_ENDPOINT = 'https://edonusumapi.uyum.com.tr/Services/Integration';
const NS = 'http://tempuri.org/';
const MAX_BYTES = 2 * 1024 * 1024;
const text = value => typeof value === 'string' ? value.trim() : '';
export class InvoiceConnectionError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function uyumsoftConfig(env = process.env) {
  const username = text(env.UYUMSOFT_USERNAME);
  const password = typeof env.UYUMSOFT_PASSWORD === 'string' ? env.UYUMSOFT_PASSWORD : '';
  return { username, password, enabled: env.UYUMSOFT_ENABLED === 'true', configured: env.UYUMSOFT_ENABLED === 'true' && !!username && !!password };
}
export const publicInvoiceConnection = config => ({ provider: 'Uyumsoft Kurumsal', configured: config.configured, read_only: true, opening_balances_pending: true });
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function invoiceQuery(input = {}) {
  if (!validDate(input.start_date) || !validDate(input.end_date)) throw new InvoiceConnectionError('Başlangıç ve bitiş tarihini kontrol edin.', 400);
  const days = (Date.parse(input.end_date) - Date.parse(input.start_date)) / 86400000;
  if (days < 0 || days > 366) throw new InvoiceConnectionError('En fazla bir yıllık, sıralı bir tarih aralığı seçin.', 400);
  const rawPage = input.page ?? '0';
  if (typeof rawPage !== 'string' || !/^(0|[1-9]\d{0,5})$/.test(rawPage)) throw new InvoiceConnectionError('Sayfa numarası geçersiz.', 400);
  return { start: input.start_date, end: input.end_date, page: Number(rawPage), size: 25 };
}
const xmlAttribute = value => {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new InvoiceConnectionError('Bağlantı bilgileri doğrulanamadı.', 503);
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
};
function envelope(operation, config, query) {
  const params = query ? `<query PageIndex="${query.page}" PageSize="${query.size}" OnlyNewestInvoices="false"><ExecutionStartDate>${query.start}T00:00:00+03:00</ExecutionStartDate><ExecutionEndDate>${query.end}T23:59:59.9999999+03:00</ExecutionEndDate><CreateStartDate i:nil="true"/><CreateEndDate i:nil="true"/><Status i:nil="true"/><SortColumn>ExecutionDate</SortColumn><SortMode>Descending</SortMode><IsArchived i:nil="true"/><IncludeTagList>false</IncludeTagList></query>` : '';
  const created = new Date();
  const expires = new Date(created.getTime() + 300000);
  const security = `<o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><u:Timestamp u:Id="Timestamp"><u:Created>${created.toISOString()}</u:Created><u:Expires>${expires.toISOString()}</u:Expires></u:Timestamp><o:UsernameToken u:Id="UsernameToken"><o:Username>${xmlAttribute(config.username)}</o:Username><o:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlAttribute(config.password)}</o:Password></o:UsernameToken></o:Security>`;
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><s:Header>${security}</s:Header><s:Body><${operation} xmlns="${NS}">${params}</${operation}></s:Body></s:Envelope>`;
}
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true });
function parseResponse(xml, operation) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new InvoiceConnectionError('Uyumsoft yanıtı doğrulanamadı. Liste aktarılmadı.');
  let data;
  try { data = parser.parse(xml); } catch { throw new InvoiceConnectionError('Uyumsoft yanıtı okunamadı. Liste aktarılmadı.'); }
  const body = data.Envelope?.Body;
  if (body?.Fault) throw new InvoiceConnectionError('Uyumsoft servis isteğini kabul etmedi. Servis hesabını ve yetkilerini kontrol edin.');
  const result = body?.[`${operation}Response`]?.[`${operation}Result`];
  if (!result || result['@_IsSucceded'] !== 'true') throw new InvoiceConnectionError('Uyumsoft bağlantısı doğrulanamadı. Web servis hesabının bilgilerini ve yetkilerini kontrol edin.');
  return result;
}
async function readXml(response) {
  if (!response.body?.getReader) throw new InvoiceConnectionError('Uyumsoft yanıtı okunamadı.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new InvoiceConnectionError('Uyumsoft yanıtı çok büyük. Daha dar bir tarih aralığı seçin.'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally { reader.releaseLock(); }
}
async function call(operation, config, query, fetchImpl) {
  if (!config.configured) throw new InvoiceConnectionError('Uyumsoft web servis bağlantısı henüz kurulmadı.', 503);
  try {
    const response = await fetchImpl(UYUMSOFT_ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}IIntegration/${operation}"` }, body: envelope(operation, config, query) });
    if (!response.ok) throw new InvoiceConnectionError(`Uyumsoft servis isteği kabul edilmedi (HTTP ${response.status}). Servis hesabını ve erişim yetkisini kontrol edin.`);
    return parseResponse(await readXml(response), operation);
  } catch (error) {
    if (error instanceof InvoiceConnectionError) throw error;
    throw new InvoiceConnectionError('Uyumsoft yanıt vermedi. Liste değiştirilmedi; tekrar deneyebilirsiniz.');
  }
}
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
function decimal(value) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/.test(value)) throw new InvoiceConnectionError('Faturanın tutarı doğrulanamadı. Liste aktarılmadı.');
  return value;
}
const integer = value => typeof value === 'string' && /^(0|[1-9]\d{0,8})$/.test(value) ? Number(value) : null;
function invoiceRow(row) {
  if (!uuid(row?.InvoiceId) || !text(row.DocumentId) || !text(row.TargetTitle) || !/^\d{10,11}$/.test(row.TargetTcknVkn || '') || !/^[A-Z]{3}$/.test(row.DocumentCurrencyCode || '') || !/^\d{4}-\d{2}-\d{2}T/.test(row.ExecutionDate || '') || !validDate(row.ExecutionDate.slice(0, 10))) throw new InvoiceConnectionError('Fatura bilgileri eksik veya beklenmeyen biçimde. Liste aktarılmadı.');
  return { id: row.InvoiceId.toLowerCase(), number: row.DocumentId, supplier: row.TargetTitle, supplier_identifier: row.TargetTcknVkn, date: row.ExecutionDate.slice(0, 10), created_at: text(row.CreateDateUtc), amount: decimal(row.PayableAmount), tax: decimal(row.TaxTotal), tax_exclusive: decimal(row.TaxExclusiveAmount), currency: row.DocumentCurrencyCode, status: text(row.Status), type: text(row.InvoiceTipType), scenario: text(row.Type), archived: row.IsArchived === 'true', payment_status: 'unknown', posted_to_ledger: false };
}
export async function testInvoiceConnection(config = uyumsoftConfig(), fetchImpl = fetch) {
  const result = await call('TestConnection', config, null, fetchImpl);
  if (result['@_Value'] !== 'true') throw new InvoiceConnectionError('Uyumsoft web servis hesabı bağlantıyı doğrulamadı.');
  return { connected: true, read_only: true };
}
export async function listInboxInvoices(input, config = uyumsoftConfig(), fetchImpl = fetch) {
  const query = invoiceQuery(input);
  const result = await call('GetInboxInvoiceList', config, query, fetchImpl);
  const value = result.Value;
  const page = integer(value?.['@_PageIndex']), size = integer(value?.['@_PageSize']), total = integer(value?.['@_TotalCount']), pages = integer(value?.['@_TotalPages']);
  if (page !== query.page || size !== query.size || total === null || pages === null || (total > 0 && pages !== Math.ceil(total / query.size)) || (total === 0 && pages > 1)) throw new InvoiceConnectionError('Uyumsoft sayfalama bilgisi doğrulanamadı. Liste aktarılmadı.');
  const items = value.Items === undefined ? [] : Array.isArray(value.Items) ? value.Items : [value.Items];
  if (items.length > query.size || items.length > total || (items.length === 0 && total > 0 && page < pages)) throw new InvoiceConnectionError('Uyumsoft listesi eksik görünüyor. Liste aktarılmadı.');
  const invoices = items.map(invoiceRow);
  if (new Set(invoices.map(i => i.id)).size !== invoices.length) throw new InvoiceConnectionError('Listede yinelenen fatura var. Liste aktarılmadı.');
  return { invoices, page, page_size: size, total_count: total, total_pages: pages, read_only: true, opening_balances_pending: true };
}
