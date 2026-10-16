import { calculateCurtainLine, normalizeName, roundMoney, roundQuantity } from "./curtainCalculation.js";

export function supportsMeasurementBatch(product) {
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  return product?.calculation_type === "m2" && /plise|honeycomb/.test(category);
}

export function createMeasurementRow(values = {}) {
  return { width: String(values.width ?? ""), height: String(values.height ?? ""), count: String(values.count ?? "1"), label: String(values.label ?? ""), variant: String(values.variant ?? "") };
}

export function calculateMeasurementBatch(product, common, rows) {
  if (!supportsMeasurementBatch(product)) throw new Error("Bu üründe çoklu ölçü listesi kullanılamaz.");
  if (!Array.isArray(rows) || !rows.length) throw new Error("En az bir ölçü satırı ekleyin.");
  const lines = rows.map((row, index) => {
    try {
      if (!row || typeof row !== "object") throw new Error("Ölçüleri girin.");
      const label = String(row.label || "").trim() || `Cam ${index + 1}`;
      const variant = String(row.variant || "").trim() || String(common.variant || "").trim();
      const area = [String(common.area || "").trim(), label].filter(Boolean).join(" / ");
      if (area.length > 200 || variant.length > 150) throw new Error("Cam adı veya renk / VR bilgisi çok uzun.");
      const line = calculateCurtainLine(product, { ...common, width: row.width, height: row.height, count: row.count, variant, area, case_mode: "ayri", mechanical_panels: [] });
      if (![line.quantity, line.item_total, line.pieces].every(Number.isFinite)) throw new Error("Ölçü veya tutar çok büyük.");
      return line;
    } catch (error) { throw new Error(`${index + 1}. ölçü satırı: ${error.message}`); }
  });
  const quantity = roundQuantity(lines.reduce((sum, line) => sum + line.quantity, 0));
  const total = roundMoney(lines.reduce((sum, line) => sum + line.item_total, 0));
  const pieces = lines.reduce((sum, line) => sum + line.pieces, 0);
  if (![quantity, total, pieces].every(Number.isFinite)) throw new Error("Ölçü listesi toplamı hesaplama sınırını aşıyor.");
  return { lines, quantity, total, pieces };
}
