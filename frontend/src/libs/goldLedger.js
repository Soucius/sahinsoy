export const GOLD_UNITS = {
  GOLD_GRAM: { label: 'Gram altın', unit: 'gram', provider_code: 'KULCEALTIN' },
  GOLD_HAS: { label: 'Has altın', unit: 'gram', provider_code: 'ALTIN' },
  GOLD_22: { label: '22 ayar altın', unit: 'gram', provider_code: 'AYAR22' },
  GOLD_QUARTER_NEW: { label: 'Çeyrek altın · yeni', unit: 'adet', provider_code: 'CEYREK_YENI' },
  GOLD_QUARTER_OLD: { label: 'Çeyrek altın · eski', unit: 'adet', provider_code: 'CEYREK_ESKI' },
  GOLD_HALF_NEW: { label: 'Yarım altın · yeni', unit: 'adet', provider_code: 'YARIM_YENI' },
  GOLD_HALF_OLD: { label: 'Yarım altın · eski', unit: 'adet', provider_code: 'YARIM_ESKI' },
  GOLD_FULL_NEW: { label: 'Tam altın · yeni', unit: 'adet', provider_code: 'TEK_YENI' },
  GOLD_FULL_OLD: { label: 'Tam altın · eski', unit: 'adet', provider_code: 'TEK_ESKI' },
  GOLD_ATA_NEW: { label: 'Ata altın · yeni', unit: 'adet', provider_code: 'ATA_YENI' },
  GOLD_ATA_OLD: { label: 'Ata altın · eski', unit: 'adet', provider_code: 'ATA_ESKI' },
};
export const isGoldUnit = code => Object.hasOwn(GOLD_UNITS, code);
export const goldQuantityValid = (code, minor) => !isGoldUnit(code) || GOLD_UNITS[code].unit === 'gram' || BigInt(minor) % 100n === 0n;
export function goldQuantity(minor, code) {
  const value = BigInt(minor), absolute = value < 0n ? -value : value;
  const fraction = String(absolute % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${value < 0n ? '−' : ''}${(absolute / 100n).toLocaleString('tr-TR')}${fraction ? `,${fraction}` : ''} ${GOLD_UNITS[code].unit} ${GOLD_UNITS[code].label}`;
}
export function freshGoldQuote(data, code, now = Date.now()) {
  return isGoldUnit(code) ? freshLedgerQuote(data, code, now) : null;
}
export const isValuedUnit = code => ['USD', 'EUR'].includes(code) || isGoldUnit(code);
export function freshLedgerQuote(data, code, now = Date.now()) {
  if (!isValuedUnit(code) || data?.source !== 'Harem' || data.rate_type !== 'Selling') return null;
  const rate = data.rates?.[code], timestamp = Date.parse(data.rate_times?.[code]);
  const age = now - timestamp;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 100000 || !Number.isFinite(age) || age > 300000 || age < -120000) return null;
  return { rate, timestamp };
}
export function goldTryMinor(minor, rate) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100000) throw new Error('Geçersiz altın kuru');
  const scaled = BigInt(rate.toFixed(8).replace('.', ''));
  const quantity = BigInt(minor), sign = quantity < 0n ? -1n : 1n;
  return (((quantity * sign * scaled + 50000000n) / 100000000n) * sign).toString();
}

export function ledgerValuation(accounts, data, now = Date.now()) {
  const grouped = {}, result = { debt: { total_minor: '0', complete: true, parts: [] }, receivable: { total_minor: '0', complete: true, parts: [] }, pending_count: 0 };
  for (const account of accounts) {
    if (account.balance_minor === null || account.opening_status === 'pending') { result.pending_count++; continue; }
    const balance = BigInt(account.balance_minor);
    if (!balance) continue;
    grouped[account.currency] ??= { debt: 0n, receivable: 0n };
    grouped[account.currency][balance > 0n ? 'debt' : 'receivable'] += balance > 0n ? balance : -balance;
  }
  for (const [currency, values] of Object.entries(grouped)) {
    for (const side of ['debt', 'receivable']) {
      if (!values[side]) continue;
      const quote = currency === 'TRY' ? null : freshLedgerQuote(data, currency, now);
      const value = currency === 'TRY' ? values[side].toString() : quote ? goldTryMinor(values[side], quote.rate) : null;
      if (value === null) result[side].complete = false;
      else result[side].total_minor = (BigInt(result[side].total_minor) + BigInt(value)).toString();
      result[side].parts.push({ currency, quantity_minor: values[side].toString(), try_minor: value, quote });
    }
  }
  return result;
}
