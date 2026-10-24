const key = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[ıIİ]/g, 'i').toLowerCase().trim().replace(/\s+/g, ' ');
const aliases = { 'dmr line': 'dmr', 'oba perdesan': 'oba' };
export const availableMailOrderAccount = account => account.category === 'supplier' && account.currency === 'TRY' && account.opening_status === 'confirmed' && account.balance_minor !== null;
export function matchingMailOrderAccount(accounts, company) {
  const target = aliases[key(company)] || key(company);
  const matches = accounts.filter(account => availableMailOrderAccount(account) && (aliases[key(account.name)] || key(account.name)) === target);
  return matches.length === 1 ? matches[0] : null;
}
