import { InvoiceConnectionError, uyumsoftConfig, publicInvoiceConnection, testInvoiceConnection, listInboxInvoices } from '../libs/uyumsoftInvoices.js';

const activeReads = new Set();
async function read(req, res, action) {
  const actor = req.productionActor?._id;
  if (activeReads.has(actor)) return res.status(429).json({ message: 'Önceki Uyumsoft sorgusu sürüyor. Tamamlanmasını bekleyin.' });
  activeReads.add(actor);
  res.set('Cache-Control', 'no-store');
  try { return res.json(await action()); }
  catch (error) {
    return res.status(error instanceof InvoiceConnectionError ? error.status : 502).json({ message: error instanceof InvoiceConnectionError ? error.message : 'Fatura bağlantısı kontrol edilemedi. Liste değiştirilmedi.' });
  } finally { activeReads.delete(actor); }
}
export function getAccountingConnection(_req, res) { res.set('Cache-Control', 'no-store'); return res.json(publicInvoiceConnection(uyumsoftConfig())); }
export function checkAccountingConnection(req, res) { return read(req, res, () => testInvoiceConnection()); }
export function getInboxInvoices(req, res) { return read(req, res, () => listInboxInvoices(req.query)); }
