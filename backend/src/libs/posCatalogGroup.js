import { normalizeName } from "./curtainCalculation.js";
import { productSearchPattern } from "./productSearch.js";

const AUTOMATION_CATEGORY_NAMES = [
  "Stor / Zebra Motoru", "Jaluzi Motoru", "Honeycomb Motoru", "Dikey Motoru", "Dikey Perde Motoru",
  "Sahne Rayı Motoru", "Motorlu Ray", "Kumanda / Otomasyon", "Motor Aksesuarı",
];
const normalizedCategoryName = (name) => normalizeName(name).trim().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
const automationNames = new Set(AUTOMATION_CATEGORY_NAMES.map(normalizedCategoryName));

export function isAutomationCategoryName(name) {
  return automationNames.has(normalizedCategoryName(name));
}

export function automationCategoryFilter() {
  const alternatives = AUTOMATION_CATEGORY_NAMES.map((name) => productSearchPattern(name)
    .replace(/\s*\/\s*/g, "\\s*/\\s*").replace(/ +/g, "\\s+"));
  return { category_name: { $regex: `^\\s*(?:${alternatives.join("|")})\\s*$`, $options: "i" } };
}

export function parsePosCatalogGroup(value) {
  if (value === undefined || value === "") return "";
  if (value === "curtains" || value === "automation") return value;
  const error = new Error("Geçersiz POS ürün grubu.");
  error.code = "INVALID_POS_CATALOG_GROUP";
  throw error;
}

export function applyPosCatalogGroup(query = {}, posGroup, automationCategoryIds = []) {
  const group = parsePosCatalogGroup(posGroup);
  if (!group) return query;
  const condition = { [group === "automation" ? "$in" : "$nin"]: [...automationCategoryIds] };
  if (!Object.hasOwn(query, "product_category")) return { ...query, product_category: condition };
  // Intersect a selected category with the top-level group; never overwrite it.
  return { ...query, $and: [...(query.$and || []), { product_category: condition }] };
}
