import test from "node:test";
import assert from "node:assert/strict";
import { calculateCurtainLine, defaultMeasurement, orderTotals, PLEATS, restoreSaleDraft, salePayload } from "./curtainCalculation.js";
import { createCustomerOrderHtml, createManufacturingHtml, manufacturingBoxes } from "./curtainPrint.js";
import { normalizeSale } from "../../../backend/src/libs/sale-validation.js";

const textile = { _id: "test-tul", product_name: "Örnek Tül", product_category: { category_name: "Tül" }, product_brand: { brand_name: "Laferra" }, calculation_type: "mt", sale_price: 500, purchase_price: 999999, stock_tracking: false };
const fon = { ...textile, _id: "test-fon", product_name: "Örnek Fon", product_category: { category_name: "Fon" } };
const measured = (product, overrides) => calculateCurtainLine(product, { ...defaultMeasurement(product), width: "400", height: "260", ...overrides });
const header = { first_name: "Deneme", last_name: "Müşteri", customer_phone: "05000000001", delivery_date: "2026-10-20", delivery_method: "montaj", customer_address: "Örnek adres", payment_method: "Nakit" };
const saved = (cart, discount = 0) => ({ _id: "a123456789abcdef12345678", ...salePayload(cart, header, discount, "tamamlandi", "example-request-key") });

test("4 metre sık pile, iki parça: 12,80 metre dikiş payı dahil", () => {
  const line = measured(textile, { count: "2" });
  assert.equal(line.quantity, 12.8);
  assert.equal(line.material_total, 6400);
  assert.equal(line.panels[0].cut_width, 640);
});
test("işçilik kumaş metresi üzerinden: 12,40 × 90 = 1116", () => {
  const line = measured(textile, { count: "1", labor_price: "90" });
  assert.equal(line.quantity, 12.4);
  assert.equal(line.labor_total, 1116);
  assert.equal(line.item_total, 7316);
});
test("boy ölçüsü tekstil fiyatını değiştirmez", () => {
  assert.equal(measured(textile, { height: "220" }).item_total, measured(textile, { height: "300" }).item_total);
});
test("altı pile oranı ve her parçanın dikiş payı korunur", () => {
  for (const pleat of PLEATS) assert.equal(measured(textile, { pleat_id: pleat.id, count: "2" }).quantity, 4 * pleat.factor + 0.8);
});
test("80 cm sık pile: her kanat 2,80 m ve bir takım 5,60 m", () => {
  const line = measured(fon, { width: "80", count: "1", order_mode: "takim" });
  assert.equal(line.pieces, 2);
  assert.equal(line.quantity, 5.6);
  assert.equal(line.item_total, 2800);
});
test("7 adet fon ve 8 takım fon ayrı miktarlarla hesaplanır", () => {
  const single = measured(fon, { width: "80", count: "7", order_mode: "adet" });
  const teams = measured(fon, { width: "80", count: "8", order_mode: "takim" });
  assert.equal(single.pieces, 7);
  assert.equal(single.quantity, 19.6);
  assert.equal(teams.pieces, 16);
  assert.equal(teams.quantity, 44.8);
  assert.equal(manufacturingBoxes([teams]).length, 8);
  assert.equal(manufacturingBoxes([teams])[0].panels.length, 2);
});
test("sağ ve sol kanat farklı ölçülerle imalata aktarılır", () => {
  const line = measured(fon, { width: "80", count: "1", order_mode: "takim", separate_right: true, right_width: "60", right_height: "250" });
  assert.equal(line.quantity, 5);
  assert.equal(line.panels[1].cut_width, 220);
  assert.equal(line.panels[1].height, 250);
});
test("mekanik m² minimumundan sonra yuvarlanır ve her adette uygulanır", () => {
  const product = { ...textile, calculation_type: "m2", min_m2: 0.9, rounding_step: 0.25, product_category: { category_name: "Stor" } };
  assert.equal(measured(product, { width: "50", height: "100", count: "3" }).quantity, 3);
});
test("etek metresi ve redüktör adedi bağımsız fiyatlanır", () => {
  const product = { ...textile, calculation_type: "m2", sale_price: 100, product_category: { category_name: "Stor" }, extra_options: [{ option_name: "Etek çıtası", price_impact: 5, pricing_basis: "mt" }, { option_name: "Redüktör", price_impact: 30, pricing_basis: "adet" }] };
  const line = measured(product, { width: "200", height: "100", count: "2", extra_indices: [0, 1] });
  assert.equal(line.material_total, 400);
  assert.equal(line.accessories[0].total, 20);
  assert.equal(line.accessories[1].total, 60);
  assert.equal(line.item_total, 480);
});
test("dövizli motor, kur girilmeden TL gibi satılamaz", () => {
  const motor = { ...textile, calculation_type: "adet", sale_price: 100, currency: "USD", product_category: { category_name: "Motor" } };
  assert.throws(() => measured(motor, { currency_rate: "" }), /kuru/);
  assert.equal(measured(motor, { currency_rate: "40", count: "2" }).item_total, 8000);
});
test("iskonto ürün ve işçilik toplamından hesaplanır, kredi kartı gizli ek ücret getirmez", () => {
  const line = measured(textile, { labor_price: "90" });
  assert.deepEqual(orderTotals([line], "10"), { subtotal: 7316, discountPercent: 10, discountAmount: 731.6, total: 6584.4 });
  const payload = salePayload([line], { ...header, payment_method: "Kredi Kartı" }, 10, "beklemede", "stable-key");
  assert.equal(payload.credit_card_fee, 0);
  assert.equal(payload.client_request_id, "stable-key");
  assert.equal(payload.sale_items[0].quantity, 12.4);
});
test("negatif ölçü, kesirli kanat adedi ve %100 üstü iskonto reddedilir", () => {
  assert.throws(() => measured(textile, { width: "-1" }));
  assert.throws(() => measured(fon, { count: "1.5" }));
  assert.throws(() => orderTotals([], 101));
});
test("kaydedilen sipariş yeniden açılınca ölçü, iletişim ve iskonto korunur", () => {
  const line = measured(fon, { width: "80", count: "3", order_mode: "adet", variant: "VR390 · Ekru", room_name: "Hobi Odası" });
  const restored = restoreSaleDraft(saved([line], 10));
  assert.equal(restored.cart[0].quantity, 8.4);
  assert.equal(restored.cart[0].variant, "VR390 · Ekru");
  assert.equal(restored.header.customer_phone, header.customer_phone);
  assert.equal(restored.discount, 10);
});
test("müşteri çıktısı alış fiyatını ve çarpanı içermez, HTML metni kaçırılır", () => {
  const line = measured({ ...textile, product_name: '<script>alert("test")</script>' }, { count: "2", variant: "<Ekru>" });
  const html = createCustomerOrderHtml(saved([line], 10));
  assert.ok(html.includes("05000000001"));
  assert.ok(html.includes("12,80"));
  assert.ok(html.includes("İskonto (%10,00)"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes('<script>alert("test")'));
  assert.ok(!JSON.stringify(line).includes("purchase_price"));
  assert.ok(!html.includes("999999"));
});
test("atölye formu fiyat içermez, 9 takımda 2 sayfa ve 16 kutu oluşur", () => {
  const html = createManufacturingHtml(saved([measured(fon, { width: "80", count: "9", order_mode: "takim" })]));
  assert.equal((html.match(/class="plan-box/g) || []).length, 16);
  assert.equal((html.match(/class="sheet plan-sheet"/g) || []).length, 2);
  assert.ok(html.includes("Giden kumaş"));
  assert.ok(html.includes("Toplam 18 fon kanadı"));
  assert.ok(!html.includes("Ödenecek"));
  assert.ok(!html.includes("₺"));
});
test("POS payload gerçek backend toplam ve satır doğrulamasından geçer", () => {
  const line = measured({ ...textile, _id: "507f1f77bcf86cd799439011" }, { count: "2", labor_price: "90" });
  const payload = salePayload([line], header, 12.5, "beklemede", "stable-key-123");
  const normalized = normalizeSale(payload);
  assert.equal(normalized.sale_items[0].quantity, 12.8);
  assert.equal(normalized.grand_total, 6608);
});
test("Laferra kumaş eni ve gramaj müşteride ve imalatta korunur", () => {
  const line = measured({ ...textile, fabric_width_cm: 330, grammage_gr: 260, product_name: "6466" }, { count: "1" });
  assert.equal(line.fabric_width_cm, 330);
  assert.equal(line.grammage_gr, 260);
  assert.ok(createCustomerOrderHtml(saved([line])).includes("Gramaj 260,00 g"));
  assert.ok(createManufacturingHtml(saved([line])).includes("260,00 g"));
});
test("eski tutarlı iskonto ve teslim yöntemi yeni forma doğru taşınır", () => {
  const restored = restoreSaleDraft({ customer_name: "Deneme Müşteri", sub_total: 100, discount_amount: 10, discount_percent: 0, delivery_method: "installation", sale_items: [] });
  assert.equal(restored.discount, 10);
  assert.equal(restored.header.delivery_method, "montaj");
});
