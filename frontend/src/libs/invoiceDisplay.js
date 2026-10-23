export const invoiceStatus = status => ({ Approved: 'Onaylandı', WaitingForAprovement: 'Onay bekliyor', Declined: 'Reddedildi', Canceled: 'İptal', EArchivedCanceled: 'e-Arşiv iptal', Return: 'İade', Error: 'Hata', Draft: 'Taslak', SentToGib: 'GİB’e iletildi', Processing: 'İşleniyor', Queued: 'Kuyrukta' })[status] || status || 'Belirtilmedi';
export const invoiceType = type => ({ Sales: 'Satış', Return: 'İade', Tax: 'Tevkifat', WithholdingReturn: 'Tevkifat iade', Exception: 'İstisna' })[type] || type || 'Belirtilmedi';
export function invoiceAmount(amount, currency) {
  if (typeof amount !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(amount)) return 'Tutar doğrulanamadı';
  const negative = amount.startsWith('-');
  const [whole, rawFraction = ''] = amount.replace(/^-/, '').split('.');
  const fraction = rawFraction.replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction} ${currency === 'TRY' ? 'TL' : currency}`;
}
export const invoiceDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : 'Belirtilmedi';
