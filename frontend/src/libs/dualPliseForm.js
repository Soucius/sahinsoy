import { defaultMeasurement } from "./curtainCalculation.js";
import { calculateDualPliseBatch, dualPliseRole, validateDualPliseGroups } from "./dualPlise.js";

const recordId = (value) => String(value?._id ?? value ?? "");
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** One glass measurement applies to both fabrics; their variants stay separate. */
export function calculateDualSelection(primary, secondary, common = {}, rows, keyFactory) {
  if (!secondary) throw new Error("Çiftli sistem için ikinci ürünü seçin.");
  const primaryRole = dualPliseRole(primary);
  if (!primaryRole || dualPliseRole(secondary) !== (primaryRole === "tul" ? "guneslik" : "tul")) throw new Error("Çiftli plise için bir tül ve bir güneşlik seçin.");
  const primaryIsTul = primaryRole === "tul";
  const tul = primaryIsTul ? primary : secondary;
  const shade = primaryIsTul ? secondary : primary;
  const mappedCommon = {
    ...common,
    shared_measurements: true,
    variant: primaryIsTul ? common.variant : common.secondary_variant,
    shade_variant: primaryIsTul ? common.secondary_variant : common.variant,
  };
  const mappedRows = Array.isArray(rows) ? rows.map((row) => row && typeof row === "object" && !Array.isArray(row) ? {
    ...row,
    height: row.height,
    shade_height: row.height,
    variant: primaryIsTul ? row.variant : row.secondary_variant,
    shade_variant: primaryIsTul ? row.secondary_variant : row.variant,
  } : row) : rows;
  return calculateDualPliseBatch(tul, shade, mappedCommon, mappedRows, keyFactory);
}

function savedProduct(line, currentProducts) {
  const current = currentProducts.find((product) => recordId(product?._id) === recordId(line.product_id));
  if (!current) throw new Error(`${line.product_name || "Çiftli plise ürünü"} katalogda bulunamadı.`);
  const snapshot = line.pricing_snapshot || {};
  const product = {
    ...current,
    sale_price: line.original_unit_price,
    currency: line.original_currency,
    price_currency: line.original_currency,
    ...(Array.isArray(current.extra_options) ? { extra_options: current.extra_options.map((option) => ({ ...option })) } : {}),
  };
  for (const key of ["min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm", "supplier_unit", "fixed_dimensions", "technical_limits"]) {
    if (own(snapshot, key)) product[key] = snapshot[key] && typeof snapshot[key] === "object" ? { ...snapshot[key] } : snapshot[key];
  }
  return product;
}

/** Reopen a saved pair with shade first and both historical pricing rules frozen. */
export function restoreDualSelection(pair, currentProducts) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair.some((line) => !line?.dual_plise)) throw new Error("Çiftli plisenin iki kumaşını birlikte açın.");
  validateDualPliseGroups(pair);
  if (pair[0].dual_plise.group_id !== pair[1].dual_plise.group_id) throw new Error("Çiftli plisenin iki kumaşı aynı sisteme ait olmalıdır.");
  if (!Array.isArray(currentProducts)) throw new Error("Güncel ürün listesini kontrol edin.");
  const shadeLine = pair.find((line) => line.dual_plise.role === "guneslik");
  const tulLine = pair.find((line) => line.dual_plise.role === "tul");
  const primary = savedProduct(shadeLine, currentProducts);
  const secondary = savedProduct(tulLine, currentProducts);
  const { glass_label: label, case_color } = shadeLine.dual_plise;
  let area = String(shadeLine.area || "").trim();
  const suffix = ` / ${label}`;
  if (area === label) area = "";
  else if (area.endsWith(suffix)) area = area.slice(0, -suffix.length);
  const legacyHeights = shadeLine.height !== tulLine.height ? { tul: tulLine.height, guneslik: shadeLine.height } : null;
  const row = {
    width: String(shadeLine.width), height: legacyHeights ? "" : String(shadeLine.height), count: String(shadeLine.count),
    label, variant: shadeLine.variant || "", secondary_variant: tulLine.variant || "", case_color,
  };
  const measurement = {
    ...defaultMeasurement(primary),
    room_name: shadeLine.room_name || "", area, facade: shadeLine.facade || "", window_name: shadeLine.window_name || "",
    width: row.width, height: row.height, count: row.count, variant: row.variant, secondary_variant: row.secondary_variant,
    item_note: shadeLine.item_note || "", secondary_item_note: tulLine.item_note || "", extra_indices: [],
  };
  return { primary, secondary, measurement, row, pair, legacyHeights };
}
