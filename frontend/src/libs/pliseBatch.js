import { calculateCurtainLine, normalizeName, roundMoney, roundQuantity, usesWidthOnlyMeasurements } from "./curtainCalculation.js";

export function supportsMeasurementBatch(product) {
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  // Width-only rails include OBA decorative rails catalogued under ADA.
  return usesWidthOnlyMeasurements(product) || (product?.calculation_type === "m2" && /plise|honeycomb/.test(category));
}

export function createMeasurementRow(values = {}) {
  return { width: String(values.width ?? ""), height: String(values.height ?? ""), count: String(values.count ?? "1"), label: String(values.label ?? ""), variant: String(values.variant ?? ""), case_color: String(values.case_color ?? ""), secondary_height: String(values.secondary_height ?? ""), secondary_variant: String(values.secondary_variant ?? "") };
}

export function getCaseColorOptions(product) {
  return (product?.extra_options || []).flatMap((option, index) => {
    const name = String(option?.option_name || "").trim();
    const label = name.slice(name.indexOf(":") + 1).trim();
    return /^kasa\s*\/\s*donanim\s*rengi\s*:/.test(normalizeName(name)) && label ? [{ index, option_name: option.option_name, label }] : [];
  });
}

export function selectCaseColorIndices(product, indices = [], color = "") {
  if (!Array.isArray(indices)) throw new Error("Aksesuar seçimlerini kontrol edin.");
  const choices = getCaseColorOptions(product);
  const selected = String(color || "").trim();
  const option = selected ? choices.find((choice) => String(choice.option_name).trim() === selected) : null;
  if (selected && !option) throw new Error("Kasa rengini ürünün listesinden seçin.");
  const colorIndices = new Set(choices.map((choice) => choice.index));
  const result = indices.filter((index) => !colorIndices.has(index));
  if (option) result.push(option.index);
  return result;
}

export function calculateMeasurementBatch(product, common, rows) {
  if (!supportsMeasurementBatch(product)) throw new Error("Bu üründe çoklu ölçü listesi kullanılamaz.");
  if (!Array.isArray(rows) || !rows.length) throw new Error("En az bir ölçü satırı ekleyin.");
  const lines = rows.map((row, index) => {
    try {
      if (!row || typeof row !== "object") throw new Error("Ölçüleri girin.");
      const label = String(row.label || "").trim() || `${usesWidthOnlyMeasurements(product) ? "Ölçü" : "Cam"} ${index + 1}`;
      const variant = String(row.variant || "").trim() || String(common.variant || "").trim();
      const area = [String(common.area || "").trim(), label].filter(Boolean).join(" / ");
      if (area.length > 200 || variant.length > 150) throw new Error("Cam adı veya renk / VR bilgisi çok uzun.");
      const extraIndices = Object.prototype.hasOwnProperty.call(row, "case_color") ? selectCaseColorIndices(product, common.extra_indices, row.case_color) : common.extra_indices;
      const line = calculateCurtainLine(product, { ...common, width: row.width, height: row.height, count: row.count, variant, area, extra_indices: extraIndices, case_mode: "ayri", mechanical_panels: [] });
      if (![line.quantity, line.item_total, line.pieces].every(Number.isFinite)) throw new Error("Ölçü veya tutar çok büyük.");
      return line;
    } catch (error) { throw new Error(`${index + 1}. ölçü satırı: ${error.message}`); }
  });
  const quantity = roundQuantity(lines.reduce((sum, line) => sum + line.quantity, 0));
  const total = roundMoney(lines.reduce((sum, line) => sum + line.item_total, 0));
  const pieces = lines.reduce((sum, line) => sum + line.pieces, 0);
  if (![quantity, total, pieces].every(Number.isFinite)) throw new Error("Ölçü listesi toplamı hesaplama sınırını aşıyor.");
  return { lines, quantity, total, pieces, unit_label: lines[0].unit_label };
}
