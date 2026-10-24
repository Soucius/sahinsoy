import { paymentSummary } from "../../../backend/src/libs/orderPayments.js";
import { discountLabel } from "./agreedPrice.js";
import { discountedCart } from "./discountPresentation.js";
import { formatMoney, formatNumber, normalizeName, usesWidthOnlyMeasurements, measurementSourceLabel, mechanicalPanelPosition, needsControlDirection, orderTotals, paymentConversion, productMode, restoreSaleDraft, showFabricSpecs } from "./curtainCalculation.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const safe = escapeHtml;
const number = (value, decimals = 2) => safe(formatNumber(value, decimals));
const money = (value) => safe(formatMoney(value));
const date = (value) => value ? safe(new Date(value).toLocaleDateString("tr-TR")) : "—";
const fabricLine = (line) => line.mode === "fon" || line.mode === "textile";
function manufacturingMode(line) {
  if (!line || typeof line !== "object") return null;
  if (fabricLine(line)) return line.mode;
  if (line.mode && line.mode !== "standard") return null;
  const mode = productMode({ ...line, calculation_type: line.calc_type || line.calculation_type });
  return mode === "textile" || mode === "fon" ? mode : null;
}

function manufacturingItems(cart) {
  return Array.isArray(cart) ? cart.flatMap((line) => {
    const mode = manufacturingMode(line);
    return mode ? [{ ...line, mode }] : [];
  }) : [];
}

export function hasManufacturingItems(cart) {
  return Array.isArray(cart) && cart.some((line) => Boolean(manufacturingMode(line)));
}

const mechanicalParts = (line) => Array.isArray(line.mechanical_panels) && line.mechanical_panels.length ? line.mechanical_panels : null;
const percentageOption = (option) => option.pricing_basis === "yuzde" || option.unit === "%";
const rate = (value) => safe(Number(value || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 }));
const accessoryLabel = (option) => `${safe(option.name)}${Number.isSafeInteger(option.count_per_piece) && option.count_per_piece > 1 ? ` · ${number(option.count_per_piece, 0)} adet / perde` : ""}${typeof option.color === "string" && option.color.trim() ? ` (Renk: ${safe(option.color.trim())})` : ""}`;

function dualPliseGroups(cart) {
  const candidates = new Map();
  cart.forEach((line, index) => {
    const metadata = line?.dual_plise;
    if (!metadata || metadata.version !== 1 || typeof metadata.group_id !== "string" || !metadata.group_id.trim() || !["tul", "guneslik"].includes(metadata.role)) return;
    const members = candidates.get(metadata.group_id) || [];
    members.push({ index, line, metadata });
    candidates.set(metadata.group_id, members);
  });
  const groups = new Map();
  let ordinal = 0;
  for (const members of candidates.values()) {
    if (members.length !== 2 || members[0].metadata.role === members[1].metadata.role) continue;
    const [first, second] = members;
    if (["room_name", "area", "facade", "window_name", "width", "count"].some((key) => first.line[key] !== second.line[key]) || ["glass_label", "case_color"].some((key) => first.metadata[key] !== second.metadata[key]) || !members.every(({ line }) => Number.isFinite(line.item_total))) continue;
    const total = members.reduce((sum, { line }) => sum + line.item_total, 0);
    if (!Number.isFinite(total)) continue;
    const number = ++ordinal;
    for (const member of members) groups.set(member.index, { ...member.metadata, number, total, last: member.index === second.index });
  }
  return groups;
}

function motorSystemGroups(cart) {
  const candidates = new Map();
  cart.forEach((line, index) => {
    const metadata = line?.motor_system;
    if (!metadata || metadata.version !== 1 || typeof metadata.group_id !== "string" || !metadata.group_id.trim() || metadata.quantity_basis !== "piece" || !["curtain", "motor"].includes(metadata.role)) return;
    const members = candidates.get(metadata.group_id) || [];
    members.push({ line, index, metadata });
    candidates.set(metadata.group_id, members);
  });
  const groups = new Map();
  let ordinal = 0;
  for (const members of candidates.values()) {
    if (members.length !== 2 || members[0].metadata.role === members[1].metadata.role) continue;
    const curtain = members.find(({ metadata }) => metadata.role === "curtain").line;
    const motor = members.find(({ metadata }) => metadata.role === "motor").line;
    if (["room_name", "area", "facade", "window_name"].some((key) => curtain[key] !== motor[key]) || motor.quantity !== curtain.pieces || !members.every(({ line }) => Number.isFinite(line.item_total))) continue;
    const total = members.reduce((sum, { line }) => sum + line.item_total, 0);
    if (!Number.isFinite(total)) continue;
    const number = ++ordinal;
    for (const member of members) groups.set(member.index, { ...member.metadata, number, total, last: member.index === members[1].index });
  }
  return groups;
}

const dualPliseRole = (dual) => dual.role === "tul" ? "Tül" : "Güneşlik";
const dualPliseDescription = (dual) => `Çiftli plise ${dual.number} · ${dualPliseRole(dual)}`;

function dualPliseDetails(dual) {
  return `${dual.glass_label ? `Cam: ${safe(dual.glass_label)}` : ""}${dual.case_color ? `${dual.glass_label ? " · " : ""}Kasa rengi: ${safe(dual.case_color)}` : ""}`;
}

function billingDetail(line) {
  if (usesWidthOnlyMeasurements(line)) return line.calculation_note ? `<div class="detail">${safe(line.calculation_note)}</div>` : "";
  if (line.calc_type !== "m2" && !(line.calc_type === "mt" && line.mode === "mechanical")) return "";
  const changed = !mechanicalParts(line) && Number.isFinite(line.billable_width) && (line.calc_type === "mt" ? line.billable_width !== line.width : Number.isFinite(line.billable_height) && (line.billable_width !== line.width || line.billable_height !== line.height));
  return `${changed ? `<div class="detail">${line.calc_type === "mt" ? `Hesap eni: ${number(line.billable_width)} cm` : `Hesap ölçüsü: ${number(line.billable_width)} × ${number(line.billable_height)} cm`}</div>` : ""}${line.calculation_note ? `<div class="detail">${safe(line.calculation_note)}</div>` : ""}`;
}

function mechanicalPartDetails(panel, line, includeBilling = false) {
  const variant = panel.variant || line.variant || "Belirtilmedi";
  const index = Math.max(0, mechanicalParts(line)?.indexOf(panel) ?? 0);
  const position = String(panel.position || mechanicalPanelPosition(index, mechanicalParts(line)?.length || 1)).replace(/^Tek parça$/, "Tek");
  const changed = includeBilling && Number.isFinite(panel.billable_width) && (line.calc_type === "mt" ? panel.billable_width !== panel.width : Number.isFinite(panel.billable_height) && (panel.billable_width !== panel.width || panel.billable_height !== panel.height));
  const direction = panel.chain_direction || needsControlDirection({ ...line, calculation_type: line.calc_type }) ? ` · ${line.motor_system?.role === "curtain" ? "Motor yönü" : "Zincir / ip yönü"}: ${safe(panel.chain_direction || "Belirtilmedi")}` : "";
  const dimensions = panel.height > 0 ? `${number(panel.width)} × ${number(panel.height)} cm` : `En ${number(panel.width)} cm`;
  return `<div class="mechanical-part"><strong>${safe(position)} ${line.case_mode === "ortak" ? "parça" : "kasa"}: ${dimensions}</strong><div>Renk / VR: ${safe(variant)}${direction}</div>${changed ? `<div>${line.calc_type === "mt" ? `Hesap eni: ${number(panel.billable_width)} cm` : `Hesap ölçüsü: ${number(panel.billable_width)} × ${number(panel.billable_height)} cm`}</div>` : ""}</div>`;
}

function caseDescription(line) {
  return `${number(line.case_count, 0)} kasa · ${number(line.pieces, 0)} parça · ${line.case_mode === "ortak" ? "Ortak kasa" : "Ayrı kasalar"}${line.count > 1 ? ` · ${number(line.count, 0)} ölçü grubu` : ""}${line.case_mode === "ortak" ? ` · Toplam parça eni ${number(line.case_width)} cm${Number(line.profile_width_cm) > 0 ? ` · Kasa / profil eni: ${number(line.profile_width_cm)} cm (imalat bilgisi)` : ""}` : ""}`;
}

function manufacturingFooter(cart) {
  const fabrics = cart.filter(fabricLine);
  const parts = ["Ölçüler santimetre cinsindedir."];
  if (cart.some((line) => line.mode === "fon")) parts.push(`Toplam ${cart.filter((line) => line.mode === "fon").reduce((sum, line) => sum + line.pieces, 0)} fon kanadı.`);
  if (fabrics.length) {
    parts.push(`Toplam giden kumaş: ${number(fabrics.reduce((sum, line) => sum + line.quantity, 0))} m.`);
    parts.push("Tül ve fon ürünlerinde boy ölçüsü imalat içindir. Dikiş payı her kanatta / parçada 40 cm olarak hesaba dahildir.");
  }
  return parts.join(" ");
}

function documentShell(title, content, logoUrl) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><style>
  @page { size:A4 portrait; margin:10mm; } * { box-sizing:border-box; } body { margin:0; font:15px/1.45 Arial,'Segoe UI',sans-serif; color:#443325; background:#f4ebdd; } .sheet { width:190mm; margin:12px auto; background:#fffdf8; padding:9mm; } .brand { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:2px solid #8b5a34; padding-bottom:10px; margin-bottom:14px; } .brand-name { color:#754b2e; font:600 28px/1.2 Georgia,serif; letter-spacing:.08em; white-space:nowrap; } h1 { margin:0 0 6px; font-size:23px; } h2 { font-size:17px; margin:10px 0; } p { margin:5px 0; } .meta { background:#f4ecdf; padding:10px 12px; border-radius:7px; margin:10px 0 15px; } .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 14px; } .full { grid-column:1/-1; } table { width:100%; border-collapse:collapse; font-size:14px; } th { background:#efe0ca; padding:9px 7px; text-align:left; } td { padding:11px 7px; border-bottom:1px solid #d8c6ae; vertical-align:top; overflow-wrap:anywhere; } tr { break-inside:avoid; } thead { display:table-header-group; } .right { text-align:right; white-space:nowrap; } .detail { font-size:13px; color:#66513e; margin-top:5px; } .totals { margin:18px 0 12px auto; width:90mm; break-inside:avoid; } .totals p { display:flex; justify-content:space-between; gap:10px; padding:5px 0; } .net { border-top:2px solid #8b5a34; font-size:22px; font-weight:bold; } .footer { margin-top:18px; font-size:12px; border-top:1px solid #d8c6ae; padding-top:10px; } .toolbar { position:sticky; top:0; display:flex; justify-content:center; gap:10px; padding:12px; background:#443325; color:#fff; z-index:2; font-size:14px; } .toolbar button { cursor:pointer; background:#fff8ef; color:#593d29; padding:11px 18px; border:0; border-radius:6px; font-size:16px; font-weight:bold; } .plan-sheet { break-after:page; min-height:270mm; } .plan-sheet:last-child { break-after:auto; } .plan-grid { display:grid; grid-template-columns:1fr 1fr; gap:8mm 6mm; } .plan-box { min-height:46mm; border:1.5px solid #a78159; border-radius:5px; padding:3mm; break-inside:avoid; font-size:13px; } .plan-box h2 { font-size:15px; margin:0 0 4px; } .sketch-row { display:flex; justify-content:space-around; gap:5mm; margin-top:6px; } .sketch { text-align:center; flex:1; font-weight:bold; font-size:14px; } .sketch svg { height:43px; width:100%; max-width:100px; } .box-total { margin-top:5px; padding-top:4px; border-top:1px solid #decdb7; font-size:14px; font-weight:bold; } .blank { color:#baa58d; } .notes { font-size:14px; white-space:pre-wrap; } @media print { body { background:white; } .sheet { width:auto; margin:0; padding:0; } .toolbar { display:none; } .brand,.meta,th { print-color-adjust:exact; -webkit-print-color-adjust:exact; } .plan-grid { gap:5mm; } .plan-box { min-height:46mm; } }
  .plan-sheet .brand-name{font-size:25px}.plan-sheet .brand{margin-bottom:8px;padding-bottom:8px}.plan-sheet .meta{margin:6px 0 10px;padding:7px 10px;font-size:14px;line-height:1.35;gap:4px 12px}.plan-sheet .plan-grid{gap:4mm}.plan-sheet .plan-box{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 3mm;min-height:48mm;padding:2.5mm;align-content:start}.plan-sheet .plan-box h2{grid-column:1/-1;margin:0 0 1mm;font-size:15px;line-height:1.25}.plan-sheet .plan-box>div{grid-column:1;line-height:1.25;overflow-wrap:anywhere}.plan-sheet .plan-box>.sketch-row{grid-column:2;grid-row:2/5;align-self:start;margin-top:0;gap:2mm}.plan-sheet .sketch{font-size:13px;line-height:1.2}.plan-sheet .sketch svg{height:27px;max-width:75px}.plan-sheet .plan-box>.box-total{grid-column:1/-1;margin-top:1mm;padding-top:1mm;font-size:14px}.plan-sheet .plan-box.blank{display:block}.plan-sheet .footer{margin-top:10px;padding-top:6px;font-size:11px;line-height:1.3}.mechanical-part{margin-top:5px;font-size:13px;line-height:1.35;overflow-wrap:anywhere}.plan-sheet .mechanical-case>div{grid-column:1/-1}.plan-sheet .mechanical-case>.mechanical-parts{display:grid;gap:1mm}.plan-sheet .mechanical-part{margin-top:0;line-height:1.25}.plan-sheet .case-caption{margin:1mm 0;font-weight:bold}
  </style></head><body><div class="toolbar"><button onclick="window.print()">PDF olarak kaydet / Yazdır</button><span>Kağıt boyutu: A4</span></div>${content.replaceAll("__LOGO__", safe(logoUrl))}</body></html>`;
}

function heading(title, sale, pageLabel = "") {
  const revision = Number(sale.measurement_revision) || 0;
  const status = sale.measurement_status || sale.pos_details?.header?.measurement_status || "preliminary";
  const label = status === "confirmed" ? "ÖLÇÜ TEYİT EDİLDİ" : status === "scheduled" ? "ÖN ÖLÇÜ · YERİNDE TEYİT PLANLANDI" : "ÖN ÖLÇÜ · TEYİT BEKLİYOR";
  return `<header class="brand"><strong class="brand-name">ŞAHİNSOY</strong><div><h1>${safe(title)}</h1><p>No: ${safe(String(sale._id || "").slice(-8).toUpperCase())}${revision ? ` · Ölçü kaydı ${number(revision, 0)}` : ""}${pageLabel ? ` · ${safe(pageLabel)}` : ""}</p><p style="font-size:13px;font-weight:bold;line-height:1.2">${safe(label)}</p></div></header>`;
}

function customerMeta(sale, header, includeMeasurement = false) {
  const installation = ["montaj", "installation"].includes(header.delivery_method) || ["montaj", "installation"].includes(sale.delivery_method);
  const status = sale.measurement_status || header.measurement_status || "preliminary";
  const measurement = includeMeasurement ? ` · <span style="white-space:nowrap" title="${status === "confirmed" ? "Ölçü teyit edildi" : "Yerinde ölçü / teyit bekleniyor"}">[${status === "confirmed" ? " " : "X"}] Ölçü</span>` : "";
  return `<section class="meta meta-grid"><div><strong>Müşteri:</strong> ${safe(sale.customer_name || [header.first_name, header.last_name].filter(Boolean).join(" "))}</div><div><strong>Telefon:</strong> ${safe(sale.customer_phone || header.customer_phone || "—")}</div><div><strong>Teslim tarihi:</strong> ${date(sale.delivery_date || header.delivery_date)}</div><div><strong>Teslim:</strong> [${installation ? "X" : " "}] Montaj · [${installation ? " " : "X"}] Mağaza teslimi${measurement}</div><div class="full"><strong>Ölçü kaynağı:</strong> ${safe(measurementSourceLabel(sale.measurement_source || "unspecified"))}</div><div class="full"><strong>Adres:</strong> ${safe(sale.customer_address || header.customer_address || "—")}</div></section>`;
}

function lineLocation(line) {
  return [line.room_name, line.area, line.facade, line.window_name].filter(Boolean).map(safe).join(" · ");
}

function controlDirection(line) {
  return line.chain_direction && !mechanicalParts(line) ? `<div class="detail">${line.motor_system?.role === "curtain" ? "Motor yönü" : "Zincir / ip yönü"}: ${safe(line.chain_direction)}</div>` : "";
}

const sumPrintMoney = (values) => values.reduce((sum, value) => sum + Math.round(Number(value || 0) * 100), 0) / 100;
const printOptionKey = (option) => [option.name, option.color || "", option.unit, option.unit_price, option.pricing_basis, option.pricing_scope, option.count_per_piece, percentageOption(option) ? option.quantity : null];

// Presentation only. Keep the stored glass measurements and each piece's minimum
// billable area intact; add recorded quantities/amounts instead of recalculating.
export function customerPrintEntries(cart) {
  const entries = [], groups = new Map();
  cart.forEach((line, index) => {
    const eligible = line.calc_type === "m2" && /plise|plisel|honeycomb/.test(normalizeName(`${line.category_name || ""} ${line.product_name || ""}`)) && !line.motor_system && !mechanicalParts(line) && Number.isFinite(line.quantity) && line.quantity > 0;
    const key = eligible ? JSON.stringify([
      line.product_id, line.product_name, line.brand_name, line.variant || "", line.unit_label,
      line.base_unit_price, line.labor_unit_price || 0, line.labor_basis, line.case_color || "", line.chain_direction || "",
      line.dual_plise?.role || "", line.dual_plise?.case_color || "", line.item_note || "",
      line.discount_display?.percent, line.discount_display?.original_unit_price,
      (line.accessories || []).map(printOptionKey),
    ]) : null;
    if (key && groups.has(key)) groups.get(key).members.push(line);
    else {
      const entry = { line, index, members: [line] };
      entries.push(entry); if (key) groups.set(key, entry);
    }
  });
  return entries.map(entry => {
    if (entry.members.length === 1) return entry;
    const members = entry.members;
    const line = { ...entry.line,
      quantity: Math.round(members.reduce((sum, item) => sum + item.quantity, 0) * 1e6) / 1e6,
      pieces: members.reduce((sum, item) => sum + Number(item.pieces || item.count || 1), 0),
      material_total: sumPrintMoney(members.map(item => item.material_total)),
      labor_total: sumPrintMoney(members.map(item => item.labor_total)),
      item_total: sumPrintMoney(members.map(item => item.item_total)),
      accessories: (entry.line.accessories || []).map((option, index) => ({ ...option,
        quantity: percentageOption(option) ? option.quantity : Math.round(members.reduce((sum, item) => sum + Number(item.accessories[index].quantity || 0), 0) * 1e6) / 1e6,
        total: sumPrintMoney(members.map(item => item.accessories[index].total)),
      })),
    };
    return { ...entry, line };
  });
}

function compactPliseRow({ line, members }) {
  const rooms = [...new Set(members.map(item => [item.room_name, item.facade].filter(Boolean).join(" · ")).filter(Boolean))];
  const caseOption = option => /^kasa\s*\/\s*donanim\s*rengi\s*:/.test(normalizeName(option.name));
  const caseColor = line.dual_plise?.case_color || line.case_color || line.accessories.find(caseOption)?.name.split(':').slice(1).join(':').trim();
  const extras = line.accessories.filter(option => !caseOption(option) || Number(option.total) !== 0).map(option => `<div class="detail">${accessoryLabel(option)}: ${percentageOption(option) ? `%${rate(option.quantity)} → ${money(option.total)}` : `${number(option.quantity)} ${safe(option.unit)} × ${money(option.unit_price)} = ${money(option.total)}`}</div>`).join("");
  return `<tr class="plise-summary"><td><strong>${safe(line.product_name)}</strong><div class="detail">${safe(line.brand_name)}${line.variant ? ` · Renk / VR: ${safe(line.variant)}` : ""}</div>${line.dual_plise ? `<div class="detail">Çiftli plise · ${safe(dualPliseRole(line.dual_plise))}${caseColor ? ` · Kasa rengi: ${safe(caseColor)}` : ""}</div>` : caseColor ? `<div class="detail">Kasa rengi: ${safe(caseColor)}</div>` : ""}${rooms.length ? `<div class="detail">${rooms.map(safe).join(" / ")}</div>` : ""}<div class="detail">Toplam ${number(line.pieces, 0)} adet · Ölçüler sipariş kaydındadır.</div>${line.item_note ? `<div class="detail">Not: ${safe(line.item_note)}</div>` : ""}${extras}</td><td class="right"><strong>${number(line.quantity)} ${safe(line.unit_label)}</strong><div class="detail">Toplam fiyatlandırılan alan</div></td><td class="right">${line.discount_display ? `<div class="detail">Liste fiyatı<br><del>${money(line.discount_display.original_unit_price)}</del> · ${safe(discountLabel(line.discount_display.percent))} iskonto</div><strong>${money(line.base_unit_price)} / ${safe(line.unit_label)}</strong>` : `${money(line.base_unit_price)} / ${safe(line.unit_label)}`}${line.labor_total ? `<div class="detail">${money(line.material_total)} ürün<br>${money(line.labor_total)} işçilik</div>` : ""}</td><td class="right"><strong>${money(line.item_total)}</strong></td></tr>`;
}

export function createCustomerOrderHtml(sale, logoUrl = "/sahinsoy-logo.svg") {
  const { cart, header, discount } = restoreSaleDraft(sale);
  const totals = orderTotals(cart, discount);
  const displayCart = discountedCart(cart, discount);
  const dualGroups = dualPliseGroups(displayCart);
  const motorGroups = motorSystemGroups(displayCart);
  const printEntries = customerPrintEntries(displayCart);
  const compactedDualIds = new Set(printEntries.filter(entry => entry.members.length > 1).flatMap(entry => entry.members.map(line => line.dual_plise?.group_id).filter(Boolean)));
  const conversion = paymentConversion(sale.grand_total ?? totals.total, header);
  const paymentDetail = conversion.currency === "TRY" ? "" : `<section class="meta"><h2>Döviz ödeme karşılığı</h2><p><strong>${safe(formatMoney(conversion.amount, conversion.currency))}</strong> · TL toplamı: ${money(conversion.total_tl)}</p><p>1 ${safe(conversion.currency)} = ${number(conversion.rate, 4)} TL · ${conversion.rate_source === "Harem" ? "Harem alış kuru" : "Elle girilen ödeme kuru"}</p>${conversion.rate_source === "Harem" ? `<p>Kur zamanı: ${safe(new Date(conversion.quoted_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }))}</p>` : ""}<p class="detail">Döviz karşılığı, bu belgede belirtilen kurla hesaplanmıştır. Tahsilat makbuzu değildir.</p></section>`;
  const rows = printEntries.map(({ line, index: lineIndex, members }) => {
    if (members.length > 1) return compactPliseRow({ line, members });
    const originalDual = dualGroups.get(lineIndex);
    const dual = originalDual && compactedDualIds.has(originalDual.group_id) ? { ...originalDual, last: false } : originalDual;
    const motor = motorGroups.get(lineIndex);
    const parts = mechanicalParts(line);
    const dimensions = motor?.role === "motor" || parts ? "" : line.panels?.length ? line.panels.map((panel) => `${safe(panel.label)}: ${number(panel.width)} × ${number(panel.height)} cm`).join(" · ") : (usesWidthOnlyMeasurements(line) && line.width ? `En ${number(line.width)} cm` : line.width || line.height ? `${number(line.width)} × ${number(line.height)} cm` : "");
    const quantityLabel = motor?.role === "motor" ? `${number(line.quantity, 0)} motor · Her perde parçasına bir motor` : parts ? caseDescription(line) : line.mode === "fon" ? `${number(line.count)} ${line.order_mode === "takim" ? "takım" : "adet"} (${number(line.pieces)} kanat)` : line.mode === "textile" ? `${number(line.pieces)} parça` : `${number(line.pieces)} adet`;
    const extras = (line.accessories || []).map((option) => `<div class="detail">${accessoryLabel(option)}: ${percentageOption(option) ? `%${rate(option.quantity)} → ${money(option.total)}` : `${number(option.quantity)} ${safe(option.unit)} × ${money(option.unit_price)} = ${money(option.total)}`}</div>`).join("");
    return `<tr><td>${motor ? `<div class="detail"><strong>Motorlu sistem ${motor.number} · ${motor.role === "curtain" ? "Perde" : "Motor"}</strong></div>` : ""}${dual ? `<div class="detail"><strong>${safe(dualPliseDescription(dual))}</strong></div><div class="detail">${dualPliseDetails(dual)}</div>` : ""}<strong>${safe(line.product_name)}</strong><div class="detail">${safe(line.brand_name)}${line.variant ? ` · Renk / VR: ${safe(line.variant)}` : ""}</div>${controlDirection(line)}${showFabricSpecs(line) && (line.fabric_width_cm || line.grammage_gr) ? `<div class="detail">${line.fabric_width_cm ? `Kumaş eni ${number(line.fabric_width_cm)} cm` : ""}${line.grammage_gr ? ` · Gramaj ${number(line.grammage_gr)} g` : ""}</div>` : ""}<div class="detail">${lineLocation(line)}</div><div class="detail">${dimensions ? `Ölçü: ${dimensions} · ` : ""}${quantityLabel}${line.pleat_name ? ` · ${safe(line.pleat_name)}` : ""}</div>${parts ? parts.map((panel) => mechanicalPartDetails(panel, line, true)).join("") : ""}${billingDetail(line)}${line.item_note ? `<div class="detail">Not: ${safe(line.item_note)}</div>` : ""}${extras}</td><td class="right">${number(line.quantity)} ${safe(line.unit_label)}<div class="detail">${fabricLine(line) ? "Giden kumaş" : "Hesaplanan miktar"}</div></td><td class="right">${line.discount_display ? `<div class="detail">Liste fiyatı<br><del>${money(line.discount_display.original_unit_price)}</del> · ${safe(discountLabel(line.discount_display.percent))} iskonto</div><strong>${money(line.base_unit_price)} / ${safe(line.unit_label)}</strong><div class="detail">Net birim fiyat</div>` : money(line.base_unit_price)}<div class="detail">${money(line.material_total)} ürün</div>${line.labor_total ? `<div class="detail">${number(line.quantity)} m × ${money(line.labor_unit_price)} işçilik<br>${money(line.labor_total)}</div>` : ""}</td><td class="right"><strong>${money(line.item_total)}</strong></td></tr>${dual?.last ? `<tr class="dual-plise-total"><td colspan="3"><strong>Çiftli plise ${dual.number} toplamı</strong><div class="detail">Tül + güneşlik · Yukarıdaki iki kalemin toplamıdır.</div></td><td class="right"><strong>${money(dual.total)}</strong></td></tr>` : ""}${motor?.last ? `<tr class="motor-system-total"><td colspan="3"><strong>Motorlu sistem ${motor.number} toplamı</strong><div class="detail">Perde + motor · Yukarıdaki iki kalemin toplamıdır.</div></td><td class="right"><strong>${money(motor.total)}</strong></td></tr>` : ""}`;
  }).join("");
  const paid = paymentSummary(sale);
  const paymentHistory = `<section class="meta"><h2>Kapora ve ödeme durumu</h2><p><strong>${safe(paid.statusLabel)}</strong></p>${paid.records.filter((entry) => !entry.voided_at).map((entry) => `<p>${safe(entry.paid_date.split("-").reverse().join("."))} · ${safe(entry.kind)} · ${safe(entry.method)}: <strong>${money(entry.amount)}</strong></p>`).join("") || "<p>Bu belgede tahsilat kaydı bulunmuyor.</p>"}<p>Kayıtlı tahsilat: <strong>${money(paid.paid)}</strong></p><p>${paid.credit > 0 ? "Müşteri alacağı / iade değerlendirmesi" : "Kayıtlara göre kalan bakiye"}: <strong>${money(paid.credit || paid.balance)}</strong></p></section>`;
  const content = `<main class="sheet">${heading(sale.status === "beklemede" ? "Teklif / Sipariş Kağıdı" : "Sipariş Kağıdı", sale)}${customerMeta(sale, header)}<table><thead><tr><th>Ürün ve ölçüler</th><th class="right">Miktar</th><th class="right">${totals.discountPercent ? "Net birim fiyat / işçilik" : "Birim fiyat / işçilik"}</th><th class="right">${totals.discountPercent ? "Net tutar" : "Tutar"}</th></tr></thead><tbody>${rows}</tbody></table>${totals.discountPercent ? `<p class="detail">Birim fiyatlar ve kalem tutarları ${safe(discountLabel(totals.discountPercent))} iskonto uygulanmış net fiyatlardır. Kuruş yuvarlaması olabilir.</p>` : ""}<div class="totals"><p><span>${totals.discountPercent ? "İskonto öncesi toplam" : "Ara toplam"}</span><strong>${money(sale.sub_total ?? totals.subtotal)}</strong></p><p><span>İskonto (${safe(discountLabel(discount, 2))})</span><strong>− ${money(sale.discount_amount ?? totals.discountAmount)}</strong></p>${Number(sale.credit_card_fee) > 0 ? `<p><span>Kayıtlı ödeme farkı</span><strong>${money(sale.credit_card_fee)}</strong></p>` : ""}<p class="net"><span>Sipariş bedeli</span><span>${money(sale.grand_total ?? totals.total)}</span></p></div>${paymentDetail}${paymentHistory}${paid.balance > 0 ? `<section class="meta"><h2>Kalan ödeme planı</h2><p>Yöntem: <strong>${safe(sale.payment_method || header.payment_method || "Belirlenmedi")}</strong> · Zaman: <strong>${safe(header.balance_payment_due || "Belirlenmedi")}</strong></p>${header.payment_plan_note ? `<p class="notes">${safe(header.payment_plan_note)}</p>` : ""}</section>` : ""}${sale.sale_note || header.sale_note ? `<p class="notes"><strong>Sipariş notu:</strong> ${safe(sale.sale_note || header.sale_note)}</p>` : ""}<div class="footer">${sale.status === "teslim_edildi" ? "Sipariş teslim edildi." : sale.status === "tamamlandi" ? "Sipariş onaylandı." : "Teklif beklemede."} · Ölçüler santimetre cinsindedir. Bu belge sipariş bilgilendirme kağıdıdır.</div></main>`;
  return documentShell("Şahinsoy · Sipariş Kağıdı", content, logoUrl);
}

function curtainSketch(fon, panel, textile = true) {
  const drawing = fon ? '<path d="M18 8H80V52L57 57Q44 39 31 53L18 55Z" fill="#ead6bc" stroke="#80512f" stroke-width="2"/><path d="M29 8L31 52M41 8L42 46M53 8L55 48M66 8L71 53" stroke="#a17a55" fill="none"/>' : '<rect x="12" y="8" width="78" height="47" fill="#f5ebdd" stroke="#80512f" stroke-width="2"/><path d="M25 8V55M38 8V55M51 8V55M64 8V55M77 8V55" stroke="#ad8965"/>';
  return `<div class="sketch"><div>${safe(panel.label)} · En ${number(panel.width)} cm</div><svg viewBox="0 0 104 65" aria-label="Perde çizimi">${drawing}</svg><div>Boy ${number(panel.height)} cm</div>${textile ? `<div class="detail">Kesim eni ${number(panel.cut_width)} cm</div>` : ""}</div>`;
}

export function manufacturingBoxes(cart) {
  const boxes = [];
  for (const line of manufacturingItems(cart)) {
    const panels = Array.isArray(line.panels) ? line.panels : [];
    if (line.mode === "fon" && panels.length) {
      for (let index = 0; index < line.count; index++) boxes.push({ line, sequence: index + 1, quantity: panels.reduce((sum, panel) => sum + panel.cut_width / 100, 0), panels });
    } else if (line.mode === "textile" && panels.length) {
      for (let index = 0; index < line.pieces; index++) boxes.push({ line, sequence: index + 1, quantity: line.quantity / line.pieces, panels });
    } else {
      // Legacy fabric records may have a category but no saved cutting plan.
      boxes.push({ line, sequence: 1, quantity: line.quantity, panels: [], needs_cutting_details: true });
    }
  }
  return boxes;
}

export function createManufacturingHtml(sale, logoUrl = "/sahinsoy-logo.svg") {
  const { cart, header } = restoreSaleDraft(sale);
  const factoryCart = manufacturingItems(cart);
  const boxes = manufacturingBoxes(factoryCart);
  if (!boxes.length) throw new Error("Bu siparişte atölyede dikilecek ürün bulunmuyor.");
  const pageCount = Math.max(1, Math.ceil(boxes.length / 8));
  let content = "";
  for (let page = 0; page < pageCount; page++) {
    const slots = Array.from({ length: 8 }, (_, slot) => {
      const box = boxes[page * 8 + slot];
      if (!box) return '<section class="plan-box blank">—</section>';
      const line = box.line;
      return `<section class="plan-box"><h2>${safe(line.product_name)}${line.mode === "fon" ? ` · ${box.sequence}. ${line.order_mode === "takim" ? "takım" : "adet"}` : line.mode === "textile" ? ` · ${box.sequence}. parça` : ""}</h2><div>${lineLocation(line)}</div><div>${safe(line.brand_name)}${line.variant ? ` · Renk / VR: ${safe(line.variant)}` : ""}${line.pleat_name ? ` · ${safe(line.pleat_name)}` : ""}</div>${controlDirection(line)}${showFabricSpecs(line) && (line.fabric_width_cm || line.grammage_gr) ? `<div>${line.fabric_width_cm ? `Kumaş eni ${number(line.fabric_width_cm)} cm` : ""}${line.grammage_gr ? ` · ${number(line.grammage_gr)} g` : ""}</div>` : ""}<div class="sketch-row">${box.panels.map((panel) => curtainSketch(line.mode === "fon", panel, fabricLine(line))).join("")}</div><div class="box-total">${fabricLine(line) ? "Giden kumaş" : "Miktar"}: ${number(box.quantity)} ${safe(line.unit_label)}</div>${line.accessories?.length ? `<div>${line.accessories.map(accessoryLabel).join(" · ")}</div>` : ""}${box.needs_cutting_details ? `<div>Kesim ölçüleri kayıtlı değil; dikim öncesinde teyit edin.</div>` : ""}${line.item_note ? `<div>Not: ${safe(line.item_note)}</div>` : ""}</section>`;
    }).join("");
    content += `<main class="sheet plan-sheet">${heading("Atölye Takip Formu", sale, `Sayfa ${page + 1} / ${pageCount}`)}${customerMeta(sale, header, true)}<div class="plan-grid">${slots}</div>${sale.sale_note || header.sale_note ? `<p class="notes"><strong>Not:</strong> ${safe(sale.sale_note || header.sale_note)}</p>` : ""}<p class="footer">${manufacturingFooter(factoryCart)}</p></main>`;
  }
  return documentShell("Şahinsoy · Atölye Takip Formu", content, logoUrl);
}

export function openCurtainPrint(sale, kind = "customer") {
  if (!sale?._id) throw new Error("Önce siparişi kaydedin.");
  if (sale.status === "iptal") throw new Error("İptal edilmiş sipariş için çıktı hazırlanamaz.");
  if (kind === "manufacturing" && !hasManufacturingItems(restoreSaleDraft(sale).cart)) throw new Error("Bu siparişte atölyede dikilecek ürün bulunmuyor.");
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Çıktıyı açmak için tarayıcıda açılır pencerelere izin verin.");
  popup.opener = null;
  const logo = new URL("/sahinsoy-logo.svg", window.location.origin).href;
  popup.document.write(kind === "manufacturing" ? createManufacturingHtml(sale, logo) : createCustomerOrderHtml(sale, logo));
  popup.document.close();
}
