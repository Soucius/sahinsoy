import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerOrderHtml, createManufacturingHtml, manufacturingBoxes } from "./curtainPrint.js";

const mechanical = {
  product_id: "507f1f77bcf86cd799439011", product_name: "Stor L91", brand_name: "OBA Perdesan", category_name: "Stor", mode: "mechanical", calc_type: "m2",
  width: 91, height: 181, billable_width: 100, billable_height: 190, quantity: 4, unit_label: "m²", pieces: 2, count: 2, panels: [],
  base_unit_price: 100, material_total: 400, labor_total: 0, accessories: [], item_total: 400,
  room_name: "Sinema Odası", variant: "VR500 · Ekru", calculation_note: "2 adet · hesapta minimum 2 m² / adet", purchase_price: 987654,
};
const textile = {
  product_id: "507f1f77bcf86cd799439012", product_name: "Tül T400", brand_name: "Lilium", category_name: "Tül", mode: "textile", calc_type: "mt",
  width: 400, height: 260, quantity: 12.8, unit_label: "m", pieces: 2, count: 2, panels: [{ label: "Perde", width: 200, height: 260, cut_width: 640 }],
  base_unit_price: 500, material_total: 6400, labor_total: 0, accessories: [], item_total: 6400, room_name: "Salon", pleat_name: "Sık pile",
};
const sale = (cart) => ({
  _id: "test-order-12345678", status: "tamamlandi", customer_name: "Deneme Müşteri", customer_phone: "05000000001", delivery_date: "2026-10-20", delivery_method: "magaza", payment_method: "Nakit",
  pos_details: { version: 1, cart, header: { first_name: "Deneme", last_name: "Müşteri", delivery_method: "magaza" }, discount_percent: 0 },
});

test("mekanik müşteri PDF'si gerçek ölçüyü ve farklı hesap ölçüsünü birlikte gösterir", () => {
  const html = createCustomerOrderHtml(sale([mechanical]));
  assert.ok(html.includes("Ölçü: 91,00 × 181,00 cm"));
  assert.ok(html.includes("Hesap ölçüsü: 100,00 × 190,00 cm"));
  assert.ok(html.includes("4,00 m²"));
  assert.ok(html.includes("hesapta minimum 2 m² / adet"));
  assert.ok(!html.includes("987654"));
  assert.ok(!html.includes("purchase_price"));
});
test("mekanik imalat ölçüsü yuvarlanan hesap ölçüsüne dönüşmez", () => {
  const boxes = manufacturingBoxes([mechanical]);
  assert.deepEqual(boxes[0].panels[0], { label: "2 adet", width: 91, height: 181 });
  const html = createManufacturingHtml(sale([mechanical]));
  assert.ok(html.includes("En 91,00 cm"));
  assert.ok(html.includes("Boy 181,00 cm"));
  assert.ok(!html.includes("Kesim eni"));
  assert.ok(!html.includes("Dikiş payı"));
  assert.ok(!html.includes("Boy ölçüsü imalat içindir"));
  assert.ok(!html.includes("₺"));
});
test("karma siparişte dikiş payı açıklaması yalnız tül ve fon için geçerlidir", () => {
  const html = createManufacturingHtml(sale([mechanical, textile]));
  assert.ok(html.includes("Tül ve fon ürünlerinde boy ölçüsü imalat içindir."));
  assert.ok(html.includes("Mekanik ürünlerde kutulardaki en ve boy imalat ölçüsüdür."));
  assert.ok(html.includes("Kesim eni 640,00 cm"));
  assert.ok(html.includes("Toplam giden kumaş: 12,80 m"));
  const mechanicalBox = html.slice(html.indexOf("<h2>Stor L91"), html.indexOf("</section>", html.indexOf("<h2>Stor L91")));
  assert.ok(!mechanicalBox.includes("Kesim eni"));
});
test("yüzde aksesuar müşteri çıktısında oran ve TL tutarıyla açıkça gösterilir", () => {
  const line = { ...mechanical, accessories: [{ name: "Karışık renk", pricing_basis: "yuzde", unit: "%", quantity: 10, unit_price: 4, total: 40 }], accessories_total: 40, item_total: 440 };
  const html = createCustomerOrderHtml(sale([line]));
  assert.ok(html.includes("Karışık renk: %10 → ₺40,00"));
  assert.ok(!html.includes("% ×"));
  const manufacturing = createManufacturingHtml(sale([line]));
  assert.ok(manufacturing.includes("Karışık renk"));
  assert.ok(!manufacturing.includes("₺"));
});
test("eski mekanik kayıtlar hesap ölçüsü olmadan okunur, aynı ölçü yinelenmez", () => {
  const legacy = { ...mechanical, billable_width: undefined, billable_height: undefined };
  assert.ok(!createCustomerOrderHtml(sale([legacy])).includes("Hesap ölçüsü:"));
  const unchanged = { ...mechanical, billable_width: 91, billable_height: 181 };
  assert.ok(!createCustomerOrderHtml(sale([unchanged])).includes("Hesap ölçüsü:"));
});
test("mekanik hesap notu ve aksesuar adı HTML olarak yürütülmez", () => {
  const unsafe = { ...mechanical, calculation_note: '<script>alert("test")</script>', accessories: [{ name: "<img onerror=test>", quantity: 10, unit: "%", total: 40 }] };
  const html = createCustomerOrderHtml(sale([unsafe]));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img onerror=test&gt;"));
  assert.ok(!html.includes('<script>alert("test")'));
  assert.ok(!html.includes("<img onerror=test>"));
});
test("zincir / ip yönü ve VR müşteri kağıdına ve imalat formuna aynen taşınır", () => {
  const line = { ...mechanical, chain_direction: "Sol" };
  for (const create of [createCustomerOrderHtml, createManufacturingHtml]) {
    const html = create(sale([line]));
    assert.ok(html.includes("Zincir / ip yönü: Sol"));
    assert.ok(html.includes("Renk / VR: VR500 · Ekru"));
    assert.ok(html.includes("91,00"));
    assert.ok(html.includes("181,00"));
  }
});
test("eski yönü belirtilmemiş siparişte sağ veya sol varsayılmaz", () => {
  for (const create of [createCustomerOrderHtml, createManufacturingHtml]) assert.ok(!create(sale([mechanical])).includes("Zincir / ip yönü:"));
});

const casePanels = [
  { label: "1. parça", width: 50, height: 180, chain_direction: "Sağ", variant: "VR101", billable_width: 90, billable_height: 190, billable_area: 2 },
  { label: "2. parça", width: 75, height: 190, chain_direction: "Sol", variant: "", billable_width: 90, billable_height: 190, billable_area: 2 },
  { label: "3. parça", width: 120, height: 210, chain_direction: "Sağ", variant: "VR103", billable_width: 120, billable_height: 210, billable_area: 2.52 },
];
const caseLine = (caseMode = "ortak", count = 1) => ({ ...mechanical, width: 50, height: 180, variant: "VR_ORtak", chain_direction: "", count, pieces: count * 3, case_count: count * (caseMode === "ortak" ? 1 : 3), case_mode: caseMode, case_width: 245, mechanical_panels: casePanels, quantity: 6.52 * count, material_total: 652 * count, item_total: 652 * count });

test("ortak kasadaki farklı ölçüler müşteriye bütün parçalar ve yönleriyle gösterilir", () => {
  const html = createCustomerOrderHtml(sale([caseLine()]));
  assert.ok(html.includes("1 kasa · 3 parça · Ortak kasa"));
  assert.ok(html.includes("Toplam parça eni 245,00 cm"));
  for (const panel of casePanels) assert.ok(html.includes(`${panel.width.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} × ${panel.height.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} cm`));
  assert.ok(html.includes("Renk / VR: VR101 · Zincir / ip yönü: Sağ"));
  assert.ok(html.includes("Renk / VR: VR_ORtak · Zincir / ip yönü: Sol"));
  assert.ok(html.includes("Renk / VR: VR103 · Zincir / ip yönü: Sağ"));
  assert.ok(!html.includes("987654"));
});
test("ortak kasa parçaları ayrı kutularda aynı kasa numarasıyla gösterilir", () => {
  const line = caseLine();
  const boxes = manufacturingBoxes([line]);
  assert.equal(boxes.length, 3);
  assert.ok(boxes.every((box) => box.panels.length === 1 && box.case_id === "ORTAK KASA 1"));
  assert.deepEqual(boxes.map((box) => box.position), ["Sol", "Orta", "Sağ"]);
  assert.deepEqual(boxes.map((box) => box.quantity), [2, 2, 2.52]);
  const html = createManufacturingHtml(sale([line]));
  assert.equal((html.match(/class="plan-box mechanical-case"/g) || []).length, 3);
  assert.ok(html.includes("3 parçalık ortak kasa · Toplam parça eni 245,00 cm"));
  assert.ok(html.includes("Sol parça: 50,00 × 180,00 cm"));
  assert.ok(html.includes("Orta parça: 75,00 × 190,00 cm"));
  assert.ok(html.includes("Sağ parça: 120,00 × 210,00 cm"));
  assert.ok(html.includes("1 parça · ORTAK KASA 1"));
  assert.ok(!html.includes("2,00 m²"));
  assert.ok(!html.includes("Hesap ölçüsü:"));
  assert.ok(!html.includes("Kesim eni"));
  assert.ok(!html.includes("₺"));
});
test("ayrı kasalarda her parça bir kutuya gider ve tekrarlar devam sayfası açar", () => {
  const line = caseLine("ayri", 3);
  const boxes = manufacturingBoxes([line]);
  assert.equal(boxes.length, 9);
  assert.ok(boxes.every((box) => box.panels.length === 1));
  assert.deepEqual(boxes.map((box) => box.quantity), [2, 2, 2.52, 2, 2, 2.52, 2, 2, 2.52]);
  const html = createManufacturingHtml(sale([line]));
  assert.equal((html.match(/class="sheet plan-sheet"/g) || []).length, 2);
  assert.equal((html.match(/class="plan-box/g) || []).length, 16);
  assert.ok(createCustomerOrderHtml(sale([line])).includes("9 kasa · 9 parça · Ayrı kasalar"));
});
test("ortak kasa grubu tekrarı kasaları ayrı kutulara aktarır", () => {
  const boxes = manufacturingBoxes([caseLine("ortak", 2)]);
  assert.equal(boxes.length, 6);
  assert.ok(boxes.every((box) => box.panels.length === 1));
  assert.deepEqual(boxes.map((box) => box.sequence), [1, 1, 1, 2, 2, 2]);
});
test("303 cm profil imalat bilgisi olarak kalır; 300 cm parçalar 8 m² ve 3 m aksesuarı korur", () => {
  const line = { ...caseLine(), width: 300, height: 280, case_width: 300, profile_width_cm: 303, quantity: 8, base_unit_price: 200, material_total: 1600, item_total: 1780, accessories: [{ name: "Kapalı kasa", unit: "m", quantity: 3, unit_price: 60, total: 180 }], mechanical_panels: casePanels.map((panel, index) => ({ ...panel, width: 100, height: index === 2 ? 280 : 260, billable_width: 100, billable_height: index === 2 ? 280 : 260, billable_area: index === 2 ? 2.8 : 2.6 })) };
  const html = createCustomerOrderHtml(sale([line]));
  assert.ok(html.includes("Toplam parça eni 300,00 cm"));
  assert.ok(html.includes("Kasa / profil eni: 303,00 cm (imalat bilgisi)"));
  assert.ok(html.includes("8,00 m²"));
  assert.ok(html.includes("Kapalı kasa: 3,00 m × ₺60,00 = ₺180,00"));
  const boxes = manufacturingBoxes([line]);
  const box = boxes[0];
  assert.equal(boxes.reduce((total, part) => total + part.quantity, 0), 8);
  assert.equal(box.quantity, 2.6);
  assert.equal(box.case_width, 300);
  assert.equal(box.profile_width_cm, 303);
  const plan = createManufacturingHtml(sale([line]));
  assert.ok(plan.includes("Kasa / profil eni: 303,00 cm"));
  assert.ok(plan.includes("Toplam parça eni 300,00 cm"));
  assert.ok(!plan.includes("8,00 m²"));
  assert.ok(!plan.includes("2,60 m²"));
  assert.ok(!plan.includes("₺"));
});
test("ortak profil eni boşken parçaların toplamı imalat profili olarak varsayılmaz", () => {
  const html = createManufacturingHtml(sale([caseLine()]));
  assert.ok(html.includes("Kasa / profil eni: Belirtilmedi"));
  assert.ok(!html.includes("Kasa / profil eni: 245,00"));
});
test("dokuz ortak parça devam sayfasına gider ve iki ayrı düzen aynı kasa kimliğini paylaşmaz", () => {
  const nineParts = Array.from({ length: 9 }, (_, index) => ({ ...casePanels[index % 3], label: `${index + 1}. parça` }));
  const line = { ...caseLine(), mechanical_panels: nineParts, pieces: 9, quantity: 19.56 };
  const boxes = manufacturingBoxes([line]);
  assert.equal(boxes.length, 9);
  assert.ok(boxes.every((box) => box.case_id === "ORTAK KASA 1"));
  const html = createManufacturingHtml(sale([line]));
  assert.equal((html.match(/class="sheet plan-sheet"/g) || []).length, 2);
  assert.equal((html.match(/class="plan-box/g) || []).length, 16);
  const twoLines = manufacturingBoxes([caseLine(), { ...caseLine(), product_name: "Diğer stor" }]);
  assert.deepEqual([...new Set(twoLines.map((box) => box.case_id))], ["ORTAK KASA 1", "ORTAK KASA 2"]);
});
