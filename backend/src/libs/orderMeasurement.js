import { calculateCurtainLine, formatNumber, PLEATS, productMode, roundMoney, roundQuantity, salePayload } from "./curtainCalculation.js";

const ruleFields = ["min_m2", "rounding_step", "min_width_cm", "min_height_cm", "dimension_rounding_cm"];
const geometryFields = ["width", "height", "billable_width", "billable_height", "profile_width_cm", "case_width", "quantity", "material_total", "labor_total", "accessories_total", "unit_price", "item_total", "calculation_note"];
const bases = new Set(["birim", "adet", "mt", "m2", "yuzde"]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const recordId = (value) => String(value?._id ?? value ?? "");
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function rejectUnknown(value, keys, label) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${label} yalnız izin verilen ölçü alanlarını içerebilir.`);
}

function number(value, label, minimum = 0) {
  if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) throw new Error(`${label} için geçerli bir sayı girin.`);
  const result = Number(typeof value === "string" ? value.replace(",", ".") : value);
  if (!Number.isFinite(result) || result < minimum) throw new Error(`${label} için geçerli bir sayı girin.`);
  return result;
}

function cm(value, label, optional = false) {
  const result = number(value, label);
  if (!optional && result === 0) throw new Error(`${label} sıfırdan büyük olmalıdır.`);
  return result;
}

function lineShape(line) {
  if (!object(line) || !recordId(line.id) || !recordId(line.product_id) || !["mt", "m2", "adet"].includes(line.calc_type)) throw new Error("Bu siparişin kayıtlı ölçü ayrıntıları eksik. Eski sipariş için yeni bir sipariş oluşturun.");
  const product = { calculation_type: line.calc_type, category_name: line.category_name || "" };
  const mode = productMode(product);
  if (!["textile", "fon", "mechanical", "standard"].includes(line.mode) || mode !== line.mode) throw new Error("Siparişin ürün hesaplama türü çözümlenemedi; ölçü güncellenemiyor.");
  const panels = Array.isArray(line.mechanical_panels) && line.mechanical_panels.length > 0;
  const team = mode === "fon" && line.order_mode === "takim";
  if (team && (!Array.isArray(line.panels) || line.panels.length !== 2)) throw new Error("Fon takımının kayıtlı sağ ve sol kanat ölçüleri eksik.");
  return { mode, panels, team };
}

/** The editable DTO contains dimensions only; all other choices stay on the saved order. */
export function measurementFormForLine(line) {
  const { panels, team } = lineShape(line);
  const form = { line_id: recordId(line.id), width: line.width, height: line.height };
  if (team) Object.assign(form, { right_width: line.panels[1].width, right_height: line.panels[1].height });
  if (panels) {
    form.mechanical_panels = line.mechanical_panels.map((panel) => ({ width: panel.width, height: panel.height }));
    if (line.case_mode === "ortak") form.profile_width_cm = line.profile_width_cm || 0;
  }
  return form;
}

export function measurementSummary(line) {
  const { panels, team } = lineShape(line);
  const size = (panel) => `${formatNumber(panel.width)} × ${formatNumber(panel.height)} cm`;
  if (panels) return line.mechanical_panels.map((panel, index) => `${panel.position || `${index + 1}. parça`}: ${size(panel)}`).join(" · ");
  if (team) return `Sol: ${size(line.panels[0])} · Sağ: ${size(line.panels[1])}`;
  return size(line);
}

function frozenRules(line, product) {
  const snapshot = object(line.pricing_snapshot) ? line.pricing_snapshot : {};
  const measuredMechanical = line.mode === "mechanical" && ["m2", "mt"].includes(line.calc_type);
  const rules = {};
  for (const key of ruleFields) {
    if (has(snapshot, key)) rules[key] = number(snapshot[key], "Kayıtlı hesaplama kuralı");
    else if (product) rules[key] = number(product[key] ?? 0, "Ürün hesaplama kuralı");
    else if (measuredMechanical) throw new Error("Eski siparişin minimum / yuvarlama kuralları bulunamadı. Ürün bilgileri yüklenmeden ölçü güncellenemez.");
    else rules[key] = 0;
  }
  if (measuredMechanical && !ruleFields.every((key) => has(snapshot, key)) && product.calculation_type !== line.calc_type) throw new Error("Eski siparişin ürün hesaplama türü değişmiş; hesaplama kuralları doğrulanmalıdır.");
  return rules;
}

function selectedOptionMetadata(line, accessory, product) {
  const snapshotOptions = line.pricing_snapshot?.extra_options;
  const match = (options) => Array.isArray(options) ? options.filter((option) => option?.option_name === accessory.name) : [];
  const snapshotMatches = match(snapshotOptions);
  const catalogMatches = match(product?.extra_options);
  const metadata = snapshotMatches.length === 1 ? snapshotMatches[0] : catalogMatches.length === 1 ? catalogMatches[0] : null;
  const basis = accessory.pricing_basis ?? metadata?.pricing_basis ?? metadata?.calculation_type ?? (accessory.unit === "%" ? "yuzde" : undefined);
  // Older product options without a basis/scope used these explicit model defaults.
  const resolvedBasis = basis ?? (metadata ? "birim" : undefined);
  const scope = accessory.pricing_scope ?? metadata?.pricing_scope ?? (metadata ? "parca" : undefined);
  if (!bases.has(resolvedBasis) || (resolvedBasis === "adet" && !["parca", "kasa"].includes(scope))) throw new Error(`“${accessory.name || "Aksesuar"}” için kayıtlı fiyatlandırma yöntemi / kapsamı bulunamadı. Ölçü güncellenmeden bu bilgi doğrulanmalıdır.`);
  return { option_name: accessory.name, pricing_basis: resolvedBasis, pricing_scope: scope || "parca" };
}

function priceAccessories(line, revised, metadata) {
  return (line.accessories || []).map((saved, index) => {
    const { pricing_basis: basis, pricing_scope: scope } = metadata[index];
    if (basis === "yuzde") {
      const percent = number(saved.quantity, "Kayıtlı aksesuar yüzdesi");
      if (percent > 100) throw new Error("Kayıtlı aksesuar yüzdesi %100'ü geçemez.");
      return { ...copy(saved), pricing_basis: basis, pricing_scope: scope, quantity: percent, unit_price: revised.material_total / 100, total: roundMoney(revised.material_total * percent / 100) };
    }
    const unitPrice = number(saved.unit_price, "Kayıtlı aksesuar birim fiyatı");
    let quantity = revised.quantity;
    if (basis === "adet") quantity = scope === "kasa" ? (revised.case_count ?? revised.count) : revised.pieces;
    if (basis === "mt") quantity = ["textile", "fon"].includes(revised.mode) ? revised.quantity : revised.width / 100 * (revised.mechanical_panels?.length ? revised.count : revised.pieces);
    if (basis === "m2") quantity = revised.calc_type === "m2" ? revised.quantity : revised.width * revised.height / 10000 * revised.pieces;
    return { ...copy(saved), pricing_basis: basis, pricing_scope: scope, quantity: roundQuantity(quantity), unit_price: unitPrice, total: roundMoney(quantity * unitPrice) };
  });
}

function reviseLine(line, measurement, product) {
  const shape = lineShape(line);
  const allowed = Object.keys(measurementFormForLine(line));
  rejectUnknown(measurement, allowed, "Ürün ölçüsü");
  if (allowed.some((key) => !has(measurement, key))) throw new Error("Ürünün bütün ölçü alanlarını gönderin.");
  const width = cm(measurement.width, "En", line.calc_type === "adet");
  const height = cm(measurement.height, "Boy", line.calc_type === "adet" || (line.calc_type === "mt" && shape.mode === "mechanical"));
  const count = number(line.count, "Kayıtlı adet / takım sayısı", 1);
  if (!Number.isInteger(count)) throw new Error("Kayıtlı adet / takım sayısı geçersiz.");
  const currency = line.original_currency || "TRY";
  if (!["TRY", "USD", "EUR"].includes(currency)) throw new Error("Kayıtlı döviz cinsi geçersiz.");
  const nativePrice = number(line.original_unit_price ?? (currency === "TRY" ? line.base_unit_price : undefined), "Kayıtlı ürün birim fiyatı");
  const rate = currency === "TRY" ? 1 : cm(line.currency_rate, "Kayıtlı döviz kuru");
  const labor = number(line.labor_unit_price ?? 0, "Kayıtlı işçilik birim fiyatı");
  const pleat = ["textile", "fon"].includes(shape.mode) ? PLEATS.find((option) => option.name === line.pleat_name && option.factor === line.pleat_factor) : PLEATS[0];
  if (!pleat) throw new Error("Kayıtlı pile türü ve oranı çözümlenemedi; ölçü güncellenemiyor.");
  const rules = frozenRules(line, product);
  if (!Array.isArray(line.accessories)) throw new Error("Kayıtlı aksesuar ayrıntıları bulunamadı.");
  const options = line.accessories.map((accessory) => selectedOptionMetadata(line, accessory, product));
  const form = {
    width, height, count, order_mode: line.order_mode, pleat_id: pleat.id,
    labor_price: labor, currency_rate: rate, chain_direction: line.chain_direction,
    case_mode: line.case_mode || "ayri", extra_indices: [],
    room_name: line.room_name, area: line.area, facade: line.facade,
    window_name: line.window_name, variant: line.variant, item_note: line.item_note,
  };
  if (shape.team) Object.assign(form, { separate_right: true, right_width: cm(measurement.right_width, "Sağ kanat eni"), right_height: cm(measurement.right_height, "Sağ kanat boyu") });
  if (shape.panels) {
    if (!Array.isArray(measurement.mechanical_panels) || measurement.mechanical_panels.length !== line.mechanical_panels.length) throw new Error("Ölçü güncellemesinde parça sayısı değiştirilemez.");
    form.mechanical_panels = measurement.mechanical_panels.map((panel, index) => {
      rejectUnknown(panel, ["width", "height"], "Parça ölçüsü");
      return { ...line.mechanical_panels[index], width: cm(panel.width, `${index + 1}. parça eni`), height: cm(panel.height, `${index + 1}. parça boyu`) };
    });
    if (line.case_mode === "ortak") form.profile_width_cm = cm(measurement.profile_width_cm === "" ? 0 : measurement.profile_width_cm, "Fiziksel kasa / profil eni", true);
  }
  const calculated = calculateCurtainLine({
    _id: line.product_id, product_name: line.product_name, category_name: line.category_name,
    brand_name: line.brand_name, calculation_type: line.calc_type, sale_price: nativePrice,
    currency, ...rules, extra_options: [],
  }, form);
  if (calculated.pieces !== line.pieces || calculated.count !== line.count || (shape.panels && calculated.case_count !== line.case_count)) throw new Error("Kayıtlı parça / kasa sayısı çözümlenemedi; ölçü güncellenemiyor.");
  calculated.accessories = priceAccessories(line, calculated, options);
  calculated.accessories_total = roundMoney(calculated.accessories.reduce((total, option) => total + option.total, 0));
  calculated.item_total = roundMoney(calculated.material_total + calculated.labor_total + calculated.accessories_total);
  calculated.unit_price = calculated.item_total / calculated.quantity;
  for (const key of ["quantity", "material_total", "labor_total", "accessories_total", "unit_price", "item_total"]) {
    if (!Number.isFinite(calculated[key]) || calculated[key] < 0) throw new Error("Ölçü hesabı geçerli sayı aralığını aşıyor.");
  }
  const revised = copy(line);
  for (const key of geometryFields) if (has(calculated, key)) revised[key] = calculated[key];
  revised.panels = calculated.panels.map((panel, index) => ({ ...(line.panels?.[index] || {}), width: panel.width, height: panel.height, cut_width: panel.cut_width }));
  if (shape.panels) revised.mechanical_panels = calculated.mechanical_panels.map((panel, index) => ({ ...copy(line.mechanical_panels[index]), width: panel.width, height: panel.height, billable_width: panel.billable_width, billable_height: panel.billable_height, billable_area: panel.billable_area }));
  revised.accessories = calculated.accessories;
  revised.pricing_snapshot = { ...copy(line.pricing_snapshot || {}), ...rules, extra_options: options };
  return revised;
}

/** Reprice dimensions using the original sale's unit prices, options, count and FX rate. */
export function buildMeasurementRevision(sale, input, products = []) {
  rejectUnknown(input, ["measurements"], "Ölçü güncellemesi");
  const cart = sale?.pos_details?.cart;
  if (!Array.isArray(cart) || !cart.length || !Array.isArray(sale.sale_items) || sale.sale_items.length !== cart.length) throw new Error("Bu eski siparişin ayrıntılı POS ölçü kaydı bulunmuyor. Ölçü güncellemesi için yeni bir sipariş oluşturun.");
  if (!Array.isArray(input.measurements) || input.measurements.length !== cart.length) throw new Error("Ölçü güncellemesinde siparişin bütün ürünleri yer almalıdır; ürün eklenemez veya çıkarılamaz.");
  const measurements = new Map();
  for (const entry of input.measurements) {
    if (!object(entry) || typeof entry.line_id !== "string" || !entry.line_id || measurements.has(entry.line_id)) throw new Error("Ürün satır kimlikleri eksik veya tekrarlanmış.");
    measurements.set(entry.line_id, entry);
  }
  const lineIds = new Set();
  const revised = cart.map((line, index) => {
    lineShape(line);
    const id = recordId(line.id);
    if (lineIds.has(id) || !measurements.has(id)) throw new Error("Ölçü satırları kayıtlı sipariş ile eşleşmiyor.");
    lineIds.add(id);
    if (recordId(sale.sale_items[index].product) !== recordId(line.product_id)) throw new Error("Sipariş ürünleri ile POS ölçü kayıtları eşleşmiyor.");
    const matches = Array.isArray(products) ? products.filter((product) => recordId(product._id) === recordId(line.product_id)) : [];
    return reviseLine(line, measurements.get(id), matches.length === 1 ? matches[0] : null);
  });
  const discount = number(sale.discount_percent ?? sale.pos_details.discount_percent ?? 0, "Kayıtlı iskonto oranı");
  const fee = number(sale.credit_card_fee ?? 0, "Kayıtlı kredi kartı farkı");
  const priced = salePayload(revised, sale.pos_details.header || {}, discount, sale.status, sale.client_request_id);
  const grandTotal = roundMoney(priced.grand_total + fee);
  if (![priced.sub_total, priced.discount_amount, grandTotal].every(Number.isFinite)) throw new Error("Sipariş toplamı geçerli sayı aralığını aşıyor.");
  return {
    sale_items: priced.sale_items.map((item, index) => ({ ...copy(sale.sale_items[index]), ...item, is_ordered: sale.sale_items[index].is_ordered === true })),
    pos_details: { ...copy(sale.pos_details), cart: revised, discount_percent: priced.discount_percent },
    sub_total: priced.sub_total, discount_amount: priced.discount_amount, discount_percent: priced.discount_percent,
    credit_card_fee: fee, grand_total: grandTotal,
  };
}
