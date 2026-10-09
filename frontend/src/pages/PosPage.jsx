import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle, ClipboardList, Home, Loader2, Package, Plus, Printer, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios.js";
import { calculateCurtainLine, defaultMeasurement, FACADES, formatMoney, formatNumber, mechanicalPanelPosition, needsControlDirection, orderTotals, PLEATS, productMode, restoreSaleDraft, ROOM_PRESETS, salePayload, showFabricSpecs, WINDOWS } from "../libs/curtainCalculation.js";
import { openCurtainPrint } from "../libs/curtainPrint.js";

const EMPTY_HEADER = { first_name: "", last_name: "", customer_phone: "", customer_address: "", delivery_date: "", delivery_method: "", payment_method: "Nakit", sale_note: "", measurement_status: "preliminary" };
const nextKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isPercentageOption = (option) => option.pricing_basis === "yuzde" || option.unit === "%";
const formatRate = (value) => Number(value || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const accessoryUnit = (option, product) => {
  const basis = option.pricing_basis || option.calculation_type || "birim";
  const type = basis === "birim" ? product.calculation_type : basis;
  return type === "m2" ? "m²" : type === "mt" ? "metre" : "adet";
};
const hasMechanicalPanels = (line) => Array.isArray(line?.mechanical_panels) && line.mechanical_panels.length > 0;
const mechanicalPartTitle = (panel, index, count, mode) => `${String(panel.position_override || panel.position || mechanicalPanelPosition(index, count)).replace(/^Tek parça$/, "Tek")} ${mode === "ortak" ? "parça" : "kasa"}`;
const hasPanelBillingDimensions = (panel) => Number.isFinite(panel.billable_width) && Number.isFinite(panel.billable_height) && (panel.billable_width !== panel.width || panel.billable_height !== panel.height);
const hasBillingDimensions = (line) => line?.calc_type === "m2" && !hasMechanicalPanels(line) && hasPanelBillingDimensions(line);
const builderForm = (product, form) => {
  if (product.calculation_type !== "m2" || !needsControlDirection(product)) return form;
  const panels = hasMechanicalPanels(form) ? form.mechanical_panels : [{ width: form.width, height: form.height, chain_direction: form.chain_direction || "", variant: "" }];
  const restored = panels.map((panel) => ({ width: String(panel.width ?? ""), height: String(panel.height ?? ""), chain_direction: panel.chain_direction || "", variant: panel.variant || "", position_override: panel.position_override || "" }));
  return { ...form, width: restored[0].width, height: restored[0].height, chain_direction: restored[0].chain_direction, case_mode: form.case_mode || "ayri", mechanical_panels: restored };
};

const POS_STYLE = `
.curtain-pos{--p-ink:#443325;--p-muted:#806b56;--p-line:#e2d2bd;--p-coffee:#80512f;--p-gold:#efe0ca;color:var(--p-ink);font-size:16px;max-width:1500px;margin:0 auto;padding:4px}.curtain-pos *{box-sizing:border-box}.curtain-pos .pos-brand{display:flex;align-items:center;gap:18px;margin-bottom:20px}.curtain-pos .pos-brand img{width:150px;height:95px;object-fit:contain;border-radius:12px;background:#fff}.curtain-pos h1{font-size:26px;font-weight:750;margin:0}.curtain-pos h2{font-size:21px;font-weight:700;margin:0 0 14px}.curtain-pos h3{font-size:18px;font-weight:700}.curtain-pos p{margin:6px 0}.curtain-pos .muted{color:var(--p-muted);font-size:14px}.curtain-pos .panel{border:1px solid var(--p-line);border-radius:18px;background:#fffdf8;padding:22px;box-shadow:0 5px 24px #5b402509}.curtain-pos .pos-tabs,.curtain-pos .row,.curtain-pos .actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.curtain-pos .pos-tabs{margin-bottom:18px}.curtain-pos button{min-height:48px;border:1px solid var(--p-line);border-radius:11px;padding:11px 17px;background:#fffdf8;color:var(--p-ink);font-weight:650;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}.curtain-pos button:hover:not(:disabled){background:#f5ebdd;border-color:#b08b64}.curtain-pos button.primary,.curtain-pos button[aria-selected=true],.curtain-pos button.chip[aria-pressed=true]{background:var(--p-coffee);color:#fffaf3;border-color:var(--p-coffee)}.curtain-pos button.primary:hover:not(:disabled){background:#694024}.curtain-pos button:disabled{opacity:.45;cursor:not-allowed}.curtain-pos .button-danger{color:#9c352a}.curtain-pos .filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin:12px 0 20px}.curtain-pos input,.curtain-pos select,.curtain-pos textarea{display:block;width:100%;min-width:0;border:1px solid var(--p-line);border-radius:10px;padding:12px;font:inherit;background:#fffdf8;color:var(--p-ink);margin-top:6px;min-height:48px}.curtain-pos textarea{min-height:85px}.curtain-pos :is(input,select,textarea,button):focus-visible{outline:3px solid #d5aa7a;outline-offset:2px}.curtain-pos label{font-size:14px;font-weight:650;color:#6c513b;display:block}.curtain-pos .fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.curtain-pos .full{grid-column:1/-1}.curtain-pos .products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.curtain-pos button.product-card{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:18px;min-height:145px;gap:5px;overflow-wrap:anywhere}.curtain-pos .product-card .product-title{font-size:18px;font-weight:750;color:#4c3524}.curtain-pos .product-card .product-price{font-size:21px;font-weight:750;margin-top:auto;color:#80512f}.curtain-pos .product-card .muted{font-size:13px;font-weight:400}.curtain-pos .empty{padding:36px 15px;text-align:center;color:var(--p-muted)}.curtain-pos .pagination{margin:18px 0 0;justify-content:space-between}.curtain-pos .summary-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,1fr);gap:20px}.curtain-pos .room-heading{display:flex;gap:8px;align-items:center;font-size:19px;font-weight:750;margin:18px 0 8px;color:#80512f}.curtain-pos .cart-line{padding:15px 0;border-bottom:1px solid var(--p-line);overflow-wrap:anywhere}.curtain-pos .cart-line h3{margin:0}.curtain-pos .cart-line .line-price{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;font-weight:750}.curtain-pos .cart-line button{min-height:38px;padding:6px 10px;font-size:13px}.curtain-pos .price-box{padding:18px;background:var(--p-gold);border-radius:12px;margin:18px 0}.curtain-pos .price-box .big{font-size:28px;font-weight:800}.curtain-pos .total-row{display:flex;justify-content:space-between;gap:14px;margin:8px 0}.curtain-pos .grand-total{font-size:25px;font-weight:800;padding-top:12px;margin-top:12px;border-top:1px solid #c7ac88}.curtain-pos .notice{padding:13px 16px;border:1px solid #d8bd93;background:#f8efdf;border-radius:12px;margin-bottom:16px;font-size:15px}.curtain-pos .saved{border-color:#b9c7a6;background:#f0f3e8}.curtain-pos .error{color:#9e3328;font-weight:600}.curtain-pos .divider{border-top:1px solid var(--p-line);padding-top:18px;margin-top:18px}.curtain-pos .modal-backdrop{position:fixed;inset:0;background:#2a1b1385;z-index:60;display:flex;justify-content:center;align-items:center;padding:18px}.curtain-pos .modal{background:#fffdf8;max-width:860px;width:100%;max-height:calc(100dvh - 36px);border-radius:20px;overflow:auto;border:1px solid #d9c2a5;box-shadow:0 20px 80px #21180c50;padding:24px}.curtain-pos .modal-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.curtain-pos .modal-heading h2{margin-bottom:4px}.curtain-pos .modal-close{padding:10px;min-width:48px}.curtain-pos .choice-label{margin:16px 0 9px;font-weight:700}.curtain-pos .accessory{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--p-line);border-radius:10px;margin:8px 0}.curtain-pos .accessory input,.curtain-pos .check input{width:21px;min-height:21px;height:21px;margin:0;flex-shrink:0;accent-color:#80512f}.curtain-pos .check{display:flex;align-items:center;gap:10px;margin:12px 0}.curtain-pos fieldset{margin:0;padding:0;border:0}.curtain-pos .review-card{background:#f5ecdf;padding:13px;border-radius:11px;margin:15px 0}.curtain-pos .spin{animation:pos-spin 1s linear infinite}@keyframes pos-spin{to{transform:rotate(360deg)}}@media(min-width:1300px){.curtain-pos .products{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:900px){.curtain-pos .summary-grid{grid-template-columns:1fr}.curtain-pos .products{grid-template-columns:repeat(2,minmax(0,1fr))}.curtain-pos .filters{grid-template-columns:1fr 1fr}.curtain-pos .filters>label:first-child{grid-column:1/-1}}@media(max-width:550px){.curtain-pos{padding:0}.curtain-pos .panel{padding:16px}.curtain-pos .pos-brand{gap:12px}.curtain-pos .pos-brand img{width:100px;height:75px}.curtain-pos h1{font-size:22px}.curtain-pos .fields{grid-template-columns:1fr}.curtain-pos .full{grid-column:auto}.curtain-pos .modal{padding:17px}.curtain-pos .modal-backdrop{padding:8px}.curtain-pos button.product-card{padding:13px;min-height:145px}.curtain-pos .product-card .product-title{font-size:16px}.curtain-pos .product-card .product-price{font-size:18px}.curtain-pos .actions>button{flex:1 1 180px}.curtain-pos .price-box{padding:14px}.curtain-pos .products{gap:9px}}
.curtain-pos .pos-room-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(min-width:700px){.curtain-pos .pos-room-options{grid-template-columns:repeat(4,minmax(0,1fr))}}
.curtain-pos .pos-tabs button[role=tab][aria-selected=true]{background:#80512f!important;color:#fffaf3!important;border-color:#80512f!important}
`;

function Field({ label, children, full = false }) {
  return <label className={full ? "full" : ""}>{label}{children}</label>;
}

function NumberField({ label, value, onChange, min = 0, step = "any", required = false }) {
  return <Field label={label}><input type="number" inputMode="decimal" min={min} step={step} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></Field>;
}

function MechanicalDetails({ line }) {
  if (!hasMechanicalPanels(line)) return null;
  return <div><p><strong>{line.case_count} kasa · {line.pieces} parça</strong> · {line.case_mode === "ortak" ? "Ortak kasa" : "Ayrı kasalar"}{line.count > 1 ? ` · ${line.count} ölçü grubu` : ""}</p>{line.case_mode === "ortak" && <p>Toplam parça eni: {formatNumber(line.case_width)} cm</p>}{line.case_mode === "ortak" && Number(line.profile_width_cm) > 0 && <p>Kasa / profil eni: {formatNumber(line.profile_width_cm)} cm (imalat bilgisi)</p>}{line.mechanical_panels.map((panel, index) => <div key={index} style={{ marginTop: 8 }}><p>{mechanicalPartTitle(panel, index, line.mechanical_panels.length, line.case_mode)}: <strong>{formatNumber(panel.width)} × {formatNumber(panel.height)} cm</strong></p><p className="muted">Renk / VR: {panel.variant || line.variant || "Belirtilmedi"} · Zincir / ip yönü: {panel.chain_direction}</p>{hasPanelBillingDimensions(panel) && <p className="muted">Hesap ölçüsü: {formatNumber(panel.billable_width)} × {formatNumber(panel.billable_height)} cm</p>}</div>)}</div>;
}

export default function PosPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [filters, setFilters] = useState({ search: "", category: "", brand: "", page: 1 });
  const [pages, setPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState("products");
  const [cart, setCart] = useState([]);
  const [header, setHeader] = useState({ ...EMPTY_HEADER });
  const [discount, setDiscount] = useState("0");
  const [selected, setSelected] = useState(null);
  const [measurement, setMeasurement] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [editId, setEditId] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [savedSale, setSavedSale] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const processingRef = useRef(false);
  const idempotencyKey = useRef(nextKey());
  const restoredId = useRef(null);
  const lastRoom = useRef("Salon");
  const location = useLocation();
  const navigate = useNavigate();
  const delivered = savedSale?.status === "teslim_edildi";
  const approved = savedSale?.status === "tamamlandi" || delivered;
  const cancelled = savedSale?.status === "iptal";
  const locked = approved || cancelled;

  useEffect(() => {
    let active = true;
    Promise.all([api.get("/categories"), api.get("/brands")]).then(([categoryResponse, brandResponse]) => {
      if (active) { setCategories(categoryResponse.data); setBrands(brandResponse.data); }
    }).catch(() => { if (active) toast.error("Marka ve kategori seçenekleri yüklenemedi."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setFetchError("");
      try {
        const response = await api.get("/products", { signal: controller.signal, params: { ...filters, limit: 24 } });
        if (!controller.signal.aborted) {
          setProducts(response.data.products || []);
          setPages(Math.max(1, response.data.totalPages || 1));
          setTotalProducts(response.data.totalProducts || 0);
        }
      } catch (error) {
        if (!controller.signal.aborted) setFetchError(error.response?.data?.message || "Ürünler yüklenemedi. Yeniden deneyin.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [filters, refresh]);

  useEffect(() => {
    let active = true;
    const orderId = new URLSearchParams(location.search).get("order");
    const transferred = location.state?.pendingSale;
    const requestedId = transferred?._id || orderId;
    if (!requestedId || restoredId.current === requestedId) return;
    const restore = async () => {
      const sale = transferred || (await api.get("/sales")).data.find((item) => item._id === orderId);
      if (!sale) throw new Error("Sipariş bulunamadı.");
      if (!active) return;
      const restored = restoreSaleDraft(sale);
      restoredId.current = sale._id;
      idempotencyKey.current = sale.client_request_id || nextKey();
      setCart(restored.cart);
      setHeader(restored.header);
      setDiscount(String(restored.discount));
      setExistingId(sale._id);
      setSavedSale(sale);
      setReviewed(false);
      setTab("summary");
      if (transferred) navigate(`/dashboard/pos?order=${sale._id}`, { replace: true, state: null });
    };
    restore().catch((error) => { if (active) toast.error(error.message || "Sipariş açılamadı."); });
    return () => { active = false; };
  }, [location.search, location.state, navigate]);

  const totals = useMemo(() => {
    try { return { ...orderTotals(cart, discount), error: "" }; }
    catch (error) { return { subtotal: cart.reduce((sum, line) => sum + line.item_total, 0), discountPercent: 0, discountAmount: 0, total: 0, error: error.message }; }
  }, [cart, discount]);
  const calculation = useMemo(() => {
    if (!selected || !measurement) return null;
    try { return { line: calculateCurtainLine(selected, measurement), error: "" }; }
    catch (error) { return { line: null, error: error.message }; }
  }, [selected, measurement]);
  const rooms = [...new Set(cart.map((line) => line.room_name))];
  const roomOptions = [...new Set([...ROOM_PRESETS, ...rooms.filter((room) => typeof room === "string" && room.trim())])];
  const dirty = () => { setReviewed(false); setSavedSale(null); };
  const updateHeader = (key, value) => { if (locked) return; setHeader((previous) => ({ ...previous, [key]: value })); dirty(); };
  const updateMeasurement = (key, value) => setMeasurement((previous) => ({ ...previous, [key]: value }));
  const updateMechanicalPanel = (index, key, value) => setMeasurement((previous) => {
    const panels = previous.mechanical_panels.map((panel, panelIndex) => panelIndex === index ? { ...panel, [key]: value } : panel);
    return { ...previous, mechanical_panels: panels, ...(index === 0 && ["width", "height", "chain_direction"].includes(key) ? { [key]: value } : {}) };
  });
  const addMechanicalPanel = () => setMeasurement((previous) => ({ ...previous, mechanical_panels: [...previous.mechanical_panels, { width: "", height: previous.mechanical_panels.at(-1)?.height || previous.height || "260", chain_direction: "", variant: "", position_override: "" }] }));
  const removeMechanicalPanel = (index) => setMeasurement((previous) => {
    if (previous.mechanical_panels.length <= 1) return previous;
    const panels = previous.mechanical_panels.filter((_, panelIndex) => panelIndex !== index);
    return { ...previous, mechanical_panels: panels, width: panels[0].width, height: panels[0].height, chain_direction: panels[0].chain_direction };
  });
  const updateFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value, page: 1 }));

  const openProduct = (product) => {
    if (locked) return;
    setSelected(product);
    setEditId(null);
    setMeasurement(builderForm(product, { ...defaultMeasurement(product), room_name: lastRoom.current }));
    setWizardStep(1);
  };

  const editLine = async (line) => {
    if (locked) return;
    try {
      const response = await api.get("/products", { params: { search: line.product_name, limit: 100 } });
      const product = response.data.products?.find((item) => item._id === line.product_id);
      if (!product) throw new Error("Ürün katalogda bulunamadı. Bu kalemi kaldırıp yeniden ürün seçebilirsiniz.");
      setSelected(product);
      setEditId(line.id);
      setMeasurement(builderForm(product, { ...defaultMeasurement(product), case_mode: line.case_mode || "ayri", profile_width_cm: line.profile_width_cm ? String(line.profile_width_cm) : "", mechanical_panels: line.mechanical_panels || undefined, room_name: line.room_name, area: line.area, facade: line.facade, window_name: line.window_name, variant: line.variant, item_note: line.item_note, chain_direction: line.chain_direction || "", width: String(line.width), height: String(line.height), count: String(line.count || line.pieces || 1), order_mode: line.order_mode || "adet", pleat_id: PLEATS.find((option) => option.name === line.pleat_name)?.id || "sik", labor_price: String(line.labor_unit_price || 0), currency_rate: line.original_currency !== "TRY" ? String(line.currency_rate || "") : "", separate_right: Boolean(line.panels?.length > 1 && (line.panels[0].width !== line.panels[1].width || line.panels[0].height !== line.panels[1].height)), right_width: String(line.panels?.[1]?.width || line.width), right_height: String(line.panels?.[1]?.height || line.height), extra_indices: (product.extra_options || []).map((option, index) => line.accessories?.some((saved) => saved.name === option.option_name) ? index : -1).filter((index) => index >= 0) }));
      setWizardStep(1);
    } catch (error) { toast.error(error.message || "Ürün düzenlenemedi."); }
  };

  const addLine = () => {
    if (locked) return;
    if (!measurement.room_name.trim()) { toast.error("Oda / bölüm adını girin."); return; }
    if (!calculation?.line) { toast.error(calculation?.error || "Ölçüleri kontrol edin."); return; }
    const line = { ...calculation.line, id: editId || nextKey() };
    setCart((previous) => editId ? previous.map((item) => item.id === editId ? line : item) : [...previous, line]);
    lastRoom.current = line.room_name;
    dirty();
    setSelected(null);
    toast.success(editId ? "Ürün ölçüleri güncellendi." : "Ürün siparişe eklendi.");
  };

  const validateHeader = () => {
    if (!cart.length) { toast.error("Siparişe en az bir ürün ekleyin."); return false; }
    if (!header.first_name.trim() || !header.last_name.trim()) { toast.error("Müşterinin adını ve soyadını girin."); return false; }
    if (!header.delivery_date || !header.delivery_method) { toast.error("Teslim tarihi ve teslim şeklini seçin."); return false; }
    if (header.delivery_method === "montaj" && !header.customer_address.trim()) { toast.error("Montaj için adres girin."); return false; }
    if (totals.error) { toast.error(totals.error); return false; }
    return true;
  };

  const acceptSavedSale = (record, status) => {
    const restored = restoreSaleDraft(record);
    setCart(restored.cart);
    setHeader(restored.header);
    setDiscount(String(restored.discount));
    setExistingId(record._id);
    restoredId.current = record._id;
    setSavedSale(record);
    setRefresh((value) => value + 1);
    navigate(`/dashboard/pos?order=${record._id}`, { replace: true, state: null });
    toast.success(status === "beklemede" ? "Teklif beklemede olarak kaydedildi." : "Sipariş onaylandı. Müşteri ve imalat çıktıları hazır.");
  };

  const saveOrder = async (status) => {
    if (processingRef.current || locked || !validateHeader()) return;
    processingRef.current = true;
    setProcessing(true);
    const payload = salePayload(cart, header, discount, status, idempotencyKey.current);
    try {
      const response = existingId ? await api.put(`/sales/${existingId}`, payload) : await api.post("/sales", payload);
      if (!response.data?._id || response.data.status !== status) throw new Error("Sipariş kaydı doğrulanamadı. Tekrar göndermeden sipariş takibini kontrol edin.");
      acceptSavedSale(response.data, status);
    } catch (error) {
      let reconciled = false;
      if (!error.response) {
        try {
          const response = await api.get("/sales");
          const found = response.data.find((sale) => existingId ? sale._id === existingId && sale.status === status : sale.client_request_id === idempotencyKey.current && sale.status === status);
          if (found) { acceptSavedSale(found, status); reconciled = true; }
        } catch { /* Keep the draft and its key for a safe retry. */ }
      }
      if (!reconciled) toast.error(error.response?.data?.message || error.message || "Kaydın sonucu doğrulanamadı. Sipariş takibini kontrol edin; aynı taslak korunuyor.");
    } finally { processingRef.current = false; setProcessing(false); }
  };

  const newOrder = () => {
    setCart([]); setHeader({ ...EMPTY_HEADER }); setDiscount("0"); setExistingId(null); setSavedSale(null); setReviewed(false); setSelected(null); setTab("products");
    restoredId.current = null; idempotencyKey.current = nextKey();
    navigate("/dashboard/pos", { replace: true, state: null });
  };
  const printOrder = (kind) => { if (!approved || cancelled) return; try { openCurtainPrint(savedSale, kind); } catch (error) { toast.error(error.message); } };
  const currency = selected?.currency || selected?.price_currency || "TRY";
  const mode = selected ? productMode(selected) : "standard";
  const directionRequired = selected ? needsControlDirection(selected) : false;
  const panelBuilderActive = directionRequired && selected?.calculation_type === "m2" && hasMechanicalPanels(measurement);

  return <div className="curtain-pos">
    <style>{POS_STYLE}</style>
    <header className="pos-brand"><img src="/sahinsoy-logo.svg" alt="Şahinsoy Perde ve Döşemelik logosu" /><div><h1>Şahinsoy POS</h1><p className="muted">Satış ve sipariş ekranı</p></div></header>
    <div className="pos-tabs" role="tablist" aria-label="Satış adımları">
      <button role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}><Package size={19} />1 · Ürünler</button>
      <button role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}><ShoppingCart size={19} />2 · Sipariş özeti ({cart.length})</button>
    </div>
    {savedSale && <div className={`notice ${approved ? "saved" : ""}`} role="status"><strong>{cancelled ? "Sipariş iptal edildi." : delivered ? "İş teslim edildi." : approved ? "Sipariş onaylandı." : "Teklif beklemede olarak kaydedildi."}</strong> No: #{savedSale._id.slice(-8).toUpperCase()}{cancelled ? " · Bu kayıt geçmişte korunur; yeniden onaylanamaz ve çıktı hazırlanamaz." : delivered ? ` · ${savedSale.delivered_at ? new Date(savedSale.delivered_at).toLocaleDateString("tr-TR") : ""} Teslim kaydı korunur; müşteri ve imalat PDF'leri aşağıda hazır.` : approved ? " · İmalat ve müşteri çıktıları aşağıda hazır." : " · Onaylayabilir veya ölçüleri güncelleyebilirsiniz."}{cancelled && savedSale.stock_restoration_pending ? " Stok iadesi otomatik tamamlanamadı; ürünlerin stok miktarlarını kontrol edin." : ""}</div>}
    {!savedSale && existingId && <div className="notice">Kayıtlı siparişi düzenliyorsunuz. Değişiklikleri kaydetmek için Beklemede veya Siparişi onayla düğmesini kullanın.</div>}

    {tab === "products" ? <section className="panel" role="tabpanel" aria-label="Ürün seçimi">
      <div className="row" style={{ justifyContent: "space-between" }}><h2>Ürün seçin</h2><span className="muted">{totalProducts} ürün</span></div>
      {locked && <div className="notice">{cancelled ? "Bu sipariş iptal edildi." : delivered ? "Bu iş teslim edildi." : "Bu sipariş onaylandı."} Yeni bir sipariş için <button onClick={newOrder}><Plus size={16} />Yeni sipariş</button></div>}
      <div className="filters">
        <Field label={<span className="row"><Search size={16} />Ürün / desen / barkod ara</span>}><input autoComplete="off" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Örn. Isabella veya 2506" /></Field>
        <Field label="Marka"><select value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}><option value="">Tüm markalar</option>{brands.map((brand) => <option key={brand._id} value={brand._id}>{brand.brand_name}</option>)}</select></Field>
        <Field label="Kategori"><select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}><option value="">Tüm kategoriler</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.category_name}</option>)}</select></Field>
      </div>
      {fetchError ? <div className="empty"><p className="error">{fetchError}</p><button onClick={() => setRefresh((value) => value + 1)}>Yeniden dene</button></div> : loading ? <div className="empty" role="status"><Loader2 className="spin" size={28} style={{ margin: "0 auto 10px" }} />Ürünler yükleniyor…</div> : !products.length ? <div className="empty"><Package size={32} style={{ margin: "0 auto" }} /><p>Bu seçimde ürün bulunamadı.</p></div> : <div className="products">{products.map((product) => <button key={product._id} className="product-card" disabled={locked || processing} onClick={() => openProduct(product)}><span className="muted">{product.product_brand?.brand_name} · {product.product_category?.category_name}</span><span className="product-title">{product.product_name}</span>{showFabricSpecs(product) ? <span className="muted">{product.product_color && product.product_color !== "Belirtilmedi" ? product.product_color : "Renk / VR seçimi ürün içinde"}</span> : null}{showFabricSpecs(product) && (product.fabric_width_cm || product.grammage_gr) ? <span className="muted">Kumaş eni {product.fabric_width_cm || "—"} cm · {product.grammage_gr || "—"} g</span> : null}<span className="product-price">{formatMoney(product.sale_price, product.currency || product.price_currency || "TRY")} <span className="muted">/ {product.calculation_type === "m2" ? "m²" : product.calculation_type === "mt" ? "m" : "adet"}</span></span></button>)}</div>}
      <div className="row pagination"><button disabled={filters.page <= 1 || loading} onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}><ArrowLeft size={17} />Önceki</button><span className="muted">Sayfa {filters.page} / {pages}</span><button disabled={filters.page >= pages || loading} onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}>Sonraki<ArrowRight size={17} /></button></div>
      <div className="actions divider"><button className="primary" onClick={() => setTab("summary")}>Sonraki: Sipariş özeti ({cart.length})<ArrowRight size={18} /></button></div>
    </section> : <div role="tabpanel" aria-label="Sipariş özeti">
      <div className="summary-grid">
        <section className="panel"><h2>Sipariş özeti</h2><p className="muted">{cart.length} ürün kalemi · {rooms.length} oda / bölüm</p>
          {!cart.length && <div className="empty">Henüz ürün eklenmedi. Ürünler sekmesinden ilk ürününüzü seçin.</div>}
          {rooms.map((room) => <div key={room}><div className="room-heading"><Home size={20} />{room || "Bölüm belirtilmedi"}</div>{cart.filter((line) => line.room_name === room).map((line) => <article className="cart-line" key={line.id}>
            <h3>{line.product_name}{line.area ? ` · ${line.area}` : ""}</h3><p className="muted">{[line.brand_name, line.variant ? `Renk / VR: ${line.variant}` : "", line.pleat_name, line.facade, line.window_name].filter(Boolean).join(" · ")}</p>
            {hasMechanicalPanels(line) ? <MechanicalDetails line={line} /> : <>{line.chain_direction && <p>Zincir / ip yönü: <strong>{line.chain_direction}</strong></p>}{line.mode === "fon" ? <p>{line.count} {line.order_mode === "takim" ? "takım" : "adet"} · {line.pieces} kanat · {line.panels.map((panel) => `${panel.label}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} cm`).join(" / ")}</p> : line.width || line.height ? <p>En {formatNumber(line.width)} cm · Boy {formatNumber(line.height)} cm{line.mode === "textile" ? ` · ${line.pieces} parça` : ""}</p> : null}</>}
            <p>{line.mode === "fon" || line.mode === "textile" ? "Giden kumaş" : "Miktar"}: <strong>{formatNumber(line.quantity)} {line.unit_label}</strong> × {formatMoney(line.base_unit_price)} = {formatMoney(line.material_total)}</p>
            {hasBillingDimensions(line) && <p className="muted">Hesap ölçüsü: {formatNumber(line.billable_width)} × {formatNumber(line.billable_height)} cm</p>}
            {line.calc_type === "m2" && line.calculation_note && <p className="muted">{line.calculation_note}</p>}
            {line.labor_total > 0 && <p>İşçilik: {formatNumber(line.quantity)} m × {formatMoney(line.labor_unit_price)} = {formatMoney(line.labor_total)}</p>}
            {line.accessories?.map((option, index) => <p className="muted" key={index}>{option.name}: {isPercentageOption(option) ? `%${formatRate(option.quantity)} → ${formatMoney(option.total)}` : `${formatNumber(option.quantity)} ${option.unit} × ${formatMoney(option.unit_price)} = ${formatMoney(option.total)}`}</p>)}
            {line.item_note && <p className="muted">Not: {line.item_note}</p>}
            <div className="line-price"><span>{formatMoney(line.item_total)}</span>{!locked && <div className="row"><button disabled={processing} onClick={() => editLine(line)}>Düzenle</button><button className="button-danger" aria-label={`${line.product_name} kalemini kaldır`} disabled={processing} onClick={() => { setCart((previous) => previous.filter((item) => item.id !== line.id)); dirty(); }}><Trash2 size={16} />Kaldır</button></div>}</div>
          </article>)}</div>)}
          <div className="actions divider"><button disabled={processing || locked} onClick={() => setTab("products")}><ArrowLeft size={18} />Ürün eklemeye dön</button></div>
        </section>
        <section className="panel"><h2>Müşteri ve teslim bilgileri</h2><fieldset disabled={processing || locked}><div className="fields">
          <Field label="Müşteri adı"><input value={header.first_name} onChange={(event) => updateHeader("first_name", event.target.value)} autoComplete="given-name" maxLength={100} placeholder="Ad" required /></Field>
          <Field label="Müşteri soyadı"><input value={header.last_name} onChange={(event) => updateHeader("last_name", event.target.value)} autoComplete="family-name" maxLength={100} placeholder="Soyad" required /></Field>
          <Field label="İletişim numarası"><input type="tel" value={header.customer_phone} onChange={(event) => updateHeader("customer_phone", event.target.value)} autoComplete="tel" maxLength={30} placeholder="05xx xxx xx xx" /></Field>
          <Field label="Teslim tarihi"><input type="date" value={header.delivery_date} onChange={(event) => updateHeader("delivery_date", event.target.value)} required /></Field>
          <Field label="Ölçü durumu" full><select value={header.measurement_status || "preliminary"} onChange={(event) => updateHeader("measurement_status", event.target.value)}><option value="preliminary">Ön ölçü · yerinde teyit bekleniyor</option>{header.measurement_status === "scheduled" && <option value="scheduled" disabled>Ölçü randevusu planlandı</option>}<option value="confirmed">Ölçü teyit edildi</option></select><p className="muted">Ön ölçüyle de sipariş alabilirsiniz. Sonradan Ölçü / Teyit ekranından ustanın aldığı ölçüleri kaydedin.</p></Field>
          <Field label="Adres" full><textarea value={header.customer_address} onChange={(event) => updateHeader("customer_address", event.target.value)} autoComplete="street-address" maxLength={600} placeholder="Montaj / teslim adresi" /></Field>
        </div><p className="choice-label">Teslim şekli</p><div className="row"><button className="chip" aria-pressed={header.delivery_method === "magaza"} onClick={() => updateHeader("delivery_method", "magaza")}>Mağaza teslimi</button><button className="chip" aria-pressed={header.delivery_method === "montaj"} onClick={() => updateHeader("delivery_method", "montaj")}>Montaj</button></div>
          <div className="fields divider"><NumberField label="İskonto oranı (%)" min={0} step="0.1" value={discount} onChange={(value) => { setDiscount(value); dirty(); }} /><Field label="Ödeme şekli"><select value={header.payment_method} onChange={(event) => updateHeader("payment_method", event.target.value)}><option>Nakit</option><option>Kredi Kartı</option><option>Havale / EFT</option></select></Field><Field label="Sipariş notu" full><textarea value={header.sale_note} maxLength={1000} onChange={(event) => updateHeader("sale_note", event.target.value)} placeholder="Müşteri / imalat için sipariş notu" /></Field></div>
        </fieldset>
          <div className="price-box"><div className="total-row"><span>Ara toplam</span><strong>{formatMoney(totals.subtotal)}</strong></div><div className="total-row"><span>İskonto (%{totals.discountPercent})</span><strong>− {formatMoney(totals.discountAmount)}</strong></div><div className="total-row grand-total"><span>Ödenecek</span><span>{formatMoney(totals.total)}</span></div>{totals.error && <p className="error" role="alert">{totals.error}</p>}</div>
        </section>
      </div>
      {reviewed && <div className="review-card" role="status"><strong>{header.first_name} {header.last_name}</strong> · İletişim: {header.customer_phone || "Belirtilmedi"} · Teslim: {header.delivery_date} · {header.delivery_method === "montaj" ? "Montaj" : "Mağaza teslimi"}<p>{cart.length} ürün kalemi / {rooms.length} oda · İskonto %{totals.discountPercent} ({formatMoney(totals.discountAmount)}) · Ödenecek {formatMoney(totals.total)}</p></div>}
      <div className="actions divider">
        <button disabled={!cart.length || processing || locked} onClick={() => { if (validateHeader()) setReviewed(true); }}><ClipboardList size={18} />Siparişi gözden geçir</button>
        <button disabled={!cart.length || processing || locked} onClick={() => saveOrder("beklemede")}>{processing ? <Loader2 className="spin" size={18} /> : null}Beklemede</button>
        <button className="primary" disabled={!cart.length || processing || locked} onClick={() => saveOrder("tamamlandi")}>{processing ? <Loader2 className="spin" size={18} /> : <CheckCircle size={18} />}Siparişi onayla</button>
      </div>
      <div className="actions divider">{savedSale && !cancelled && !delivered && <button className="primary" disabled={processing} onClick={() => navigate(`/dashboard/sales/${savedSale._id}/measurements`)}><ClipboardList size={18} />Ölçü / Teyit</button>}<button disabled={!approved || processing} onClick={() => printOrder("customer")}><Printer size={18} />Müşteri sipariş kağıdı · A4 / PDF</button><button disabled={!approved || processing} onClick={() => printOrder("manufacturing")}><Printer size={18} />Atölye takip formu · A4 / PDF</button>{locked && <button onClick={newOrder}><Plus size={18} />Yeni sipariş</button>}</div>
      {!locked && <p className="muted" style={{ marginTop: 12 }}>İmalat ve müşteri çıktıları, sipariş onaylanıp kaydedildikten sonra açılır.</p>}
    </div>}

    {selected && measurement && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="pos-product-heading">
      <div className="modal-heading"><div><h2 id="pos-product-heading">{selected.product_name}</h2><p className="muted">{selected.product_brand?.brand_name} · Adım {wizardStep} / 2: {wizardStep === 1 ? "Oda, cephe ve pencere" : "Ölçü ve fiyat"}</p></div><button className="modal-close" aria-label="Ürün penceresini kapat" onClick={() => setSelected(null)}><X size={23} /></button></div>
      {wizardStep === 1 ? <>
        <h3 className="choice-label">Oda / bölüm seçin</h3>
        <div role="group" aria-label="Oda seçenekleri" className="pos-room-options">
          {roomOptions.map((room) => <button key={room} type="button" className="chip min-w-0 w-full break-words" aria-pressed={measurement.room_name === room} disabled={locked || processing} onClick={() => updateMeasurement("room_name", room)}>{room}</button>)}
        </div>
        <div className="fields divider"><Field label="Oda / bölüm adı"><input value={measurement.room_name} onChange={(event) => updateMeasurement("room_name", event.target.value)} placeholder="Oda seçin veya kendi oda adınızı yazın" maxLength={100} aria-describedby="pos-room-name-hint" disabled={locked || processing} /></Field><Field label="Bölüm / cam adı (isteğe bağlı)"><input value={measurement.area} maxLength={100} onChange={(event) => updateMeasurement("area", event.target.value)} placeholder="Örn. balkon kapısı" /></Field></div>
        <p id="pos-room-name-hint" className="muted">İstediğiniz kadar oda ekleyebilirsiniz. Örn. Yatak Odası 2, Çocuk Odası 2. Eklediğiniz oda adları sonraki ürünlerde tekrar seçilebilir.</p>
        <p className="choice-label">Hangi cephe? <span className="muted">İsteğe bağlı</span></p><div className="row">{FACADES.map((facade) => <button key={facade} className="chip" aria-pressed={measurement.facade === facade} onClick={() => updateMeasurement("facade", measurement.facade === facade ? "" : facade)}>{facade}</button>)}</div><p className="choice-label">Hangi pencere? <span className="muted">İsteğe bağlı</span></p><div className="row">{WINDOWS.map((windowName) => <button key={windowName} className="chip" aria-pressed={measurement.window_name === windowName} onClick={() => updateMeasurement("window_name", measurement.window_name === windowName ? "" : windowName)}>{windowName}</button>)}</div><p className="muted divider">Her cepheyi ayrı ürün kalemi olarak ekleyebilirsiniz. Oda ve ürün kalemi sayısında sınır yok.</p><div className="actions divider"><button onClick={() => setSelected(null)}>İptal</button><button className="primary" onClick={() => { if (!measurement.room_name.trim()) toast.error("Oda / bölüm adını girin."); else setWizardStep(2); }}>İleri<ArrowRight size={18} /></button></div>
      </> : <>
        <div className="fields"><Field label={panelBuilderActive ? "Ortak renk / VR numarası (isteğe bağlı)" : "Renk / VR numarası"} full><input list="pos-variant-list" value={measurement.variant} maxLength={150} onChange={(event) => updateMeasurement("variant", event.target.value)} placeholder="Renk / VR seçin veya yazın" /><datalist id="pos-variant-list">{(selected.variants || []).map((variant, index) => { const label = typeof variant === "string" ? variant : [variant.vr || variant.vr_number || variant.variant_code || variant.code, variant.color || variant.color_name].filter(Boolean).join(" · "); return <option key={index} value={label} />; })}</datalist></Field>
          {mode === "fon" && <Field label="Satış şekli"><select value={measurement.order_mode} onChange={(event) => updateMeasurement("order_mode", event.target.value)}><option value="takim">Takım · 2 kanat</option><option value="adet">Adet · tek kanat</option></select></Field>}
          <NumberField label={panelBuilderActive ? "Bu ölçü grubundan kaç adet?" : mode === "textile" ? "Parça sayısı" : mode === "fon" && measurement.order_mode === "takim" ? "Takım adedi" : "Adet sayısı"} value={measurement.count} onChange={(value) => updateMeasurement("count", value)} min={1} step={1} />
          {!panelBuilderActive && <><NumberField label={mode === "fon" ? (measurement.order_mode === "takim" ? "Sol kanat eni (cm)" : "Kanat eni (cm)") : mode === "textile" ? "Toplam cephe / bitmiş en (cm)" : "En (cm)"} value={measurement.width} onChange={(value) => updateMeasurement("width", value)} min={selected.calculation_type === "adet" ? 0 : 1} />
          <NumberField label={mode === "fon" && measurement.order_mode === "takim" ? "Sol kanat boyu (cm)" : "Boy (cm)"} value={measurement.height} onChange={(value) => updateMeasurement("height", value)} min={selected.calculation_type === "m2" || mode === "fon" || mode === "textile" ? 1 : 0} /></>}
          {(mode === "textile" || mode === "fon") && <><Field label="Pile türü"><select value={measurement.pleat_id} onChange={(event) => updateMeasurement("pleat_id", event.target.value)}>{PLEATS.map((pleat) => <option key={pleat.id} value={pleat.id}>{pleat.name} · 1'e {pleat.factor}</option>)}</select></Field><NumberField label="Giden kumaşın metre işçiliği (₺ / m)" value={measurement.labor_price} onChange={(value) => updateMeasurement("labor_price", value)} /></>}
          {currency !== "TRY" && <NumberField label={`${currency} / TL kuru`} value={measurement.currency_rate} onChange={(value) => updateMeasurement("currency_rate", value)} min={0.0001} />}
        </div>
        {panelBuilderActive && <fieldset className="divider" disabled={locked || processing}>
          <h3>Kasa ve parçalar</h3><div role="group" aria-label="Kasa seçimi" className="row" style={{ marginTop: 12 }}><button type="button" className="chip" aria-pressed={measurement.case_mode === "ayri"} onClick={() => updateMeasurement("case_mode", "ayri")}>Her parça ayrı kasada</button><button type="button" className="chip" aria-pressed={measurement.case_mode === "ortak"} onClick={() => updateMeasurement("case_mode", "ortak")}>Tüm parçalar tek kasada</button></div>
          {measurement.case_mode === "ortak" && <div className="fields divider"><NumberField label="Kasa / profil eni (cm, isteğe bağlı)" value={measurement.profile_width_cm || ""} min={0} onChange={(value) => updateMeasurement("profile_width_cm", value)} /><p className="muted full">Yalnız imalat bilgisi; kasa fiyatı parçaların gerçek enleri toplamından hesaplanır.</p></div>}
          <p className="muted">Her parçanın enini, boyunu ve yönünü girin. Parçaları soldan sağa ekleyin; Sol / Orta / Sağ konumu otomatik belirlenir. Renk / VR isteğe bağlıdır. Ortak renk / VR girilmişse boş bırakılan parçalara uygulanır. Özel konum adlarını Bölüm / cam adı alanına yazabilirsiniz.</p>
          {measurement.mechanical_panels.map((panel, index) => <section className="review-card" key={index} aria-label={`${index + 1}. mekanik parça`}><div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><h3>{mechanicalPartTitle(panel, index, measurement.mechanical_panels.length, measurement.case_mode)}</h3><button type="button" className="button-danger" aria-label={`${index + 1}. parçayı kaldır`} disabled={measurement.mechanical_panels.length <= 1} onClick={() => removeMechanicalPanel(index)}><Trash2 size={16} />Kaldır</button></div><div className="fields"><NumberField label={`${index + 1}. parça eni (cm)`} value={panel.width} min={1} onChange={(value) => updateMechanicalPanel(index, "width", value)} /><NumberField label={`${index + 1}. parça boyu (cm)`} value={panel.height} min={1} onChange={(value) => updateMechanicalPanel(index, "height", value)} /><Field label={measurement.case_mode === "ayri" ? "Kasa konumu" : "Parça konumu"}><select aria-label={`${index + 1}. ${measurement.case_mode === "ayri" ? "kasa" : "parça"} konumu`} value={panel.position_override || ""} onChange={(event) => updateMechanicalPanel(index, "position_override", event.target.value)}><option value="">Otomatik ({mechanicalPanelPosition(index, measurement.mechanical_panels.length).replace(/^Tek parça$/, "Tek")})</option><option value="Sol">Sol</option><option value="Orta">Orta</option><option value="Sağ">Sağ</option></select></Field><Field label={`${index + 1}. parça renk / VR numarası (isteğe bağlı)`} full><input list="pos-variant-list" value={panel.variant} maxLength={150} placeholder={measurement.variant || "Renk / VR yazın"} onChange={(event) => updateMechanicalPanel(index, "variant", event.target.value)} /></Field></div><p className="choice-label">Zincir / ip yönü</p><div role="group" aria-label={`${index + 1}. parça zincir / ip yönü`} className="row">{["Sağ", "Sol"].map((direction) => <button key={direction} type="button" className="chip" style={{ minWidth: 120 }} aria-pressed={panel.chain_direction === direction} onClick={() => updateMechanicalPanel(index, "chain_direction", direction)}>{direction}</button>)}</div></section>)}
          <button type="button" onClick={addMechanicalPanel}><Plus size={18} />Parça ekle</button>
        </fieldset>}
        {mode === "fon" && measurement.order_mode === "takim" && <><label className="check"><input type="checkbox" checked={measurement.separate_right} onChange={(event) => updateMeasurement("separate_right", event.target.checked)} />Sağ kanat ölçüsü farklı</label>{measurement.separate_right && <div className="fields"><NumberField label="Sağ kanat eni (cm)" value={measurement.right_width} onChange={(value) => updateMeasurement("right_width", value)} min={1} /><NumberField label="Sağ kanat boyu (cm)" value={measurement.right_height} onChange={(value) => updateMeasurement("right_height", value)} min={1} /></div>}</>}
        {(mode === "textile" || mode === "fon") && <p className="muted">Her kanada / parçaya 40 cm dikiş payı eklenir. Boy ölçüsü sadece imalat içindir; fiyatı değiştirmez.</p>}
        {directionRequired && !panelBuilderActive && <div className="divider"><h3 className="choice-label">Zincir / ip yönü</h3><div role="group" aria-label="Zincir / ip yönü" className="row">{["Sağ", "Sol"].map((direction) => <button key={direction} type="button" className="chip" style={{ minWidth: 120 }} aria-pressed={measurement.chain_direction === direction} disabled={locked || processing} onClick={() => updateMeasurement("chain_direction", direction)}>{direction}</button>)}</div><p className="muted">Ürünün zincir / ip yönünü seçin.</p></div>}
        {selected.calculation_type === "m2" && <div className="notice" style={{ marginTop: 12 }}><strong>m² hesap kuralları</strong><p>Fiyat, en × boy ve adet üzerinden hesaplanır. İmalat için girdiğiniz ölçüler korunur.</p>{Number(selected.min_width_cm) > 0 && <p>Hesapta minimum en: {formatNumber(selected.min_width_cm)} cm</p>}{Number(selected.min_height_cm) > 0 && <p>Hesapta minimum boy: {formatNumber(selected.min_height_cm)} cm</p>}{Number(selected.dimension_rounding_cm) > 0 && <p>Hesapta en ve boy {formatNumber(selected.dimension_rounding_cm)} cm'lik adımlara yukarı yuvarlanır.</p>}{Number(selected.min_m2) > 0 && <p>Minimum miktar: {formatNumber(selected.min_m2)} m² / adet</p>}{Number(selected.rounding_step) > 0 && <p>m² miktarı {formatNumber(selected.rounding_step)} m² adımına yukarı yuvarlanır.</p>}</div>}
        {currency !== "TRY" && <p className="muted">Fiyat {formatMoney(selected.sale_price, currency)} / birim. Bu sipariş için girilen kur kaydedilir.</p>}
        {Boolean(selected.extra_options?.length) && <div className="divider"><h3>Aksesuar / etek / kasa seçenekleri</h3>{selected.extra_options.map((option, index) => <label className="accessory" key={option._id || index}><input type="checkbox" checked={measurement.extra_indices.includes(index)} onChange={(event) => updateMeasurement("extra_indices", event.target.checked ? [...measurement.extra_indices, index] : measurement.extra_indices.filter((item) => item !== index))} /><span>{option.option_name}<span className="muted"> · {isPercentageOption(option) ? `%${formatRate(option.price_impact)}` : `${formatMoney(option.price_impact, option.currency || currency)} / ${accessoryUnit(option, selected)}`}</span></span></label>)}</div>}
        {selected.extra_options?.some((option) => option.pricing_basis === "mt" || option.calculation_type === "mt") && <p className="muted">Metreli aksesuarlar gerçek en üzerinden hesaplanır.</p>}
        <Field label="Ürün / imalat notu" full><textarea maxLength={500} value={measurement.item_note} onChange={(event) => updateMeasurement("item_note", event.target.value)} placeholder="Örn. etek modeli, kasa rengi…" /></Field>
        <div className="price-box" aria-live="polite">{calculation?.line ? <><MechanicalDetails line={calculation.line} /><p>{mode === "fon" || mode === "textile" ? "Giden kumaş" : "Hesaplanan miktar"}: <strong>{formatNumber(calculation.line.quantity)} {calculation.line.unit_label}</strong>{mode === "fon" ? ` · ${calculation.line.pieces} kanat` : ""}</p>{hasBillingDimensions(calculation.line) && <p>Hesap ölçüsü: {formatNumber(calculation.line.billable_width)} × {formatNumber(calculation.line.billable_height)} cm</p>}<p>{formatNumber(calculation.line.quantity)} {calculation.line.unit_label} × {formatMoney(calculation.line.base_unit_price)} = {formatMoney(calculation.line.material_total)}</p>{calculation.line.labor_total > 0 && <p>İşçilik: {formatNumber(calculation.line.quantity)} m × {formatMoney(calculation.line.labor_unit_price)} = {formatMoney(calculation.line.labor_total)}</p>}{calculation.line.accessories_total > 0 && <p>Aksesuarlar: {formatMoney(calculation.line.accessories_total)}</p>}<p className="muted">{calculation.line.calculation_note}</p><p className="big">{formatMoney(calculation.line.item_total)}</p></> : <p className="error">{calculation?.error}</p>}</div>
        <div className="actions"><button onClick={() => setWizardStep(1)}><ArrowLeft size={18} />Geri</button><button className="primary" disabled={!calculation?.line} onClick={addLine}><Plus size={18} />{editId ? "Değişiklikleri kaydet" : "Siparişe ekle"}</button></div>
      </>}
    </section></div>}
  </div>;
}
