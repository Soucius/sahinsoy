import { calculateCurtainLine, normalizeName, roundMoney, roundQuantity } from "./curtainCalculation.js";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => String(value ?? "").trim();
const recordId = (value) => text(value?._id ?? value);
const finitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const safeMoney = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const sameMoney = (a, b) => safeMoney(a) && safeMoney(b) && Math.abs(a - b) < 0.005;
const defaultKey = () => globalThis.crypto.randomUUID();

/** Only the four confirmed OBA 15 mm fabric series can share this dual system. */
export function dualPliseRole(product) {
  if (!object(product) || (product.calculation_type || product.calc_type) !== "m2") return null;
  const brand = normalizeName(product.product_brand?.brand_name || product.brand_name).trim();
  const category = normalizeName(product.product_category?.category_name || product.category_name).trim();
  const name = normalizeName(product.product_name).trim();
  if (!/^(oba|oba perdesan)$/.test(brand) || !/^(plise|plise perde)$/.test(category)
    || !/\b15\s*mm\b/.test(name) || /sineklik|kasali|honeycomb|duet/.test(name)) return null;
  const families = name.match(/\b(alia|vega|bella|lantana)\b/g) || [];
  if (families.length !== 1) return null;
  return ["alia", "vega"].includes(families[0]) ? "tul" : "guneslik";
}

function caseChoices(product) {
  const choices = new Map();
  for (const option of product?.extra_options || []) {
    const name = text(option?.option_name);
    if (!/^kasa\s*\/\s*donanim\s*rengi\s*:/.test(normalizeName(name))) continue;
    const label = text(name.slice(name.indexOf(":") + 1));
    if (!label) continue;
    const key = normalizeName(label);
    const free = option.price_impact !== null && option.price_impact !== "" && Number(option.price_impact) === 0;
    const previous = choices.get(key);
    // Ambiguous duplicate choices that include a paid option are never waived.
    choices.set(key, { label: previous?.label || label, option_name: previous?.option_name || name, free: free && (!previous || previous.free) });
  }
  return choices;
}

/** Intersection only: paid choices need an explicit separate workflow. */
export function getDualCaseColors(productA, productB) {
  const a = caseChoices(productA);
  const b = caseChoices(productB);
  return [...a].flatMap(([key, value]) => value.free && b.get(key)?.free ? [{ label: value.label, option_name: value.option_name }] : []);
}

function selectedCaseColor(productA, productB, selected) {
  const value = text(selected);
  if (!value) return "";
  const normalized = normalizeName(value);
  const key = /^kasa\s*\/\s*donanim\s*rengi\s*:/.test(normalized) ? normalizeName(text(value.slice(value.indexOf(":") + 1))) : normalized;
  const color = getDualCaseColors(productA, productB).find((choice) => normalizeName(choice.label) === key);
  if (!color) throw new Error("Kasa rengini iki ürünün ortak, ücretsiz renk listesinden seçin.");
  return color.label;
}

function validateLinePrice(line) {
  if (line.mode !== "mechanical" || line.calc_type !== "m2" || line.original_currency !== "TRY" || line.currency_rate !== 1
    || !safeMoney(line.original_unit_price) || !sameMoney(line.base_unit_price, line.original_unit_price)
    || !finitePositive(line.quantity) || !sameMoney(line.material_total, roundMoney(line.quantity * line.base_unit_price))
    || !sameMoney(line.item_total, line.material_total) || !sameMoney(line.item_total, roundMoney(line.quantity * line.unit_price))
    || line.labor_unit_price !== 0 || line.labor_total !== 0 || line.accessories_total !== 0
    || !Array.isArray(line.accessories) || line.accessories.length || line.mechanical_panels?.length) {
    throw new Error("Çiftli plise yalnız iki kumaşın TL tutarından oluşmalıdır; ek mekanizma / aksesuar ücreti içeremez.");
  }
}

/**
 * Each row is one physical glass, represented by two ordinary priced fabric lines.
 * New shared-measurement rows use one height for both fabrics; unflagged saved
 * orders retain their earlier independent-height behavior.
 * The entire batch is calculated before allocating identities, so an invalid final
 * row cannot leave a partly created list for the caller to add to the order.
 */
export function calculateDualPliseBatch(tulProduct, shadeProduct, common = {}, rows, keyFactory = defaultKey) {
  if (dualPliseRole(tulProduct) !== "tul" || dualPliseRole(shadeProduct) !== "guneslik"
    || !recordId(tulProduct?._id) || recordId(tulProduct?._id) === recordId(shadeProduct?._id)) {
    throw new Error("Çiftli plise için ALIA / VEGA tül ve BELLA / LANTANA güneşlik seçin.");
  }
  if ([tulProduct, shadeProduct].some((product) => (product.currency || product.price_currency || "TRY") !== "TRY")) {
    throw new Error("Çiftli plise için TL fiyatlı OBA ürünleri seçin.");
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Çiftli plise için 1–500 cam ölçüsü girin.");
  if (typeof keyFactory !== "function") throw new Error("Ölçü satırı kimliği oluşturulamadı.");
  const calculated = rows.map((row, index) => {
    try {
      if (!object(row)) throw new Error("İki kumaşın boyunu ve ortak eni girin.");
      const glassLabel = text(row.label) || `Cam ${index + 1}`;
      const area = [text(common.area), glassLabel].filter(Boolean).join(" / ");
      const variant = text(row.variant) || text(common.variant);
      const shadeVariant = text(row.shade_variant) || text(common.shade_variant);
      if (glassLabel.length > 100 || area.length > 200 || variant.length > 150 || shadeVariant.length > 150) throw new Error("Cam adı veya renk / VR bilgisi çok uzun.");
      const caseColor = selectedCaseColor(tulProduct, shadeProduct, own(row, "case_color") ? row.case_color : common.case_color);
      const makeLine = (product, height, colorVariant) => calculateCurtainLine({
        ...product,
        min_m2: Math.max(1, Number(product.min_m2) || 0),
        dimension_rounding_cm: Number(product.dimension_rounding_cm) || 10,
      }, {
        ...common, width: row.width, height, count: row.count, variant: colorVariant, area,
        extra_indices: [], case_mode: "ayri", mechanical_panels: [], labor_price: 0,
      });
      const tul = makeLine(tulProduct, row.height, variant);
      const guneslik = makeLine(shadeProduct, common.shared_measurements === true ? row.height : row.shade_height, shadeVariant);
      for (const line of [tul, guneslik]) validateLinePrice(line);
      if (!Number.isSafeInteger(tul.pieces) || tul.pieces < 1) throw new Error("Cam adedi hesaplama sınırını aşıyor.");
      return { glass_label: glassLabel, case_color: caseColor, width: tul.width, count: tul.count, tul, guneslik };
    } catch (error) { throw new Error(`${index + 1}. çiftli ölçü satırı: ${error.message}`); }
  });
  const quantity = roundQuantity(calculated.reduce((sum, group) => sum + group.tul.quantity + group.guneslik.quantity, 0));
  const total = roundMoney(calculated.reduce((sum, group) => sum + group.tul.item_total + group.guneslik.item_total, 0));
  const pieces = calculated.reduce((sum, group) => sum + group.count, 0);
  if (!finitePositive(quantity) || !safeMoney(total) || !Number.isSafeInteger(pieces)) throw new Error("Çiftli ölçü listesi toplamı hesaplama sınırını aşıyor.");
  const keys = new Set();
  const nextKey = () => {
    const key = text(keyFactory());
    if (!key || key.length > 150 || keys.has(key)) throw new Error("Ölçü satırı kimlikleri boş veya tekrarlı olamaz.");
    keys.add(key);
    return key;
  };
  const groups = calculated.map((group) => {
    const groupId = nextKey();
    const metadata = { version: 1, group_id: groupId, glass_label: group.glass_label, case_color: group.case_color,
      ...(common.shared_measurements === true ? { shared_measurements: true } : {}) };
    const tul = { ...group.tul, id: nextKey(), dual_plise: { ...metadata, role: "tul" } };
    const guneslik = { ...group.guneslik, id: nextKey(), dual_plise: { ...metadata, role: "guneslik" } };
    return { ...group, group_id: groupId, tul, guneslik, quantity: roundQuantity(tul.quantity + guneslik.quantity), total: roundMoney(tul.item_total + guneslik.item_total), pieces: group.count };
  });
  const lines = groups.flatMap((group) => [group.tul, group.guneslik]);
  validateDualPliseGroups(lines);
  return { lines, groups, quantity, total, pieces };
}

/** Validate saved/cart pairs without imposing dual rules on ordinary sale lines. */
export function validateDualPliseGroups(cart) {
  if (!Array.isArray(cart)) throw new Error("Sipariş ürün listesini kontrol edin.");
  const groups = new Map();
  const lineIds = new Map();
  for (const line of cart) {
    if (!object(line)) continue;
    const id = recordId(line.id);
    if (id) lineIds.set(id, (lineIds.get(id) || 0) + 1);
    if (!own(line, "dual_plise")) continue;
    const metadata = line.dual_plise;
    if (!object(metadata) || metadata.version !== 1 || typeof metadata.group_id !== "string" || !text(metadata.group_id) || metadata.group_id.length > 150
      || !["tul", "guneslik"].includes(metadata.role) || typeof metadata.glass_label !== "string" || !text(metadata.glass_label) || metadata.glass_label.length > 100
      || typeof metadata.case_color !== "string" || metadata.case_color.length > 150
      || (own(metadata, "shared_measurements") && typeof metadata.shared_measurements !== "boolean") || !id || id.length > 150
      || !recordId(line.product_id) || dualPliseRole(line) !== metadata.role
      || !finitePositive(line.width) || !finitePositive(line.height) || !Number.isSafeInteger(line.count) || line.count < 1 || line.pieces !== line.count) {
      throw new Error("Çiftli plisenin eşleştirme ve cam ölçüsü bilgileri eksik veya geçersiz.");
    }
    validateLinePrice(line);
    if (!groups.has(metadata.group_id)) groups.set(metadata.group_id, []);
    groups.get(metadata.group_id).push(line);
  }
  for (const pair of groups.values()) {
    if (pair.length !== 2 || pair[0].dual_plise.role === pair[1].dual_plise.role) throw new Error("Çiftli plise tül ve güneşlik birlikte kaydedilmelidir.");
    const [a, b] = pair;
    const sameFields = ["width", "count", "pieces", "room_name", "area", "facade", "window_name"];
    if (recordId(a.product_id) === recordId(b.product_id) || a.id === b.id || lineIds.get(recordId(a.id)) !== 1 || lineIds.get(recordId(b.id)) !== 1
      || sameFields.some((field) => a[field] !== b[field])
      || a.dual_plise.glass_label !== b.dual_plise.glass_label || a.dual_plise.case_color !== b.dual_plise.case_color
      || a.dual_plise.shared_measurements !== b.dual_plise.shared_measurements
      || (a.dual_plise.shared_measurements === true && a.height !== b.height)) {
      throw new Error("Çiftli plisenin iki kumaşı aynı cam, en, adet ve kasa rengine ait olmalıdır.");
    }
  }
  return true;
}
