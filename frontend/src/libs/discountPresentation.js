import { formatMoney, orderTotals, roundMoney } from "./curtainCalculation.js";

// Allocate whole kuruş so displayed rows and their components add up to the
// existing order total, even when independently rounded unit prices would differ.
function allocate(total, weights) {
  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (!sum) return weights.map(() => 0);
  const shares = weights.map((weight, index) => {
    const exact = total * weight / sum;
    const cents = Math.floor(exact);
    return { index, cents, remainder: exact - cents };
  });
  const remaining = total - shares.reduce((value, share) => value + share.cents, 0);
  const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index++) ranked[index % ranked.length].cents++;
  return shares.map(({ cents }) => cents);
}
const cents = (value) => Math.round(roundMoney(Number(value) || 0) * 100);

// Presentation only: never save these derived prices back into the order.
// Measurements, catalogue prices, FX and frozen pricing snapshots stay intact.
export function discountedCart(cart, percent) {
  const totals = orderTotals(cart, percent);
  if (!totals.discountPercent) return cart;
  const factor = 1 - totals.discountPercent / 100;
  const lineAmounts = allocate(cents(totals.total), cart.map((line) => cents(line.item_total)));
  return cart.map((line, index) => {
    const accessories = line.accessories || [];
    const components = allocate(lineAmounts[index], [cents(line.material_total), cents(line.labor_total), ...accessories.map((option) => cents(option.total))]);
    const basePrice = roundMoney(line.base_unit_price * factor);
    return {
      ...line,
      base_unit_price: basePrice,
      material_total: components[0] / 100,
      labor_unit_price: roundMoney((line.labor_unit_price || 0) * factor),
      labor_total: components[1] / 100,
      accessories: accessories.map((option, optionIndex) => ({ ...option, unit_price: roundMoney(option.unit_price * factor), total: components[optionIndex + 2] / 100 })),
      accessories_total: components.slice(2).reduce((sum, amount) => sum + amount, 0) / 100,
      item_total: lineAmounts[index] / 100,
      unit_price: line.quantity ? lineAmounts[index] / 100 / line.quantity : 0,
      calculation_note: line.rustic_pricing && line.calculation_note ? line.calculation_note.replace(formatMoney(line.base_unit_price), formatMoney(basePrice)) : line.calculation_note,
      discount_display: { percent: totals.discountPercent, original_unit_price: line.base_unit_price, original_total: line.item_total },
    };
  });
}
