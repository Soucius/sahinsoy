export const PRODUCTION_ADMIN_ROLES = ['Admin', 'Yönetici', 'Test Yöneticisi', 'Sistem Yöneticisi'];
export const isProductionAdmin = (user) => PRODUCTION_ADMIN_ROLES.some(name => name.toLocaleLowerCase('tr-TR') === String(user?.user_role?.role_name || '').toLocaleLowerCase('tr-TR'));
export const STAFF_PRESETS = [
  { name: 'Nevzat', username: 'nevzat', duties: ['cutting', 'sewing', 'installation'] },
  { name: 'Nurten', username: 'nurten', duties: ['sewing'] },
  { name: 'Hayati', username: 'hayati', duties: ['cutting', 'sewing'] },
];
export const DUTIES = { cutting: 'Kesim', sewing: 'Dikim', installation: 'Montaj' };
// One stable key for Turkish names, regardless of casing or repeated spaces.
export const cleanStaffName = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
export const staffLoginKey = value => cleanStaffName(value).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
// Also matches accounts created before full-name login, without rewriting their credentials.
export const staffNamePattern = value => `^\\s*${cleanStaffName(value).split(' ').map(part => [...part].map(char => /[iıİI]/u.test(char) ? '[iıİI]' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')).join('\\s+')}\\s*$`;
