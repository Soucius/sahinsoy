import { normalizeName, validateProductDimensions } from "./curtainCalculation.js";
export { isAutomationCategoryName } from "./posCatalogGroup.js";

// These are supplier catalogue codes, never database IDs or a price table.
// Applications follow the OBA May 2026 list, pages 11–13.
const STOR_MOTORS = [22001, 22002, 22003, 22004, 22005, 22006, 22007, 22008, 22009, 22016, 22017, 22018, 22019, 22020, 22021, 22022, 22023, 22024];
const ZEBRA_MOTORS = [22001, 22004, 22006, 22007, 22008, 22009, 22020, 22021, 22022, 22023, 22024];
const WOOD_50_MOTORS = [22029, 22030, 22031, 22032, 22033, 22034, 22035, 22036, 22038, 22039, 22040, 22041, 22042, 22043];
const TRUWOOD_50_MOTORS = WOOD_50_MOTORS.filter((code) => code !== 22035 && code !== 22036);
const WOOD_25_MOTORS = [22037, 22044];
const MICRO_MOTORS = [22048, 22049];
const MOTOR_APPLICATIONS = {
  stor: STOR_MOTORS, zebra: ZEBRA_MOTORS, wood50: WOOD_50_MOTORS,
  truwood50: TRUWOOD_50_MOTORS, wood25: WOOD_25_MOTORS,
  truwood25: WOOD_25_MOTORS, micro: MICRO_MOTORS,
};

const BASE_CODES = new Map([
  [20046, 20044], [20047, 20045], [20050, 20048], [20051, 20049],
  [20054, 20052], [20055, 20053], [20059, 20057], [20060, 20058],
]);
const UNPRICED_BASE_CODES = new Set([20043, 20056, 20067]);
const nameOf = (record) => String(record?.product_name || record?.name || "");
const categoryOf = (record) => normalizeName(record?.product_category?.category_name || record?.category_name || record?.category);
const isOba = (record) => normalizeName(record?.product_brand?.brand_name || record?.brand_name || record?.brand).replace(/\s+/g, "") === "obaperdesan";
const isSquareMetre = (record) => (record?.calculation_type || record?.calc_type) === "m2" || record?.unit === "Metrekare";
const optionName = (option) => typeof option === "string" ? option : String(option?.option_name || "");

function catalogCode(record) {
  for (const value of [record?.catalog_id, record?.product_barcode]) {
    const match = String(value || "").match(/^(?:CAT-)?URUN-(\d{4,6})$/);
    if (match) return Number(match[1]);
  }
  return null;
}

function parentFamily(product) {
  if (!product || !isOba(product) || !isSquareMetre(product) || /egim/.test(normalizeName(nameOf(product)))) return null;
  const category = categoryOf(product);
  if (category === "stor") return "stor";
  if (category === "zebra") return "zebra";
  if (category !== "jaluzi") return null;
  const name = normalizeName(nameOf(product));
  // Ahşap desenli mikro is aluminium, not the wooden-jaluzi application.
  if (/mikro|aluminyum/.test(name)) return "micro";
  const material = /truwood/.test(name) ? "truwood" : /ahsap/.test(name) ? "wood" : "";
  const slat = name.match(/(?:^|\D)(25|50)\s*mm(?:\D|$)/)?.[1];
  return material && slat ? `${material}${slat}` : null;
}

export function supportsMotorSystem(parent) {
  return parentFamily(parent) !== null;
}

export function motorCandidates(parent, products = []) {
  const allowed = MOTOR_APPLICATIONS[parentFamily(parent)];
  if (!allowed || !Array.isArray(products)) return [];
  return products.filter((product) => isOba(product)
    && (product.calculation_type || product.calc_type || (product.unit === "Adet" ? "adet" : "")) === "adet"
    && allowed.includes(catalogCode(product)));
}

export function shortMotorName(product) {
  let name = nameOf(product);
  if ([22008, 22009].includes(catalogCode(product))) name = name.replace(/(Şarjlı\s+)6\/28/i, "$15/28");
  return name.replace(/\s*—\s*Stor(?:\s*\/\s*Zebra)?\s*/i, " · ")
    .replace(/\s*—\s*Ahşap\s*\/\s*Truwood\s*Jaluzi\s*/i, " · ")
    .replace(/\s*—\s*Ahşap\s*Jaluzi\s*/i, " · ")
    .replace(/\s*—\s*Alüminyum\s*Jaluzi/i, " · Mikro jaluzi")
    .replace(/\s*—\s*(\d+)lik boru\s*$/i, " · $1 mm boru").trim();
}

function optionGroup(option) {
  const name = normalizeName(optionName(option));
  if (/kasa\s*\/\s*donanim\s*rengi|kasa\s*rengi|kapali\s*kasa/.test(name)) return "kasa";
  if (/zincir/.test(name)) return "zincir";
  if (/etek|boncuk|lazer|isleme/.test(name)) return "etek";
  if (/new\s*tech|mekanizma|reduktor|\bboru\b/.test(name)) return "mechanism";
  return "other";
}

export function mechanismGroups(product) {
  const groups = [
    { key: "mechanism", label: "Mekanizmalar", options: [] },
    { key: "kasa", label: "Kasa ve renk", options: [] },
    { key: "etek", label: "Etek ve çıta", options: [] },
    { key: "zincir", label: "Zincir", options: [] },
    { key: "other", label: "Diğer seçenekler", options: [] },
  ];
  for (const [index, option] of (product?.extra_options || []).entries()) {
    groups.find((group) => group.key === optionGroup(option)).options.push({ option, index, label: optionName(option) });
  }
  return groups.filter((group) => group.options.length);
}

export function manualMechanismIndices(product) {
  return (product?.extra_options || []).flatMap((option, index) => optionGroup(option) === "mechanism" ? [index] : []);
}

export function isMotorIncompatibleOption(option) {
  return /egim/.test(normalizeName(optionName(option)));
}

export function sanitizedMechanicalIndices(product, indices = [], { motorized = false } = {}) {
  if (!Array.isArray(indices)) throw new Error("Aksesuar seçimlerini kontrol edin.");
  const options = product?.extra_options || [];
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) throw new Error("Aksesuar seçimlerini kontrol edin.");
  const unique = [...new Set(indices)];
  if (motorized) return unique.filter((index) => !["mechanism", "zincir"].includes(optionGroup(options[index])));
  const hasNewTech = unique.some((index) => /new\s*tech/.test(normalizeName(optionName(options[index]))));
  if (!hasNewTech) return unique;
  // New Tech already includes the 38 mm mechanism/tube and square metal hem.
  return unique.filter((index) => {
    const name = normalizeName(optionName(options[index]));
    if (/new\s*tech/.test(name)) return true;
    return !(/38\s*['’]?\s*(?:lik|mm)?.*(?:mekanizma|reduktor|boru)/.test(name)
      || /kare.*(?:aluminyum|metal).*etek|kare.*etek.*(?:aluminyum|metal)/.test(name));
  });
}

export function motorizedBaseProduct(selected, allProducts = []) {
  if (!supportsMotorSystem(selected)) return null;
  const code = catalogCode(selected);
  const targetCode = BASE_CODES.get(code);
  if (targetCode !== undefined) {
    return Array.isArray(allProducts) ? allProducts.find((product) => catalogCode(product) === targetCode
      && parentFamily(product) === parentFamily(selected)
      && !/reduktor/.test(normalizeName(nameOf(product)))) || null : null;
  }
  if (UNPRICED_BASE_CODES.has(code) || /reduktor/.test(normalizeName(nameOf(selected)))) return null;
  return selected;
}

const rejection = (reason) => ({ eligible: false, reason });

export function motorEligibility(parent, motor, panels, { extra_indices = [] } = {}) {
  const family = parentFamily(parent);
  if (!family) return rejection("Bu ürün için doğrulanmış motorlu sistem bulunmuyor.");
  if (!motorCandidates(parent, [motor]).length) return rejection("Bu motor seçilen perde türüne uygun değil.");
  if (!Array.isArray(extra_indices) || extra_indices.some((index) => isMotorIncompatibleOption(parent.extra_options?.[index]))) {
    return rejection("Eğimli perde için motorlu sistem seçilemez.");
  }
  const limits = motor.technical_limits || motor.pricing_snapshot?.technical_limits;
  if (!limits || !(limits.min_width_cm > 0) || !(limits.max_width_cm > 0 || limits.max_m2 > 0)) {
    return rejection("Motorun ölçü sınırları eksik. Ürün kartını kontrol edin.");
  }
  if (!Array.isArray(panels) || !panels.length) return rejection("Motor seçimi için perde en ve boyunu girin.");
  for (const [index, panel] of panels.entries()) {
    const width = Number(String(panel?.width ?? "").replace(",", "."));
    const height = Number(String(panel?.height ?? "").replace(",", "."));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return rejection(`${index + 1}. parçanın en ve boyunu girin.`);
    try {
      validateProductDimensions({ ...motor, technical_limits: limits }, width, height);
    } catch (error) {
      return rejection(`${index + 1}. parça: ${error.message}`);
    }
    // Page 11 requires an upper set for tall Stor curtains narrower than 3 m.
    // A 4 m-or-larger set is the next explicitly listed capacity above 3 m.
    const maxWidth = limits.max_width_cm;
    if (family === "stor" && width < 300 && height > 300 && !(maxWidth > 300)) return rejection(`${index + 1}. parça: Boy 300 cm’yi geçtiği için bir üst motor setini seçin.`);
  }
  return { eligible: true, reason: "" };
}
