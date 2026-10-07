export const PLEATS = [
  { id: "sik", name: "Sık pile", factor: 3 },
  { id: "seyrek", name: "Seyrek pile", factor: 2 },
  { id: "orta", name: "Orta pile", factor: 2.5 },
  { id: "amerikan", name: "Amerikan pile", factor: 3 },
  { id: "kapama", name: "Kapama Amerikan pile", factor: 2.5 },
  { id: "s", name: "S pile", factor: 3 },
];

export const ROOM_PRESETS = ["Salon", "Oturma Odası", "Yatak Odası", "Çocuk Odası", "Mutfak", "Balkon", "Misafir Odası", "Hobi Odası", "Sinema Odası", "Çalışma Odası"];
export const FACADES = ["Kuzey Cephe", "Güney Cephe", "Doğu Cephe", "Batı Cephe"];
export const WINDOWS = ["Fransız Cam", "Standart Pencere", "Sürgülü Cam", "Kemerli Cam", "Boydan Cam"];

export const roundMoney = (number) => Math.round((number + Number.EPSILON) * 100) / 100;
export const roundQuantity = (number) => Math.round((number + Number.EPSILON) * 10000) / 10000;
export const normalizeName = (text) => String(text || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
export const formatNumber = (number, decimals = 2) => Number(number || 0).toLocaleString("tr-TR", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
export const formatMoney = (number, currency = "TRY") => Number(number || 0).toLocaleString("tr-TR", { style: "currency", currency: ["TRY", "USD", "EUR"].includes(currency) ? currency : "TRY" });

export function productMode(product) {
  const category = normalizeName(product.product_category?.category_name || product.category_name);
  const textile = product.calculation_type === "mt" && /tul|fon|orme|brode/.test(category);
  return textile ? (/fon/.test(category) ? "fon" : "textile") : (product.calculation_type === "adet" ? "standard" : "mechanical");
}

export function defaultMeasurement(product) {
  const mode = productMode(product);
  return {
    room_name: "Salon", area: "", facade: "", window_name: "", variant: "", item_note: "",
    width: mode === "fon" ? "80" : "", height: mode === "standard" ? "" : "260", count: "1", order_mode: mode === "fon" ? "takim" : "adet",
    right_width: "80", right_height: "260", separate_right: false, pleat_id: "sik", labor_price: "0", currency_rate: "",
    extra_indices: [],
  };
}

function positive(value, label, integer = false) {
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) throw new Error(`${label} için ${integer ? "pozitif tam sayı" : "geçerli bir ölçü"} girin.`);
  return number;
}

function nonnegative(value, label) {
  const number = Number(String(value || 0).replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} sıfır veya daha büyük olmalıdır.`);
  return number;
}

export function calculateCurtainLine(product, form) {
  if (!product?._id) throw new Error("Önce bir ürün seçin.");
  const mode = productMode(product);
  const type = product.calculation_type || "adet";
  const currency = product.currency || product.price_currency || "TRY";
  const rate = currency === "TRY" ? 1 : positive(form.currency_rate, `${currency}/TL kuru`);
  const nativePrice = nonnegative(product.sale_price, "Ürün fiyatı");
  const basePrice = roundMoney(nativePrice * rate);
  const count = positive(form.count, mode === "textile" ? "Parça sayısı" : "Adet / takım sayısı", true);
  const width = type === "adet" ? nonnegative(form.width, "En") : positive(form.width, "En");
  const height = mode === "textile" || mode === "fon" || type === "m2" ? positive(form.height, "Boy") : nonnegative(form.height, "Boy");
  const pleat = PLEATS.find((option) => option.id === form.pleat_id) || PLEATS[0];
  let quantity = count;
  let pieces = count;
  let panels = [];
  let note = "";
  let perPieceArea = 0;
  if (mode === "fon") {
    const team = form.order_mode === "takim";
    pieces = count * (team ? 2 : 1);
    const left = { label: team ? "Sol kanat" : "Kanat", width, height, cut_width: roundQuantity(width * pleat.factor + 40) };
    panels = [left];
    if (team) {
      const rightWidth = form.separate_right ? positive(form.right_width, "Sağ kanat eni") : width;
      const rightHeight = form.separate_right ? positive(form.right_height, "Sağ kanat boyu") : height;
      panels.push({ label: "Sağ kanat", width: rightWidth, height: rightHeight, cut_width: roundQuantity(rightWidth * pleat.factor + 40) });
    }
    quantity = count * panels.reduce((total, panel) => total + panel.cut_width / 100, 0);
    note = `${count} ${team ? "takım" : "adet"} · ${pieces} kanat · her kanada 40 cm dikiş payı`;
  } else if (mode === "textile") {
    quantity = (width / 100) * pleat.factor + 0.4 * pieces;
    panels = [{ label: "Perde", width: width / pieces, height, cut_width: (width * pleat.factor + pieces * 40) / pieces }];
    note = `${formatNumber(width / 100)} m toplam en × ${pleat.factor} + ${pieces} × 0,40 m dikiş payı`;
  } else if (type === "m2") {
    perPieceArea = width * height / 10000;
    const minimum = nonnegative(product.min_m2, "Minimum m²");
    const step = nonnegative(product.rounding_step, "m² yuvarlama adımı");
    let billable = Math.max(perPieceArea, minimum);
    if (step) billable = Math.ceil((billable - 1e-10) / step) * step;
    quantity = billable * count;
    note = `${count} adet × ${formatNumber(perPieceArea)} m²${minimum ? ` · minimum ${formatNumber(minimum)} m² / adet` : ""}${step ? ` · ${formatNumber(step)} m² adımına yuvarlama` : ""}`;
  } else if (type === "mt") {
    quantity = width / 100 * count;
    note = `${count} adet × ${formatNumber(width / 100)} m`;
  }
  quantity = roundQuantity(quantity);
  const laborPrice = mode === "textile" || mode === "fon" ? nonnegative(form.labor_price, "Metre işçilik fiyatı") : 0;
  const materialTotal = roundMoney(quantity * basePrice);
  const laborTotal = roundMoney(quantity * laborPrice);
  const accessories = (form.extra_indices || []).map((index) => {
    const option = product.extra_options?.[index];
    if (!option) throw new Error("Seçilen aksesuar artık bulunamıyor; ürünü tekrar seçin.");
    const basis = option.pricing_basis || option.calculation_type || "birim";
    let optionQuantity = quantity;
    if (basis === "adet") optionQuantity = pieces;
    if (basis === "mt") optionQuantity = mode === "fon" || mode === "textile" ? quantity : width / 100 * pieces;
    if (basis === "m2") optionQuantity = type === "m2" ? quantity : width * height / 10000 * pieces;
    const optionCurrency = option.currency || currency;
    const optionRate = optionCurrency === "TRY" ? 1 : rate;
    if (optionCurrency !== "TRY" && optionCurrency !== currency) throw new Error("Aksesuarın döviz cinsi ürünün dövizinden farklı. Ayrı ürün kalemi olarak ekleyin.");
    const unitPrice = roundMoney(nonnegative(option.price_impact, "Aksesuar fiyatı") * optionRate);
    return { name: option.option_name, unit: basis === "birim" ? (type === "mt" ? "m" : type === "m2" ? "m²" : "adet") : basis === "mt" ? "m" : basis === "m2" ? "m²" : "adet", quantity: roundQuantity(optionQuantity), unit_price: unitPrice, total: roundMoney(optionQuantity * unitPrice) };
  });
  const accessoriesTotal = roundMoney(accessories.reduce((total, item) => total + item.total, 0));
  const itemTotal = roundMoney(materialTotal + laborTotal + accessoriesTotal);
  return {
    product_id: product._id, product_name: product.product_name,
    brand_name: product.product_brand?.brand_name || product.brand_name || "", category_name: product.product_category?.category_name || product.category_name || "",
    fabric_width_cm: Number(product.fabric_width_cm) || 0, grammage_gr: Number(product.grammage_gr) || 0,
    mode, calc_type: type, width, height, pieces, count, order_mode: form.order_mode, panels,
    quantity, unit_label: type === "mt" ? "m" : type === "m2" ? "m²" : "adet", pleat_name: mode === "textile" || mode === "fon" ? pleat.name : "", pleat_factor: pleat.factor,
    base_unit_price: basePrice, material_total: materialTotal, labor_unit_price: laborPrice, labor_total: laborTotal, accessories, accessories_total: accessoriesTotal,
    unit_price: itemTotal / quantity, item_total: itemTotal,
    original_currency: currency, original_unit_price: nativePrice, currency_rate: rate, calculation_note: note,
    room_name: String(form.room_name || "").trim(), area: String(form.area || "").trim(), facade: form.facade || "", window_name: form.window_name || "", variant: String(form.variant || "").trim(), item_note: String(form.item_note || "").trim(),
    stock_tracked: product.stock_tracking !== false, stock_available: Number(product.stock_quantity) || 0,
  };
}

export function orderTotals(cart, discountPercent) {
  const percent = nonnegative(discountPercent, "İskonto oranı");
  if (percent > 100) throw new Error("İskonto oranı %100'ü geçemez.");
  const subtotal = roundMoney(cart.reduce((sum, item) => sum + Number(item.item_total || 0), 0));
  const discountAmount = roundMoney(subtotal * percent / 100);
  return { subtotal, discountPercent: percent, discountAmount, total: roundMoney(subtotal - discountAmount) };
}

export function salePayload(cart, header, percent, status, existingIdempotencyKey) {
  const totals = orderTotals(cart, percent);
  return {
    sale_items: cart.map((line) => ({ product: line.product_id, quantity: line.quantity, width: line.width, height: line.height, unit_price: line.unit_price, total_price: line.item_total, room_name: [line.room_name, line.area].filter(Boolean).join(" / "), facade: line.facade, window_name: line.window_name, item_note: [line.variant ? `Renk / VR: ${line.variant}` : "", line.pleat_name, line.item_note].filter(Boolean).join(" · ") })),
    sub_total: totals.subtotal, discount_amount: totals.discountAmount, discount_percent: totals.discountPercent, credit_card_fee: 0, grand_total: totals.total,
    payment_method: header.payment_method, status, customer_name: `${header.first_name || ""} ${header.last_name || ""}`.trim(), customer_phone: header.customer_phone || "", customer_address: header.customer_address || "", delivery_date: header.delivery_date || null, sale_note: header.sale_note || "", delivery_method: header.delivery_method,
    client_request_id: existingIdempotencyKey,
    pos_details: { version: 1, cart, header: { ...header }, discount_percent: totals.discountPercent, delivery_method: header.delivery_method },
  };
}

export function restoreSaleDraft(sale) {
  const saved = sale.pos_details;
  const header = saved?.header || {};
  const words = String(sale.customer_name || "").split(" ");
  const cart = Array.isArray(saved?.cart) ? saved.cart : (sale.sale_items || []).map((item, index) => ({
    id: `old-${index}`, product_id: item.product?._id || item.product, product_name: item.product?.product_name || "Ürün", brand_name: "", category_name: "", mode: "standard", calc_type: item.product?.calculation_type || "adet", width: item.width || 0, height: item.height || 0, pieces: item.quantity, count: item.quantity, quantity: item.quantity, unit_label: item.product?.calculation_type === "mt" ? "m" : item.product?.calculation_type === "m2" ? "m²" : "adet", unit_price: item.unit_price, base_unit_price: item.unit_price, material_total: item.total_price, item_total: item.total_price, labor_unit_price: 0, labor_total: 0, accessories: [], accessories_total: 0, panels: [], room_name: item.room_name || "", area: "", facade: item.facade || "", window_name: item.window_name || "", variant: "", item_note: item.item_note || "",
  }));
  const legacyAmount = !saved && (sale.discount_amount || 0) > 0 && (sale.discount_percent || 0) === 0;
  const discount = saved?.discount_percent ?? (legacyAmount ? (sale.sub_total ? roundMoney(sale.discount_amount / sale.sub_total * 100) : 0) : sale.discount_percent ?? (sale.sub_total ? roundMoney((sale.discount_amount || 0) / sale.sub_total * 100) : 0));
  const deliveryMethod = saved?.delivery_method || sale.delivery_method || header.delivery_method || "magaza";
  return { cart, discount, header: { first_name: header.first_name ?? words.shift() ?? "", last_name: header.last_name ?? words.join(" "), customer_phone: sale.customer_phone || "", customer_address: sale.customer_address || "", delivery_date: sale.delivery_date ? String(sale.delivery_date).slice(0, 10) : "", sale_note: sale.sale_note || "", payment_method: sale.payment_method || "Nakit", ...header, delivery_method: deliveryMethod === "installation" ? "montaj" : deliveryMethod === "store" ? "magaza" : deliveryMethod } };
}
