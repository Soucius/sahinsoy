// Each account keeps one physical gold unit. Values are hundredths of that unit,
// never TL; changing a quote must not create a ledger movement.
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
export function goldQuantityValid(code, minor) {
  return !isGoldUnit(code) || GOLD_UNITS[code].unit === 'gram' || BigInt(minor) % 100n === 0n;
}
