export const PRODUCTION_ADMIN_ROLES = ['Admin', 'Yönetici', 'Test Yöneticisi', 'Sistem Yöneticisi'];
export const isProductionAdmin = (user) => PRODUCTION_ADMIN_ROLES.some(name => name.toLocaleLowerCase('tr-TR') === String(user?.user_role?.role_name || '').toLocaleLowerCase('tr-TR'));
export const STAFF_PRESETS = [
  { name: 'Nevzat', username: 'nevzat', duties: ['cutting', 'sewing', 'installation'] },
  { name: 'Nurten', username: 'nurten', duties: ['sewing'] },
  { name: 'Hayati', username: 'hayati', duties: ['cutting', 'sewing'] },
];
export const DUTIES = { cutting: 'Kesim', sewing: 'Dikim', installation: 'Montaj' };
