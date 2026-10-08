import { formatMoney, formatNumber, orderTotals, restoreSaleDraft } from "./curtainCalculation.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const safe = escapeHtml;
const number = (value) => safe(formatNumber(value));
const money = (value) => safe(formatMoney(value));
const date = (value) => value ? safe(new Date(value).toLocaleDateString("tr-TR")) : "—";

function documentShell(title, content, logoUrl) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><style>
  @page { size:A4 portrait; margin:10mm; } * { box-sizing:border-box; } body { margin:0; font:15px/1.45 Arial,'Segoe UI',sans-serif; color:#443325; background:#f4ebdd; } .sheet { width:190mm; margin:12px auto; background:#fffdf8; padding:9mm; } .brand { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:2px solid #8b5a34; padding-bottom:10px; margin-bottom:14px; } .brand img { width:53mm; height:29mm; object-fit:contain; } h1 { margin:0 0 6px; font-size:23px; } h2 { font-size:17px; margin:10px 0; } p { margin:5px 0; } .meta { background:#f4ecdf; padding:10px 12px; border-radius:7px; margin:10px 0 15px; } .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 14px; } .full { grid-column:1/-1; } table { width:100%; border-collapse:collapse; font-size:14px; } th { background:#efe0ca; padding:9px 7px; text-align:left; } td { padding:11px 7px; border-bottom:1px solid #d8c6ae; vertical-align:top; overflow-wrap:anywhere; } tr { break-inside:avoid; } thead { display:table-header-group; } .right { text-align:right; white-space:nowrap; } .detail { font-size:13px; color:#66513e; margin-top:5px; } .totals { margin:18px 0 12px auto; width:90mm; break-inside:avoid; } .totals p { display:flex; justify-content:space-between; gap:10px; padding:5px 0; } .net { border-top:2px solid #8b5a34; font-size:22px; font-weight:bold; } .footer { margin-top:18px; font-size:12px; border-top:1px solid #d8c6ae; padding-top:10px; } .toolbar { position:sticky; top:0; display:flex; justify-content:center; gap:10px; padding:12px; background:#443325; color:#fff; z-index:2; font-size:14px; } .toolbar button { cursor:pointer; background:#fff8ef; color:#593d29; padding:11px 18px; border:0; border-radius:6px; font-size:16px; font-weight:bold; } .plan-sheet { break-after:page; min-height:270mm; } .plan-sheet:last-child { break-after:auto; } .plan-grid { display:grid; grid-template-columns:1fr 1fr; gap:8mm 6mm; } .plan-box { min-height:46mm; border:1.5px solid #a78159; border-radius:5px; padding:3mm; break-inside:avoid; font-size:13px; } .plan-box h2 { font-size:15px; margin:0 0 4px; } .sketch-row { display:flex; justify-content:space-around; gap:5mm; margin-top:6px; } .sketch { text-align:center; flex:1; font-weight:bold; font-size:14px; } .sketch svg { height:43px; width:100%; max-width:100px; } .box-total { margin-top:5px; padding-top:4px; border-top:1px solid #decdb7; font-size:14px; font-weight:bold; } .blank { color:#baa58d; } .notes { font-size:14px; white-space:pre-wrap; } @media print { body { background:white; } .sheet { width:auto; margin:0; padding:0; } .toolbar { display:none; } .brand,.meta,th { print-color-adjust:exact; -webkit-print-color-adjust:exact; } .plan-grid { gap:5mm; } .plan-box { min-height:46mm; } }
  .plan-sheet .brand img{width:40mm;height:20mm}.plan-sheet .brand{margin-bottom:8px;padding-bottom:8px}.plan-sheet .meta{margin:6px 0 10px;padding:7px 10px;font-size:14px;line-height:1.35;gap:4px 12px}.plan-sheet .plan-grid{gap:4mm}.plan-sheet .plan-box{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 3mm;min-height:48mm;padding:2.5mm;align-content:start}.plan-sheet .plan-box h2{grid-column:1/-1;margin:0 0 1mm;font-size:15px;line-height:1.25}.plan-sheet .plan-box>div{grid-column:1;line-height:1.25;overflow-wrap:anywhere}.plan-sheet .plan-box>.sketch-row{grid-column:2;grid-row:2/5;align-self:start;margin-top:0;gap:2mm}.plan-sheet .sketch{font-size:13px;line-height:1.2}.plan-sheet .sketch svg{height:27px;max-width:75px}.plan-sheet .plan-box>.box-total{grid-column:1/-1;margin-top:1mm;padding-top:1mm;font-size:14px}.plan-sheet .plan-box.blank{display:block}.plan-sheet .footer{margin-top:10px;padding-top:6px;font-size:11px;line-height:1.3}
  </style></head><body><div class="toolbar"><button onclick="window.print()">PDF olarak kaydet / Yazdır</button><span>Kağıt boyutu: A4</span></div>${content.replaceAll("__LOGO__", safe(logoUrl))}</body></html>`;
}

function heading(title, sale, pageLabel = "") {
  return `<header class="brand"><img src="__LOGO__" alt="Şahinsoy Perde & Döşemelik"><div><h1>${safe(title)}</h1><p>No: ${safe(String(sale._id || "").slice(-8).toUpperCase())}</p>${pageLabel ? `<p>${safe(pageLabel)}</p>` : ""}</div></header>`;
}

function customerMeta(sale, header) {
  return `<section class="meta meta-grid"><div><strong>Müşteri:</strong> ${safe(sale.customer_name || [header.first_name, header.last_name].filter(Boolean).join(" "))}</div><div><strong>Telefon:</strong> ${safe(sale.customer_phone || header.customer_phone || "—")}</div><div><strong>Teslim tarihi:</strong> ${date(sale.delivery_date || header.delivery_date)}</div><div><strong>Teslim:</strong> [${["montaj", "installation"].includes(header.delivery_method) || ["montaj", "installation"].includes(sale.delivery_method) ? "X" : " "}] Montaj · [${["montaj", "installation"].includes(header.delivery_method) || ["montaj", "installation"].includes(sale.delivery_method) ? " " : "X"}] Mağaza teslimi</div><div class="full"><strong>Adres:</strong> ${safe(sale.customer_address || header.customer_address || "—")}</div></section>`;
}

function lineLocation(line) {
  return [line.room_name, line.area, line.facade, line.window_name].filter(Boolean).map(safe).join(" · ");
}

export function createCustomerOrderHtml(sale, logoUrl = "/sahinsoy-logo.svg") {
  const { cart, header, discount } = restoreSaleDraft(sale);
  const totals = orderTotals(cart, discount);
  const rows = cart.map((line) => {
    const dimensions = line.panels?.length ? line.panels.map((panel) => `${safe(panel.label)}: ${number(panel.width)} × ${number(panel.height)} cm`).join(" · ") : (line.width || line.height ? `${number(line.width)} × ${number(line.height)} cm` : "");
    const quantityLabel = line.mode === "fon" ? `${number(line.count)} ${line.order_mode === "takim" ? "takım" : "adet"} (${number(line.pieces)} kanat)` : line.mode === "textile" ? `${number(line.pieces)} parça` : `${number(line.pieces)} adet`;
    const extras = (line.accessories || []).map((option) => `<div class="detail">${safe(option.name)}: ${number(option.quantity)} ${safe(option.unit)} × ${money(option.unit_price)} = ${money(option.total)}</div>`).join("");
    return `<tr><td><strong>${safe(line.product_name)}</strong><div class="detail">${safe(line.brand_name)}${line.variant ? ` · Renk / VR: ${safe(line.variant)}` : ""}</div>${line.fabric_width_cm || line.grammage_gr ? `<div class="detail">${line.fabric_width_cm ? `Kumaş eni ${number(line.fabric_width_cm)} cm` : ""}${line.grammage_gr ? ` · Gramaj ${number(line.grammage_gr)} g` : ""}</div>` : ""}<div class="detail">${lineLocation(line)}</div><div class="detail">${dimensions}${dimensions ? " · " : ""}${quantityLabel}${line.pleat_name ? ` · ${safe(line.pleat_name)}` : ""}</div>${line.item_note ? `<div class="detail">Not: ${safe(line.item_note)}</div>` : ""}${extras}</td><td class="right">${number(line.quantity)} ${safe(line.unit_label)}<div class="detail">${line.mode === "fon" || line.mode === "textile" ? "Giden kumaş" : "Hesaplanan miktar"}</div></td><td class="right">${money(line.base_unit_price)}<div class="detail">${money(line.material_total)} ürün</div>${line.labor_total ? `<div class="detail">${number(line.quantity)} m × ${money(line.labor_unit_price)} işçilik<br>${money(line.labor_total)}</div>` : ""}</td><td class="right"><strong>${money(line.item_total)}</strong></td></tr>`;
  }).join("");
  const content = `<main class="sheet">${heading(sale.status === "beklemede" ? "Teklif / Sipariş Kağıdı" : "Sipariş Kağıdı", sale)}${customerMeta(sale, header)}<table><thead><tr><th>Ürün ve ölçüler</th><th class="right">Miktar</th><th class="right">Birim fiyat / işçilik</th><th class="right">Tutar</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><p><span>Ara toplam</span><strong>${money(sale.sub_total ?? totals.subtotal)}</strong></p><p><span>İskonto (%${number(discount)})</span><strong>− ${money(sale.discount_amount ?? totals.discountAmount)}</strong></p><p class="net"><span>Ödenecek</span><span>${money(sale.grand_total ?? totals.total)}</span></p></div><p>Ödeme şekli: ${safe(sale.payment_method || header.payment_method || "Nakit")}</p>${sale.sale_note || header.sale_note ? `<p class="notes"><strong>Sipariş notu:</strong> ${safe(sale.sale_note || header.sale_note)}</p>` : ""}<div class="footer">${sale.status === "tamamlandi" ? "Sipariş onaylandı." : "Teklif beklemede."} · Ölçüler santimetre cinsindedir. Bu belge sipariş bilgilendirme kağıdıdır.</div></main>`;
  return documentShell("Şahinsoy · Sipariş Kağıdı", content, logoUrl);
}

function curtainSketch(fon, panel) {
  const drawing = fon ? '<path d="M18 8H80V52L57 57Q44 39 31 53L18 55Z" fill="#ead6bc" stroke="#80512f" stroke-width="2"/><path d="M29 8L31 52M41 8L42 46M53 8L55 48M66 8L71 53" stroke="#a17a55" fill="none"/>' : '<rect x="12" y="8" width="78" height="47" fill="#f5ebdd" stroke="#80512f" stroke-width="2"/><path d="M25 8V55M38 8V55M51 8V55M64 8V55M77 8V55" stroke="#ad8965"/>';
  return `<div class="sketch"><div>${safe(panel.label)} · En ${number(panel.width)} cm</div><svg viewBox="0 0 104 65" aria-label="Perde çizimi">${drawing}</svg><div>Boy ${number(panel.height)} cm</div><div class="detail">Kesim eni ${number(panel.cut_width)} cm</div></div>`;
}

export function manufacturingBoxes(cart) {
  const boxes = [];
  for (const line of cart) {
    if (line.mode === "fon") {
      for (let index = 0; index < line.count; index++) boxes.push({ line, sequence: index + 1, quantity: line.panels.reduce((sum, panel) => sum + panel.cut_width / 100, 0), panels: line.panels });
    } else if (line.mode === "textile") {
      for (let index = 0; index < line.pieces; index++) boxes.push({ line, sequence: index + 1, quantity: line.quantity / line.pieces, panels: line.panels });
    } else {
      boxes.push({ line, sequence: 1, quantity: line.quantity, panels: line.width ? [{ label: `${line.pieces} adet`, width: line.width, height: line.height, cut_width: line.width }] : [] });
    }
  }
  return boxes;
}

export function createManufacturingHtml(sale, logoUrl = "/sahinsoy-logo.svg") {
  const { cart, header } = restoreSaleDraft(sale);
  const boxes = manufacturingBoxes(cart);
  const pageCount = Math.max(1, Math.ceil(boxes.length / 8));
  let content = "";
  for (let page = 0; page < pageCount; page++) {
    const slots = Array.from({ length: 8 }, (_, slot) => {
      const box = boxes[page * 8 + slot];
      if (!box) return '<section class="plan-box blank">—</section>';
      const line = box.line;
      return `<section class="plan-box"><h2>${safe(line.product_name)}${line.mode === "fon" ? ` · ${box.sequence}. ${line.order_mode === "takim" ? "takım" : "adet"}` : line.mode === "textile" ? ` · ${box.sequence}. parça` : ""}</h2><div>${lineLocation(line)}</div><div>${safe(line.brand_name)}${line.variant ? ` · Renk / VR: ${safe(line.variant)}` : ""}${line.pleat_name ? ` · ${safe(line.pleat_name)}` : ""}</div>${line.fabric_width_cm || line.grammage_gr ? `<div>${line.fabric_width_cm ? `Kumaş eni ${number(line.fabric_width_cm)} cm` : ""}${line.grammage_gr ? ` · ${number(line.grammage_gr)} g` : ""}</div>` : ""}<div class="sketch-row">${box.panels.map((panel) => curtainSketch(line.mode === "fon", panel)).join("")}</div><div class="box-total">${line.mode === "fon" || line.mode === "textile" ? "Giden kumaş" : "Miktar"}: ${number(box.quantity)} ${safe(line.unit_label)}</div>${line.accessories?.length ? `<div>${line.accessories.map((option) => safe(option.name)).join(" · ")}</div>` : ""}${line.item_note ? `<div>Not: ${safe(line.item_note)}</div>` : ""}</section>`;
    }).join("");
    content += `<main class="sheet plan-sheet">${heading("Atölye Takip Formu", sale, `Sayfa ${page + 1} / ${pageCount}`)}${customerMeta(sale, header)}<div class="plan-grid">${slots}</div>${sale.sale_note || header.sale_note ? `<p class="notes"><strong>Not:</strong> ${safe(sale.sale_note || header.sale_note)}</p>` : ""}<p class="footer">${cart.some((line) => line.mode === "fon") ? `Toplam ${cart.filter((line) => line.mode === "fon").reduce((sum, line) => sum + line.pieces, 0)} fon kanadı · ` : ""}${cart.some((line) => line.mode === "fon" || line.mode === "textile") ? `Toplam giden kumaş: ${number(cart.filter((line) => line.mode === "fon" || line.mode === "textile").reduce((sum, line) => sum + line.quantity, 0))} m` : "Ölçüler santimetre cinsindedir"} · Boy ölçüsü imalat içindir. Dikiş payı her kanatta / parçada 40 cm olarak hesaba dahildir.</p></main>`;
  }
  return documentShell("Şahinsoy · Atölye Takip Formu", content, logoUrl);
}

export function openCurtainPrint(sale, kind = "customer") {
  if (!sale?._id) throw new Error("Önce siparişi kaydedin.");
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Çıktıyı açmak için tarayıcıda açılır pencerelere izin verin.");
  popup.opener = null;
  const logo = new URL("/sahinsoy-logo.svg", window.location.origin).href;
  popup.document.write(kind === "manufacturing" ? createManufacturingHtml(sale, logo) : createCustomerOrderHtml(sale, logo));
  popup.document.close();
}
