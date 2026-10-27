const fold = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[ıIİ]/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, '');
// Explicit legal titles verified in the store's Uyumsoft invoice list. No fuzzy
// substring matching: e.g. OBA and another business containing "oba" stay distinct.
const aliases = [
  { accounts: ['OBA', 'OBA Perdesan'], title: 'OBA PERDESAN TEKNİK TEKSTİL ANONİM ŞİRKETİ' },
  { accounts: ['DMR', 'DMR Line'], title: 'DEMİR DMR TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ' },
  { accounts: ['Lilium', 'Ustaoğlu'], title: 'USTAOĞLU TEKSTİL SAN.VE TİC.LTD.ŞTİ.' },
  { accounts: ['Sebahattin Akyıldız', 'Vicenta Home'], title: 'SEBAHATTİN AKYILDIZ TEKSTİL KONFEKSİYON GIDA MOBİLYA TURİZM İNŞAAT TAAHHÜT NAKLİYAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ' },
  { accounts: ['Storlife'], title: 'STORLİFE PERDE SİSTEMLERİ SAN.VE TİC. LTD. ŞTİ.' },
  { accounts: ['Yurtiçi Kargo'], title: 'Yurtiçi Kargo Servisi A.Ş.' },
  { accounts: ['CK Boğaziçi Elektrik'], title: 'CK BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ ANONİM ŞİRKETİ' },
  { accounts: ['Turkcell'], title: 'Turkcell Iletisim Hizmetleri A.S.' },
];
export function invoiceSuppliers(invoices) {
  const suppliers = new Map();
  for (const invoice of invoices) {
    if (/^\d{10,11}$/.test(invoice.supplier_identifier || '') && invoice.supplier) suppliers.set(invoice.supplier_identifier, { identifier: invoice.supplier_identifier, name: invoice.supplier });
  }
  return [...suppliers.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
export function matchAccountInvoices(account, invoices, selected = '') {
  const suppliers = invoiceSuppliers(invoices);
  const key = fold(account.name), titles = new Set([key]);
  for (const alias of aliases) if (alias.accounts.some(name => fold(name) === key)) titles.add(fold(alias.title));
  const candidates = suppliers.filter(supplier => titles.has(fold(supplier.name)));
  const match = selected ? suppliers.find(supplier => supplier.identifier === selected) : candidates.length === 1 ? candidates[0] : null;
  return { suppliers, matched_supplier: match || null, ambiguous: !selected && candidates.length > 1, invoices: match ? invoices.filter(invoice => invoice.supplier_identifier === match.identifier) : [] };
}
export async function loadInvoicePages(fetchPage, maxPages = 20) {
  const invoices = [], ids = new Set();
  let expectedCount, expectedPages;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(page);
    if (!result || result.page !== page || !Array.isArray(result.invoices) || !Number.isSafeInteger(result.total_pages) || result.total_pages < 0 || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('Fatura sayfalaması doğrulanamadı. Yeniden listeleyin.');
    if (page === 0) { expectedCount = result.total_count; expectedPages = result.total_pages; }
    if (expectedCount !== result.total_count || expectedPages !== result.total_pages) throw new Error('Fatura listesi sorgu sırasında değişti. Yeniden listeleyin.');
    for (const invoice of result.invoices) {
      if (!invoice.id || ids.has(invoice.id)) throw new Error('Fatura listesinde yinelenen veya eksik kayıt var. Yeniden listeleyin.');
      ids.add(invoice.id); invoices.push(invoice);
    }
    if (invoices.length > expectedCount) throw new Error('Fatura sayısı doğrulanamadı. Yeniden listeleyin.');
    if (page + 1 >= expectedPages) {
      if (invoices.length !== expectedCount) throw new Error('Fatura listesi eksik geldi. Yeniden listeleyin.');
      return { invoices, complete: true, source_count: expectedCount };
    }
    if (!result.invoices.length) throw new Error('Fatura sayfası eksik geldi. Yeniden listeleyin.');
  }
  return { invoices, complete: false, source_count: expectedCount };
}
