import { accessoryColorsFromLine, accessoryCountsFromLine, calculateCurtainLine, defaultMeasurement, roundMoney } from "./curtainCalculation.js";
import { motorEligibility, motorizedBaseProduct, sanitizedMechanicalIndices, supportsMotorSystem } from "./motorCatalog.js";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => String(value ?? "").trim();
const recordId = (value) => text(value?._id ?? value);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const money = (value) => nonnegative(value) && Number.isSafeInteger(Math.round(value * 100));
const equalNumber = (a, b) => nonnegative(a) && nonnegative(b) && Math.abs(a - b) < 0.000001;
const equalMoney = (a, b) => money(a) && money(b) && Math.abs(a - b) < 0.005;
const barcodeFor = (product) => text(product?.product_barcode) || (text(product?.catalog_id) ? `CAT-${text(product.catalog_id)}` : "");
const defaultKey = () => globalThis.crypto.randomUUID();
const ruleFields = ["min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm", "fixed_dimensions", "technical_limits", "supplier_unit"];

function rateFormFor(line) {
  return {
    currency_rate: line.original_currency === "TRY" ? "" : String(line.currency_rate),
    currency_rate_mode: line.currency_rate_mode || "manual",
    currency_rate_source: line.currency_rate_source || "manual",
    currency_rate_type: line.currency_rate_type || null,
    currency_rate_date: line.currency_rate_date || null,
    currency_rate_fetched_at: line.currency_rate_fetched_at || null,
  };
}

function measurementFor(line) {
  return {
    ...defaultMeasurement({ calculation_type: line.calc_type, category_name: line.category_name }),
    width: String(line.width), height: String(line.height), count: String(line.count),
    room_name: line.room_name || "", area: line.area || "", facade: line.facade || "", window_name: line.window_name || "",
    variant: line.variant || "", item_note: line.item_note || "", chain_direction: line.chain_direction || "",
    case_mode: line.case_mode || "ayri", mechanical_panels: copy(line.mechanical_panels || []),
    profile_width_cm: line.profile_width_cm ? String(line.profile_width_cm) : "",
    labor_price: "0", extra_indices: (line.accessories || []).map((_, index) => index),
    accessory_colors: accessoryColorsFromLine(line),
    accessory_counts: accessoryCountsFromLine(line),
    ...rateFormFor(line),
  };
}

/** Rebuild selected prices in TL; current catalogue prices must not alter a saved quote. */
function frozenOptions(line) {
  if (!Array.isArray(line.accessories) || !Array.isArray(line.pricing_snapshot?.extra_options)) throw new Error("Motorlu sistemin kayıtlı aksesuar bilgileri eksik.");
  return line.accessories.map((saved) => {
    const matches = line.pricing_snapshot.extra_options.filter((option) => option?.option_name === saved?.name);
    if (matches.length !== 1) throw new Error("Motorlu sistemin kayıtlı aksesuar yöntemi bulunamadı.");
    const metadata = matches[0];
    const basis = saved.pricing_basis || metadata.pricing_basis;
    const scope = saved.pricing_scope || metadata.pricing_scope || "parca";
    if (!text(saved.name) || !["birim", "adet", "mt", "m2", "yuzde"].includes(basis) || !["parca", "kasa"].includes(scope)
      || !nonnegative(saved.quantity) || !money(saved.unit_price) || !money(saved.total)) throw new Error("Motorlu sistemin kayıtlı aksesuar fiyatı geçersiz.");
    return { option_name: saved.name, pricing_basis: basis, pricing_scope: scope, currency: "TRY", price_impact: basis === "yuzde" ? saved.quantity : saved.unit_price };
  });
}

function productForLine(line, current) {
  const snapshot = line.pricing_snapshot;
  if (!object(snapshot) || ruleFields.some((key) => !own(snapshot, key))) throw new Error("Motorlu sistemin kayıtlı fiyatlandırma kuralları eksik.");
  const selectedOptions = frozenOptions(line);
  const names = new Set(selectedOptions.map((option) => option.option_name));
  return {
    ...(current || {}),
    _id: recordId(line.product_id), product_name: line.product_name,
    product_barcode: line.product_barcode, brand_name: line.brand_name, category_name: line.category_name,
    product_brand: { brand_name: line.brand_name }, product_category: { category_name: line.category_name },
    calculation_type: line.calc_type, currency: line.original_currency, price_currency: line.original_currency,
    sale_price: line.original_unit_price,
    ...Object.fromEntries(ruleFields.map((key) => [key, copy(snapshot[key])])),
    extra_options: [...selectedOptions, ...(current?.extra_options || []).filter((option) => !names.has(option.option_name)).map(copy)],
  };
}

function actualPanels(line) {
  return line.mechanical_panels?.length ? line.mechanical_panels.map((panel) => ({ width: panel.width, height: panel.height })) : [{ width: line.width, height: line.height }];
}

function checkEligibility(curtain, motor, panels, indices) {
  if (!supportsMotorSystem(curtain) || !motorizedBaseProduct(curtain, [curtain])) throw new Error("Motorlu sistem için uygun, redüktörsüz perde ürününü seçin.");
  const eligibility = motorEligibility(curtain, motor, panels, { extra_indices: indices });
  if (!eligibility?.eligible) throw new Error(eligibility?.reason || "Seçilen motor bu perdeye veya parça ölçülerine uygun değil.");
}

function validateLineAmounts(line, expected) {
  if (!positive(line.quantity) || !Number.isSafeInteger(line.count) || line.count < 1 || !Number.isSafeInteger(line.pieces) || line.pieces < 1
    || !["TRY", "USD", "EUR"].includes(line.original_currency) || !money(line.original_unit_price) || !positive(line.currency_rate)
    || (line.original_currency === "TRY" && line.currency_rate !== 1) || line.labor_unit_price !== 0 || line.labor_total !== 0) throw new Error("Motorlu sistemin kayıtlı miktar, fiyat veya kur bilgileri geçersiz.");
  for (const key of ["base_unit_price", "material_total", "accessories_total", "item_total"]) {
    if (!equalMoney(line[key], expected[key])) throw new Error("Motorlu sistemin kayıtlı ürün tutarı hesapla uyuşmuyor.");
  }
  for (const key of ["width", "height", "count", "pieces", "quantity", "unit_price"]) {
    if (!equalNumber(line[key], expected[key])) throw new Error("Motorlu sistemin kayıtlı ölçüsü veya miktarı hesapla uyuşmuyor.");
  }
  if (line.accessories.length !== expected.accessories.length || line.accessories.some((option, index) => {
    const calculated = expected.accessories[index];
    return option.name !== calculated.name || text(option.color) !== text(calculated.color)
      || (option.count_per_piece ?? 1) !== (calculated.count_per_piece ?? 1)
      || !equalNumber(option.quantity, calculated.quantity) || !equalMoney(option.total, calculated.total);
  })) throw new Error("Motorlu sistemin kayıtlı aksesuar tutarı hesapla uyuşmuyor.");
}

/** One ordinary curtain line plus one independently priced motor line per physical part. */
export function calculateMotorSystem(curtain, motor, curtainForm = {}, motorRateForm = {}, keyFactory = defaultKey) {
  if (!recordId(curtain?._id) || !recordId(motor?._id) || recordId(curtain._id) === recordId(motor._id)) throw new Error("Perdeyi ve motor ürününü ayrı ayrı seçin.");
  const indices = Array.isArray(curtainForm.extra_indices) ? curtainForm.extra_indices : [];
  const sanitized = sanitizedMechanicalIndices(curtain, indices, { motorized: true });
  const calculatedCurtain = calculateCurtainLine(curtain, { ...curtainForm, extra_indices: sanitized });
  checkEligibility(curtain, motor, actualPanels(calculatedCurtain), indices);
  const motorCount = calculatedCurtain.pieces;
  if (!Number.isSafeInteger(motorCount) || motorCount < 1) throw new Error("Motor adedi hesaplama sınırını aşıyor.");
  const calculatedMotor = calculateCurtainLine(motor, {
    ...motorRateForm,
    width: 0, height: 0, count: motorCount, case_mode: "ayri", mechanical_panels: [], extra_indices: [], labor_price: 0,
    room_name: calculatedCurtain.room_name, area: calculatedCurtain.area, facade: calculatedCurtain.facade, window_name: calculatedCurtain.window_name,
    variant: "", item_note: "",
  });
  const total = roundMoney(calculatedCurtain.item_total + calculatedMotor.item_total);
  if (!money(total) || typeof keyFactory !== "function") throw new Error("Motorlu sistem toplamı veya kimliği oluşturulamadı.");
  const keys = new Set();
  const key = () => {
    const value = text(keyFactory());
    if (!value || value.length > 150 || keys.has(value)) throw new Error("Motorlu sistem kimlikleri boş veya tekrarlı olamaz.");
    keys.add(value);
    return value;
  };
  const metadata = { version: 1, group_id: key(), quantity_basis: "piece", motor_catalog_id: barcodeFor(motor) };
  const curtainLine = { ...calculatedCurtain, product_barcode: barcodeFor(curtain), id: key(), motor_system: { ...metadata, role: "curtain" } };
  const motorLine = { ...calculatedMotor, product_barcode: barcodeFor(motor), id: key(), motor_system: { ...metadata, role: "motor" } };
  const lines = [curtainLine, motorLine];
  validateMotorSystemGroups(lines);
  return { lines, total, motorCount, curtain: curtainLine, motor: motorLine };
}

/** Groups remain ordinary sale items; reject orphan motors and inconsistent saved pair data. */
export function validateMotorSystemGroups(cart) {
  if (!Array.isArray(cart)) throw new Error("Motorlu sistemin ürün listesini kontrol edin.");
  const groups = new Map();
  const ids = new Map();
  for (const line of cart) {
    if (!object(line)) continue;
    const id = recordId(line.id);
    if (id) ids.set(id, (ids.get(id) || 0) + 1);
    if (!own(line, "motor_system")) continue;
    const metadata = line.motor_system;
    if (!object(metadata) || metadata.version !== 1 || typeof metadata.group_id !== "string" || !text(metadata.group_id) || metadata.group_id.length > 150
      || !["curtain", "motor"].includes(metadata.role) || metadata.quantity_basis !== "piece" || typeof metadata.motor_catalog_id !== "string" || !text(metadata.motor_catalog_id)
      || !id || id.length > 150 || !recordId(line.product_id) || !text(line.product_barcode) || own(line, "dual_plise")) throw new Error("Motorlu sistemin perde ve motor eşleştirme bilgileri eksik veya geçersiz.");
    if (!groups.has(metadata.group_id)) groups.set(metadata.group_id, []);
    groups.get(metadata.group_id).push(line);
  }
  for (const pair of groups.values()) {
    if (pair.length !== 2 || pair[0].motor_system.role === pair[1].motor_system.role) throw new Error("Motorlu sistemin perdesi ve motoru birlikte kaydedilmelidir.");
    const curtain = pair.find((line) => line.motor_system.role === "curtain");
    const motor = pair.find((line) => line.motor_system.role === "motor");
    if (curtain.id === motor.id || ids.get(recordId(curtain.id)) !== 1 || ids.get(recordId(motor.id)) !== 1 || recordId(curtain.product_id) === recordId(motor.product_id)
      || ["room_name", "area", "facade", "window_name"].some((field) => curtain[field] !== motor[field])
      || curtain.motor_system.motor_catalog_id !== motor.motor_system.motor_catalog_id || motor.product_barcode !== motor.motor_system.motor_catalog_id
      || curtain.mode !== "mechanical" || curtain.calc_type !== "m2" || motor.mode !== "standard" || motor.calc_type !== "adet"
      || !Number.isSafeInteger(curtain.pieces) || curtain.pieces < 1 || motor.count !== curtain.pieces || motor.pieces !== curtain.pieces || motor.quantity !== curtain.pieces
      || motor.width !== 0 || motor.height !== 0 || motor.mechanical_panels?.length || motor.accessories_total !== 0 || !Array.isArray(motor.accessories) || motor.accessories.length) throw new Error("Motor adedi, perde parçaları ve aynı sistem bilgileri uyuşmuyor.");
    const curtainProduct = productForLine(curtain);
    const motorProduct = productForLine(motor);
    const indices = curtainProduct.extra_options.map((_, index) => index);
    if (sanitizedMechanicalIndices(curtainProduct, indices, { motorized: true }).length !== indices.length) throw new Error("Motorlu sistemde manuel mekanizma veya zincir farkı eklenemez.");
    checkEligibility(curtainProduct, motorProduct, actualPanels(curtain), indices);
    const expectedCurtain = calculateCurtainLine(curtainProduct, measurementFor(curtain));
    const expectedMotor = calculateCurtainLine(motorProduct, measurementFor(motor));
    validateLineAmounts(curtain, expectedCurtain);
    validateLineAmounts(motor, expectedMotor);
  }
  return true;
}

/** Restore both products at the quote's saved prices/rules/rates while retaining current stock. */
export function restoreMotorSelection(pair, currentProducts) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair.some((line) => !line?.motor_system)) throw new Error("Motorlu sistemin perdesini ve motorunu birlikte açın.");
  validateMotorSystemGroups(pair);
  if (pair[0].motor_system.group_id !== pair[1].motor_system.group_id) throw new Error("Perde ve motor aynı sisteme ait olmalıdır.");
  if (!Array.isArray(currentProducts)) throw new Error("Güncel ürün listesini kontrol edin.");
  const curtainLine = pair.find((line) => line.motor_system.role === "curtain");
  const motorLine = pair.find((line) => line.motor_system.role === "motor");
  const restore = (line) => {
    const matches = currentProducts.filter((product) => recordId(product?._id) === recordId(line.product_id));
    if (matches.length !== 1) throw new Error(`${line.product_name || "Motorlu sistem ürünü"} katalogda bulunamadı.`);
    return productForLine(line, matches[0]);
  };
  return { curtain: restore(curtainLine), motor: restore(motorLine), measurement: measurementFor(curtainLine), motorRateForm: rateFormFor(motorLine), pair };
}
