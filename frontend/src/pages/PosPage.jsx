import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle, ClipboardList, Copy, Home, Loader2, Package, Plus, Printer, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios.js";
import { accessoryCountsFromLine, accessoryColorsFromLine, calculateCurtainLine, defaultMeasurement, FACADES, formatMoney, formatNumber, groupRusticProducts, hasRusticSizePrices, isObaFoldingProduct, isRusticProduct, isRusticSizeCandidate, prepareRusticSizeProduct, rusticFamilyName, mechanicalPanelPosition, needsControlDirection, orderTotals, paymentConversion, PLEATS, productMode, restoreSaleDraft, ROOM_PRESETS, roundMoney, salePayload, showFabricSpecs, supportsFoldingPanels, usesWidthOnlyMeasurements, WINDOWS } from "../libs/curtainCalculation.js";
import { discountForAgreedTotal, discountLabel, discountPercentInput } from "../libs/agreedPrice.js";
import { discountedCart } from "../libs/discountPresentation.js";
import { hasManufacturingItems, openCurtainPrint } from "../libs/curtainPrint.js";
import { calculateMeasurementBatch, createMeasurementRow, getCaseColorOptions, selectCaseColorIndices, supportsMeasurementBatch } from "../libs/pliseBatch.js";
import { dualPliseRole, getDualCaseColors, validateDualPliseGroups } from "../libs/dualPlise.js";
import { calculateDualSelection, restoreDualSelection } from "../libs/dualPliseForm.js";
import { mechanismGroups, motorizedBaseProduct, sanitizedMechanicalIndices, supportsMotorSystem } from "../libs/motorCatalog.js";
import { calculateMotorSystem, restoreMotorSelection, validateMotorSystemGroups } from "../libs/motorSystem.js";
import PaymentPanel from "../components/PaymentPanel.jsx";
import MotorOptions from "../components/MotorOptions.jsx";
import HemAccessories from "../components/HemAccessories.jsx";
import FoldingRodOptions from "../components/FoldingRodOptions.jsx";
import { foldingRodOption, prepareObaFoldingProduct, setFoldingRodCount } from "../libs/foldingRods.js";
import { hemAccessoryError, hemAccessoryOptions, normalizeHemForMechanism, selectHemAccessory } from "../libs/hemAccessories.js";
import { changeFacadeRoom, labelFacadeLines, nextFacadeMeasurement } from "../libs/facadeEntry.js";
import { isAutomationCategoryName } from "../../../backend/src/libs/posCatalogGroup.js";

const EMPTY_HEADER = { first_name: "", last_name: "", customer_phone: "", customer_address: "", delivery_date: "", delivery_method: "", payment_method: "Nakit", balance_payment_due: "İş tesliminde", payment_plan_note: "", sale_note: "", measurement_status: "preliminary", measurement_source: "unspecified", payment_currency: "TRY", payment_currency_rate: "", payment_rate_mode: "automatic", payment_rate_source: "Harem", payment_rate_type: null, payment_rate_date: null, payment_rate_fetched_at: null, payment_rate_quoted_at: null };
const nextKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isPercentageOption = (option) => option.pricing_basis === "yuzde" || option.unit === "%";
const formatRate = (value) => Number(value || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const formatExchangeRate = (value) => Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const formatRateDate = (value) => value ? value.split("-").reverse().join(".") : "";
const rateFields = (quote, currency) => ({ currency_rate: quote ? String(quote.rates[currency]) : "", currency_rate_mode: "automatic", currency_rate_source: quote?.source || "", currency_rate_type: quote?.rate_type || "", currency_rate_date: quote?.rate_date || "", currency_rate_fetched_at: quote?.fetched_at || "" });
const manualRateFields = { currency_rate_mode: "manual", currency_rate_source: "manual", currency_rate_type: null, currency_rate_date: null, currency_rate_fetched_at: null };
const istanbulDay = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const isFreshQuote = (quote, ttl = 300000) => Boolean(quote && Number.isFinite(Date.parse(quote.fetched_at)) && Date.now() - Date.parse(quote.fetched_at) >= -60000 && Date.now() - Date.parse(quote.fetched_at) < ttl && istanbulDay(quote.fetched_at) === istanbulDay(Date.now()));
const paymentRateFields = (quote, currency) => ({ payment_currency_rate: quote ? String(quote.rates[currency]) : "", payment_rate_mode: "automatic", payment_rate_source: "Harem", payment_rate_type: quote ? "Buying" : null, payment_rate_date: quote?.rate_date || null, payment_rate_fetched_at: quote?.fetched_at || null, payment_rate_quoted_at: quote?.rate_times?.[currency] || null });
const manualPaymentFields = { payment_rate_mode: "manual", payment_rate_source: "manual", payment_rate_type: null, payment_rate_date: null, payment_rate_fetched_at: null, payment_rate_quoted_at: null };
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
  if (!supportsFoldingPanels(product) && (product.calculation_type !== "m2" || !needsControlDirection(product))) return form;
  const panels = hasMechanicalPanels(form) ? form.mechanical_panels : [{ width: form.width, height: form.height, chain_direction: form.chain_direction || "", variant: "" }];
  const restored = panels.map((panel) => ({ width: String(panel.width ?? ""), height: String(panel.height ?? ""), chain_direction: panel.chain_direction || "", variant: panel.variant || "", position_override: panel.position_override || "" }));
  return { ...form, width: restored[0].width, height: restored[0].height, chain_direction: restored[0].chain_direction, case_mode: form.case_mode || "ayri", mechanical_panels: restored };
};

const POS_STYLE = `
.curtain-pos{--p-ink:#443325;--p-muted:#806b56;--p-line:#e2d2bd;--p-coffee:#80512f;--p-gold:#efe0ca;color:var(--p-ink);font-size:16px;max-width:1500px;margin:0 auto;padding:4px}.curtain-pos *{box-sizing:border-box}.curtain-pos .pos-brand{display:flex;align-items:center;gap:18px;margin-bottom:20px}.curtain-pos .pos-brand img{width:150px;height:95px;object-fit:contain;border-radius:12px;background:#fff}.curtain-pos h1{font-size:26px;font-weight:750;margin:0}.curtain-pos h2{font-size:21px;font-weight:700;margin:0 0 14px}.curtain-pos h3{font-size:18px;font-weight:700}.curtain-pos p{margin:6px 0}.curtain-pos .muted{color:var(--p-muted);font-size:14px}.curtain-pos .panel{border:1px solid var(--p-line);border-radius:18px;background:#fffdf8;padding:22px;box-shadow:0 5px 24px #5b402509}.curtain-pos .pos-tabs,.curtain-pos .row,.curtain-pos .actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.curtain-pos .pos-tabs{margin-bottom:18px}.curtain-pos button{min-height:48px;border:1px solid var(--p-line);border-radius:11px;padding:11px 17px;background:#fffdf8;color:var(--p-ink);font-weight:650;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}.curtain-pos button:hover:not(:disabled){background:#f5ebdd;border-color:#b08b64}.curtain-pos button.primary,.curtain-pos button[aria-selected=true],.curtain-pos button.chip[aria-pressed=true]{background:var(--p-coffee);color:#fffaf3;border-color:var(--p-coffee)}.curtain-pos button.primary:hover:not(:disabled){background:#694024}.curtain-pos button:disabled{opacity:.45;cursor:not-allowed}.curtain-pos .button-danger{color:#9c352a}.curtain-pos .filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin:12px 0 20px}.curtain-pos input,.curtain-pos select,.curtain-pos textarea{display:block;width:100%;min-width:0;border:1px solid var(--p-line);border-radius:10px;padding:12px;font:inherit;background:#fffdf8;color:var(--p-ink);margin-top:6px;min-height:48px}.curtain-pos textarea{min-height:85px}.curtain-pos :is(input,select,textarea,button):focus-visible{outline:3px solid #d5aa7a;outline-offset:2px}.curtain-pos label{font-size:14px;font-weight:650;color:#6c513b;display:block}.curtain-pos .fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.curtain-pos .full{grid-column:1/-1}.curtain-pos .products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.curtain-pos button.product-card{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:18px;min-height:145px;gap:5px;overflow-wrap:anywhere}.curtain-pos .product-card .product-title{font-size:18px;font-weight:750;color:#4c3524}.curtain-pos .product-card .product-price{font-size:21px;font-weight:750;margin-top:auto;color:#80512f}.curtain-pos .product-card .muted{font-size:13px;font-weight:400}.curtain-pos .empty{padding:36px 15px;text-align:center;color:var(--p-muted)}.curtain-pos .pagination{margin:18px 0 0;justify-content:space-between}.curtain-pos .summary-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,1fr);gap:20px}.curtain-pos .room-heading{display:flex;gap:8px;align-items:center;font-size:19px;font-weight:750;margin:18px 0 8px;color:#80512f}.curtain-pos .cart-line{padding:15px 0;border-bottom:1px solid var(--p-line);overflow-wrap:anywhere}.curtain-pos .cart-line h3{margin:0}.curtain-pos .cart-line .line-price{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;font-weight:750}.curtain-pos .cart-line button{min-height:38px;padding:6px 10px;font-size:13px}.curtain-pos .price-box{padding:18px;background:var(--p-gold);border-radius:12px;margin:18px 0}.curtain-pos .price-box .big{font-size:28px;font-weight:800}.curtain-pos .total-row{display:flex;justify-content:space-between;gap:14px;margin:8px 0}.curtain-pos .grand-total{font-size:25px;font-weight:800;padding-top:12px;margin-top:12px;border-top:1px solid #c7ac88}.curtain-pos .notice{padding:13px 16px;border:1px solid #d8bd93;background:#f8efdf;border-radius:12px;margin-bottom:16px;font-size:15px}.curtain-pos .saved{border-color:#b9c7a6;background:#f0f3e8}.curtain-pos .error{color:#9e3328;font-weight:600}.curtain-pos .divider{border-top:1px solid var(--p-line);padding-top:18px;margin-top:18px}.curtain-pos .modal-backdrop{position:fixed;inset:0;background:#2a1b1385;z-index:60;display:flex;justify-content:center;align-items:center;padding:18px}.curtain-pos .modal{background:#fffdf8;max-width:860px;width:100%;max-height:calc(100dvh - 36px);border-radius:20px;overflow:auto;border:1px solid #d9c2a5;box-shadow:0 20px 80px #21180c50;padding:24px}.curtain-pos .modal-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.curtain-pos .modal-heading h2{margin-bottom:4px}.curtain-pos .modal-close{padding:10px;min-width:48px}.curtain-pos .choice-label{margin:16px 0 9px;font-weight:700}.curtain-pos .accessory{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--p-line);border-radius:10px;margin:8px 0}.curtain-pos .accessory input,.curtain-pos .check input{width:21px;min-height:21px;height:21px;margin:0;flex-shrink:0;accent-color:#80512f}.curtain-pos .check{display:flex;align-items:center;gap:10px;margin:12px 0}.curtain-pos fieldset{margin:0;padding:0;border:0}.curtain-pos .review-card{background:#f5ecdf;padding:13px;border-radius:11px;margin:15px 0}.curtain-pos .spin{animation:pos-spin 1s linear infinite}@keyframes pos-spin{to{transform:rotate(360deg)}}@media(min-width:1300px){.curtain-pos .products{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:900px){.curtain-pos .summary-grid{grid-template-columns:1fr}.curtain-pos .products{grid-template-columns:repeat(2,minmax(0,1fr))}.curtain-pos .filters{grid-template-columns:1fr 1fr}.curtain-pos .filters>label:first-child{grid-column:1/-1}}@media(max-width:550px){.curtain-pos{padding:0}.curtain-pos .panel{padding:16px}.curtain-pos .pos-brand{gap:12px}.curtain-pos .pos-brand img{width:100px;height:75px}.curtain-pos h1{font-size:22px}.curtain-pos .fields{grid-template-columns:1fr}.curtain-pos .full{grid-column:auto}.curtain-pos .modal{padding:17px}.curtain-pos .modal-backdrop{padding:8px}.curtain-pos button.product-card{padding:13px;min-height:145px}.curtain-pos .product-card .product-title{font-size:16px}.curtain-pos .product-card .product-price{font-size:18px}.curtain-pos .actions>button{flex:1 1 180px}.curtain-pos .price-box{padding:14px}.curtain-pos .products{gap:9px}}
.curtain-pos .pos-room-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(min-width:700px){.curtain-pos .pos-room-options{grid-template-columns:repeat(4,minmax(0,1fr))}}
.curtain-pos .pos-tabs button[role=tab][aria-selected=true]{background:#80512f!important;color:#fffaf3!important;border-color:#80512f!important}
.curtain-pos .measure-list{overflow-x:auto;margin:16px 0;border:1px solid var(--p-line);border-radius:12px}.curtain-pos .measure-list table{width:100%;min-width:880px;border-collapse:collapse;text-align:left}.curtain-pos .measure-list th{padding:10px 8px;background:#efe0ca;font-size:13px}.curtain-pos .measure-list td{padding:8px;border-top:1px solid var(--p-line);vertical-align:middle;font-size:14px}.curtain-pos .measure-list input{margin:0;padding:9px;min-width:65px}.curtain-pos .measure-list td:nth-child(1){min-width:105px}.curtain-pos .measure-list td:nth-child(5){min-width:125px}.curtain-pos .measure-list td:nth-child(6){min-width:125px}.curtain-pos .measure-list td:nth-child(7){min-width:100px}.curtain-pos .measure-list td:last-child{min-width:112px}.curtain-pos .measure-list button{padding:10px;min-width:44px}.curtain-pos .measure-list .row{gap:6px;flex-wrap:nowrap}.curtain-pos .modal.modal-measurements{max-width:1100px}.curtain-pos .measure-list select{margin:0;padding:9px;min-width:115px}.curtain-pos .accessory-group{margin:10px 0;border:1px solid var(--p-line);border-radius:12px;padding:0 12px}.curtain-pos .accessory-group summary{min-height:52px;padding:15px 4px;font-weight:700;cursor:pointer}.curtain-pos .accessory-group[open]{padding-bottom:10px}
`;

function Field({ label, children, full = false }) {
  return <label className={full ? "full" : ""}>{label}{children}</label>;
}

function NumberField({ label, value, onChange, min = 0, step = "any", required = false, readOnly = false }) {
  return <Field label={label}><input type="number" inputMode="decimal" min={min} step={step} value={value} onChange={(event) => onChange(event.target.value)} required={required} readOnly={readOnly} /></Field>;
}

function MechanicalDetails({ line }) {
  if (!hasMechanicalPanels(line)) return null;
  return <div><p><strong>{line.case_count} kasa · {line.pieces} parça</strong> · {line.case_mode === "ortak" ? "Ortak kasa" : "Ayrı kasalar"}{line.count > 1 ? ` · ${line.count} ölçü grubu` : ""}</p>{line.case_mode === "ortak" && <p>Toplam parça eni: {formatNumber(line.case_width)} cm</p>}{line.case_mode === "ortak" && Number(line.profile_width_cm) > 0 && <p>Kasa / profil eni: {formatNumber(line.profile_width_cm)} cm (imalat bilgisi)</p>}{line.mechanical_panels.map((panel, index) => <div key={index} style={{ marginTop: 8 }}><p>{mechanicalPartTitle(panel, index, line.mechanical_panels.length, line.case_mode)}: <strong>{formatNumber(panel.width)} × {formatNumber(panel.height)} cm</strong></p><p className="muted">Renk / VR: {panel.variant || line.variant || "Belirtilmedi"}{panel.chain_direction ? ` · ${line.motor_system?.role === "curtain" ? "Motor yönü" : "Zincir / ip yönü"}: ${panel.chain_direction}` : ""}</p>{hasPanelBillingDimensions(panel) && <p className="muted">Hesap eni: {formatNumber(panel.billable_width)} cm{line.calc_type === "m2" ? ` · Hesap boyu: ${formatNumber(panel.billable_height)} cm` : ""}</p>}</div>)}</div>;
}

export default function PosPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [filters, setFilters] = useState({ search: "", category: "", brand: "", page: 1, pos_group: "curtains" });
  const [pages, setPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [fxQuote, setFxQuote] = useState(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState("");
  const [fxRefresh, setFxRefresh] = useState(0);
  const [fxSaved, setFxSaved] = useState(false);
  const fxContext = useRef({ currency: "TRY", saved: false });
  const [paymentQuote, setPaymentQuote] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentRefresh, setPaymentRefresh] = useState(0);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const paymentContext = useRef({ currency: "TRY", saved: false, pending: false });
  const [tab, setTab] = useState("products");
  const [cart, setCart] = useState([]);
  const [header, setHeader] = useState({ ...EMPTY_HEADER });
  const [discount, setDiscount] = useState("0");
  const [agreedPrice, setAgreedPrice] = useState(null);
  const [recordedFee, setRecordedFee] = useState(0);
  const [selected, setSelected] = useState(null);
  const [productPicker, setProductPicker] = useState(false);
  const [pickerRoom, setPickerRoom] = useState("");
  const [pickerContext, setPickerContext] = useState(null);
  const [measurement, setMeasurement] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [editId, setEditId] = useState(null);
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [batchRows, setBatchRows] = useState([]);
  const [batchTarget, setBatchTarget] = useState("1");
  const [dualEnabled, setDualEnabled] = useState(false);
  const [dualProducts, setDualProducts] = useState([]);
  const [secondaryProduct, setSecondaryProduct] = useState(null);
  const [dualLoading, setDualLoading] = useState(false);
  const [dualError, setDualError] = useState("");
  const [dualRefresh, setDualRefresh] = useState(0);
  const [editDualPair, setEditDualPair] = useState(null);
  const [legacyDualHeights, setLegacyDualHeights] = useState(null);
  const [motorEnabled, setMotorEnabled] = useState(false);
  const [motorCatalog, setMotorCatalog] = useState([]);
  const [motorCatalogLoading, setMotorCatalogLoading] = useState(false);
  const [motorCatalogError, setMotorCatalogError] = useState("");
  const [motorCatalogRefresh, setMotorCatalogRefresh] = useState(0);
  const [motorProduct, setMotorProduct] = useState(null);
  const [motorRateForm, setMotorRateForm] = useState({});
  const [motorFxSaved, setMotorFxSaved] = useState(false);
  const [editMotorPair, setEditMotorPair] = useState(null);
  const manualMotorContext = useRef(null);
  const motorFxContext = useRef({ currency: "TRY", saved: false, pending: false });
  const [existingId, setExistingId] = useState(null);
  const [savedSale, setSavedSale] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const processingRef = useRef(false);
  const idempotencyKey = useRef(nextKey());
  const restoredId = useRef(null);
  const lastRoom = useRef("Salon");
  const selectionRequest = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const delivered = savedSale?.status === "teslim_edildi";
  const approved = savedSale?.status === "tamamlandi" || delivered;
  const cancelled = savedSale?.status === "iptal";
  const locked = approved || cancelled;
  const dualRole = dualPliseRole(selected);
  const dualActive = Boolean(dualRole && dualEnabled);
  const batchAvailable = Boolean(selected && (!editId || dualActive) && supportsMeasurementBatch(selected));
  const widthOnly = usesWidthOnlyMeasurements(selected);
  const batchActive = batchAvailable && (batchEnabled || dualActive);
  const retainedCartCount = cart.length - (editMotorPair?.length || editDualPair?.length || (editId ? 1 : 0));
  const motorAvailable = Boolean(selected && supportsMotorSystem(selected));
  const motorBrandId = selected?.product_brand?._id || "";

  useEffect(() => {
    if (!motorAvailable) return;
    const controller = new AbortController();
    setMotorCatalogLoading(true);
    setMotorCatalogError("");
    api.get("/products", { signal: controller.signal, params: { brand: motorBrandId, limit: 3000 } }).then(({ data }) => {
      if (!controller.signal.aborted) setMotorCatalog(data.products || []);
    }).catch((error) => { if (!controller.signal.aborted) { setMotorCatalog([]); setMotorCatalogError(error.response?.data?.message || "Motor ve mekanizma listesi yüklenemedi."); } })
      .finally(() => { if (!controller.signal.aborted) setMotorCatalogLoading(false); });
    return () => controller.abort();
  }, [motorAvailable, motorBrandId, motorCatalogRefresh]);

  useEffect(() => {
    if (!dualActive || !selected) return;
    const controller = new AbortController();
    setDualLoading(true);
    setDualError("");
    api.get("/products", { signal: controller.signal, params: { search: "Plise", brand: selected.product_brand?._id || "", limit: 100 } }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setDualProducts((data.products || []).filter((product) => { const role = dualPliseRole(product); return role && role !== dualRole; }));
    }).catch((error) => {
      if (!controller.signal.aborted) { setDualProducts([]); setDualError(error.response?.data?.message || "İkinci kumaşın ürün listesi alınamadı."); }
    }).finally(() => { if (!controller.signal.aborted) setDualLoading(false); });
    return () => controller.abort();
  }, [dualActive, selected, dualRole, dualRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/exchange-rates", { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (data.stale || data.source !== "TCMB" || data.rate_type !== "ForexSelling" || !/^\d{4}-\d{2}-\d{2}$/.test(data.rate_date) || !Number.isFinite(Date.parse(data.fetched_at)) || !["USD", "EUR"].every((code) => Number.isFinite(data.rates?.[code]) && data.rates[code] > 0)) throw new Error("Kur bilgisi doğrulanamadı. Yeniden deneyin veya elle kur girin.");
      setFxQuote(data);
      setFxError("");
      setMeasurement((previous) => (!fxContext.current.saved || fxContext.current.pending) && ["USD", "EUR"].includes(fxContext.current.currency) && previous?.currency_rate_mode === "automatic" && !previous.currency_rate ? { ...previous, ...rateFields(data, fxContext.current.currency) } : previous);
      setMotorRateForm((previous) => motorFxContext.current.pending && !motorFxContext.current.saved && previous.currency_rate_mode === "automatic" && !previous.currency_rate ? { ...previous, ...rateFields(data, motorFxContext.current.currency) } : previous);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setFxQuote(null);
      setFxError(error.response?.data?.message || error.message || "Günlük kur alınamadı.");
    }).finally(() => { if (!controller.signal.aborted) setFxLoading(false); });
    return () => controller.abort();
  }, [fxRefresh]);

  useEffect(() => {
    if (!paymentRefresh) return;
    const controller = new AbortController();
    api.get("/exchange-rates", { signal: controller.signal, params: { provider: "harem" } }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (data.stale || data.source !== "Harem" || data.rate_type !== "Buying" || !/^\d{4}-\d{2}-\d{2}$/.test(data.rate_date) || !Number.isFinite(Date.parse(data.fetched_at)) || !["USD", "EUR"].every((code) => Number.isFinite(data.rates?.[code]) && data.rates[code] > 0 && Number.isFinite(Date.parse(data.rate_times?.[code])))) throw new Error("Harem alış kuru doğrulanamadı.");
      setPaymentQuote(data);
      setPaymentError("");
      setHeader((previous) => (!paymentContext.current.saved || paymentContext.current.pending) && previous.payment_currency === paymentContext.current.currency && previous.payment_currency !== "TRY" && previous.payment_rate_mode === "automatic" && !previous.payment_currency_rate ? { ...previous, ...paymentRateFields(data, previous.payment_currency) } : previous);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setPaymentQuote(null);
      setPaymentError(error.response?.data?.message || error.message || "Harem alış kuru alınamadı.");
    }).finally(() => { if (!controller.signal.aborted) setPaymentLoading(false); });
    return () => controller.abort();
  }, [paymentRefresh]);

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
        let response = await api.get("/products", { signal: controller.signal, params: { ...filters, limit: filters.pos_group === "automation" ? 6 : 24 } });
        const rusticCategory = categories.some((category) => category._id === filters.category && isRusticProduct({ product_category: category }));
        if (filters.pos_group !== "automation" && (rusticCategory || response.data.products?.some(isRusticSizeCandidate))) {
          response = await api.get("/products", { signal: controller.signal, params: { ...filters, page: 1, limit: 3000 } });
          if (response.data.totalProducts > response.data.products?.length) throw new Error("Rustik listesini marka veya model seçerek daraltın.");
          const grouped = groupRusticProducts(response.data.products || []);
          if (!controller.signal.aborted) {
            setProducts(grouped.slice((filters.page - 1) * 24, filters.page * 24));
            setPages(Math.max(1, Math.ceil(grouped.length / 24)));
            setTotalProducts(grouped.length);
          }
        } else if (!controller.signal.aborted) {
          setProducts(response.data.products || []);
          setPages(Math.max(1, response.data.totalPages || 1));
          setTotalProducts(response.data.totalProducts || 0);
        }
      } catch (error) {
        if (!controller.signal.aborted) setFetchError(error.response?.data?.message || "Ürünler yüklenemedi. Yeniden deneyin.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [filters, refresh, categories]);

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
      paymentContext.current = { currency: restored.header.payment_currency || "TRY", saved: true, pending: false };
      setPaymentSaved(paymentContext.current.currency !== "TRY");
      setDiscount(String(restored.discount));
      setRecordedFee(Number(sale.credit_card_fee) || 0);
      setExistingId(sale._id);
      setSavedSale(sale);
      setReviewed(false);
      setTab("summary");
      if (transferred) navigate(`/dashboard/pos?order=${sale._id}`, { replace: true, state: null });
    };
    restore().catch((error) => { if (active) toast.error(error.message || "Sipariş açılamadı."); });
    return () => { active = false; };
  }, [location.search, location.state, navigate]);

  const displayCart = useMemo(() => {
    try { return discountedCart(cart, discount); }
    catch { return cart; }
  }, [cart, discount]);
  const agreedPriceActive = agreedPrice?.cart === cart;
  const totals = useMemo(() => {
    try {
      if (agreedPriceActive && agreedPrice.error) throw new Error(agreedPrice.error);
      const calculated = orderTotals(cart, discount); return { ...calculated, total: roundMoney(calculated.total + recordedFee), error: "" }; }
    catch (error) { return { subtotal: cart.reduce((sum, line) => sum + line.item_total, 0), discountPercent: 0, discountAmount: 0, total: 0, error: error.message }; }
  }, [cart, discount, recordedFee, agreedPrice, agreedPriceActive]);
  const changeAgreedPrice = (value) => {
    try {
      const percent = discountForAgreedTotal(cart, value, recordedFee);
      setDiscount(String(percent));
      setAgreedPrice({ cart, value, error: "" });
    } catch (error) {
      setAgreedPrice({ cart, value, error: error.message });
    }
    dirty();
  };
  const paymentCalculation = useMemo(() => {
    try { return { value: paymentConversion(totals.total, header), error: "" }; }
    catch (error) { return { value: null, error: error.message }; }
  }, [totals.total, header]);
  const batchCalculation = useMemo(() => {
    if (!batchActive || !selected || !measurement) return null;
    try { return { value: dualActive ? calculateDualSelection(selected, secondaryProduct, measurement, batchRows) : calculateMeasurementBatch(selected, measurement, batchRows), error: "" }; }
    catch (error) { return { value: null, error: error.message }; }
  }, [batchActive, dualActive, selected, secondaryProduct, measurement, batchRows]);
  const batchPreviews = useMemo(() => batchActive && selected && measurement ? batchRows.map((row) => {
    try { if (dualActive) { const value = calculateDualSelection(selected, secondaryProduct, measurement, [row]); return { ...value.groups[0], item_total: value.total }; } return calculateMeasurementBatch(selected, measurement, [row]).lines[0]; }
    catch { return null; }
  }) : [], [batchActive, dualActive, selected, secondaryProduct, measurement, batchRows]);
  const calculation = useMemo(() => {
    if (!selected || !measurement) return null;
    const accessoryError = hemAccessoryError(selected, measurement);
    if (accessoryError) return { line: null, error: accessoryError };
    if (supportsMeasurementBatch(selected) && getCaseColorOptions(selected).filter((choice) => measurement.extra_indices.includes(choice.index)).length > 1) return { line: null, error: "Ürün için tek bir kasa rengi seçin." };
    if (measurement.currency_rate_mode === "automatic" && !Number(measurement.currency_rate)) return { line: null, error: fxLoading ? "Günlük kur yükleniyor…" : "Otomatik kur alınamadı. Yeniden deneyin veya elle kur girin." };
    try { return { line: calculateCurtainLine(selected, measurement), error: "" }; }
    catch (error) { return { line: null, error: error.message }; }
  }, [selected, measurement, fxLoading]);
  const motorCalculation = useMemo(() => {
    if (!motorEnabled || !selected || !measurement) return null;
    const accessoryError = hemAccessoryError(selected, measurement);
    if (accessoryError) return { value: null, error: accessoryError };
    if (!motorProduct) return { value: null, error: "Motor modelini seçin." };
    try { return { value: calculateMotorSystem(selected, motorProduct, measurement, motorRateForm), error: "" }; }
    catch (error) { return { value: null, error: error.message }; }
  }, [motorEnabled, selected, measurement, motorProduct, motorRateForm]);
  const rooms = [...new Set(cart.map((line) => line.room_name))];
  const roomOptions = [...new Set([...ROOM_PRESETS, ...rooms.filter((room) => typeof room === "string" && room.trim())])];
  const dirty = () => { setReviewed(false); setSavedSale(null); };
  const updateHeader = (key, value) => { if (locked) return; setHeader((previous) => ({ ...previous, [key]: value })); dirty(); };
  const updateMeasurement = (key, value) => setMeasurement((previous) => key === "room_name" ? changeFacadeRoom(previous, value, cart) : { ...previous, [key]: value });
  const closeProduct = () => { selectionRequest.current += 1; setSelected(null); };
  const closeProductPicker = () => { selectionRequest.current += 1; setProductPicker(false); };
  const refreshRates = () => { setFxLoading(true); setFxError(""); setFxRefresh((value) => value + 1); };
  const applyAutomaticRate = () => {
    if (locked || processing || fxLoading || !["USD", "EUR"].includes(fxContext.current.currency)) return;
    setFxSaved(false);
    fxContext.current.pending = true;
    const quote = !fxError && isFreshQuote(fxQuote) ? fxQuote : null;
    setMeasurement((previous) => ({ ...previous, ...rateFields(quote, fxContext.current.currency) }));
    if (!quote) refreshRates();
  };
  const useManualRate = () => {
    if (locked || processing) return;
    setFxSaved(false);
    fxContext.current.pending = false;
    setMeasurement((previous) => ({ ...previous, ...manualRateFields }));
  };
  const selectMotor = (product) => {
    const code = product.currency || product.price_currency || "TRY";
    const quote = !fxLoading && !fxError && isFreshQuote(fxQuote) ? fxQuote : null;
    motorFxContext.current = { currency: code, saved: false, pending: code !== "TRY" };
    setMotorFxSaved(false);
    setMotorProduct(product);
    setMotorRateForm(code === "TRY" ? { ...manualRateFields, currency_rate: "1" } : rateFields(quote, code));
    if (code !== "TRY" && !quote && !fxLoading) refreshRates();
  };
  const useAutomaticMotorRate = () => {
    const code = motorFxContext.current.currency;
    if (fxLoading || !["USD", "EUR"].includes(code)) return;
    const quote = !fxError && isFreshQuote(fxQuote) ? fxQuote : null;
    motorFxContext.current = { currency: code, saved: false, pending: true };
    setMotorFxSaved(false);
    setMotorRateForm(rateFields(quote, code));
    if (!quote) refreshRates();
  };
  const useManualMotorRate = () => {
    motorFxContext.current = { ...motorFxContext.current, saved: false, pending: false };
    setMotorFxSaved(false);
    setMotorRateForm((previous) => ({ ...previous, ...manualRateFields }));
  };
  const changeMotorMode = (enabled) => {
    if (enabled === motorEnabled || locked || processing) return;
    if (enabled) {
      if (motorCatalogLoading || motorCatalogError) { toast.error("Önce motor listesini yükleyin."); return; }
      const base = motorizedBaseProduct(selected, motorCatalog);
      if (!base) { toast.error("Bu ürünün redüktörsüz temel fiyatı tanımlı değil. Motorlu fiyat için temel ürün kartını tamamlayın."); return; }
      const names = measurement.extra_indices.map((index) => selected.extra_options[index]?.option_name);
      const kept = sanitizedMechanicalIndices(selected, measurement.extra_indices, { motorized: true });
      manualMotorContext.current = { product: selected, manualNames: names.filter((name) => !kept.some((index) => selected.extra_options[index]?.option_name === name)) };
      const indices = (base.extra_options || []).flatMap((option, index) => names.includes(option.option_name) ? [index] : []);
      setSelected(base);
      setMeasurement((previous) => ({ ...previous, extra_indices: sanitizedMechanicalIndices(base, indices, { motorized: true }) }));
      setMotorEnabled(true);
    } else {
      const context = manualMotorContext.current;
      if (context) {
        const names = [...measurement.extra_indices.map((index) => selected.extra_options[index]?.option_name), ...context.manualNames];
        const indices = (context.product.extra_options || []).flatMap((option, index) => names.includes(option.option_name) ? [index] : []);
        setSelected(context.product);
        setMeasurement((previous) => normalizeHemForMechanism(context.product, { ...previous, extra_indices: sanitizedMechanicalIndices(context.product, indices) }));
      }
      manualMotorContext.current = null;
      setMotorEnabled(false);
    }
  };
  const refreshPaymentRates = () => { setPaymentLoading(true); setPaymentError(""); setPaymentRefresh((value) => value + 1); };
  const selectPaymentCurrency = (currency) => {
    if (locked || processing) return;
    paymentContext.current = { currency, saved: false, pending: false };
    setPaymentSaved(false);
    const quote = !paymentLoading && !paymentError && isFreshQuote(paymentQuote, 30000) ? paymentQuote : null;
    setHeader((previous) => ({ ...previous, payment_currency: currency, ...paymentRateFields(currency !== "TRY" ? quote : null, currency) }));
    dirty();
    if (currency !== "TRY" && !quote && !paymentLoading) refreshPaymentRates();
  };
  const applyPaymentRate = () => {
    if (locked || processing || paymentLoading) return;
    paymentContext.current.pending = true;
    setPaymentSaved(false);
    const quote = !paymentError && isFreshQuote(paymentQuote, 30000) ? paymentQuote : null;
    setHeader((previous) => ({ ...previous, ...paymentRateFields(quote, previous.payment_currency) }));
    dirty();
    if (!quote) refreshPaymentRates();
  };
  const useManualPaymentRate = () => {
    if (locked || processing) return;
    paymentContext.current.pending = false;
    setPaymentSaved(false);
    setHeader((previous) => ({ ...previous, ...manualPaymentFields }));
    dirty();
  };
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
  const updateBatchRow = (key, field, value) => setBatchRows((previous) => previous.map((row) => row.key === key ? { ...row, [field]: value } : row));
  const prepareBatchRows = () => {
    const target = Number(batchTarget);
    if (!Number.isInteger(target) || target < 1 || target * (dualActive ? 2 : 1) + retainedCartCount > 1000) { toast.error("Satır sayısını kontrol edin. Bir siparişte en fazla 1000 kumaş / ürün kalemi bulunabilir."); return; }
    if (target < batchRows.length) { toast.error("Girdiğiniz ölçüler korunuyor. Fazla satırları Kaldır düğmesiyle çıkarabilirsiniz."); return; }
    setBatchRows((previous) => [...previous, ...Array.from({ length: Math.max(0, target - previous.length) }, () => ({ ...createMeasurementRow(), key: nextKey() }))]);
  };
  const appendBatchRow = (copy, index) => {
    if ((batchRows.length + 1) * (dualActive ? 2 : 1) + retainedCartCount > 1000) { toast.error("Siparişin 1000 kumaş / ürün kalemi sınırına ulaşıldı."); return; }
    setBatchRows((previous) => {
      const rows = [...previous];
      rows.splice(index === undefined ? rows.length : index + 1, 0, { ...createMeasurementRow(copy), label: "", key: nextKey() });
      return rows;
    });
  };

  const toggleDual = () => {
    if (editDualPair) return;
    if (dualActive) {
      const choices = getCaseColorOptions(selected);
      setBatchRows((previous) => previous.map((row) => ({ ...row, case_color: choices.find((choice) => choice.label === String(row.case_color || "").split(":").at(-1).trim())?.option_name || "" })));
      if ((!batchEnabled || editId) && batchRows[0]) setMeasurement((previous) => {
        const row = createMeasurementRow(batchRows[0]);
        const color = choices.find((choice) => choice.label === row.case_color.split(":").at(-1).trim());
        return { ...previous, ...row, variant: row.variant || previous.variant, secondary_variant: row.secondary_variant || previous.secondary_variant || "", extra_indices: selectCaseColorIndices(selected, previous.extra_indices, color?.option_name || "") };
      });
    }
    if (!dualActive && (!batchEnabled || editId)) {
      const color = getCaseColorOptions(selected).find((choice) => measurement.extra_indices.includes(choice.index));
      setBatchRows([{ ...createMeasurementRow({ ...measurement, case_color: color?.option_name || "" }), key: nextKey() }]);
      setBatchTarget("1");
    }
    setDualEnabled(!dualActive);
  };

  const openProduct = async (product) => {
    if (locked || processing) return;
    const targetRoom = productPicker ? pickerRoom.trim() : lastRoom.current;
    if (productPicker && !targetRoom) { toast.error("Önce oda / bölüm seçin veya adını yazın."); return; }
    const targetContext = productPicker && pickerContext?.room_name === targetRoom ? pickerContext : {};
    const request = ++selectionRequest.current;
    if (isRusticSizeCandidate(product) || hasRusticSizePrices(product)) {
      try {
        const response = await api.get("/products", { params: { search: rusticFamilyName(product).split(" · ")[0], brand: product.product_brand?._id || "", limit: 3000 } });
        if (request !== selectionRequest.current) return;
        if (response.data.totalProducts > response.data.products?.length) throw new Error("Rustik fiyat listesi eksik yüklendi. Aramayı daraltın.");
        const fullProduct = response.data.products?.find((item) => item._id === product._id);
        if (!fullProduct) throw new Error("Rustik ürün katalogda bulunamadı.");
        product = prepareRusticSizeProduct(fullProduct, response.data.products || []);
      } catch (error) { if (request === selectionRequest.current) toast.error(error.message || "Rustik ölçü fiyatları yüklenemedi."); return; }
    }
    if (isObaFoldingProduct(product)) {
      try {
        const response = await api.get("/products", { params: { search: "katlama", brand: product.product_brand?._id || "", limit: 3000 } });
        if (request !== selectionRequest.current) return;
        product = prepareObaFoldingProduct(product, response.data.products || []);
      } catch (error) { if (request === selectionRequest.current) toast.error(error.message || "OBA ara çubuk fiyatı yüklenemedi."); return; }
    }
    setMotorEnabled(false); setMotorProduct(null); setEditMotorPair(null); setMotorRateForm({}); setMotorFxSaved(false);
    manualMotorContext.current = null; motorFxContext.current = { currency: "TRY", saved: false, pending: false };
    const productCurrency = product.currency || product.price_currency || "TRY";
    fxContext.current = { currency: productCurrency, saved: false };
    setFxSaved(false);
    setSelected(product);
    setEditId(null);
    setEditDualPair(null);
    setLegacyDualHeights(null);
    setDualEnabled(false);
    setSecondaryProduct(null);
    setDualProducts([]);
    setBatchEnabled(supportsMeasurementBatch(product));
    setBatchRows([{ ...createMeasurementRow(), key: nextKey() }]);
    setBatchTarget("1");
    const quote = !fxLoading && !fxError && isFreshQuote(fxQuote) ? fxQuote : null;
    setMeasurement(builderForm(product, { ...defaultMeasurement(product), ...targetContext, room_name: targetRoom, ...(productCurrency !== "TRY" ? ["USD", "EUR"].includes(productCurrency) ? rateFields(quote, productCurrency) : manualRateFields : {}) }));
    if (["USD", "EUR"].includes(productCurrency) && !quote && !fxLoading) refreshRates();
    lastRoom.current = targetRoom;
    setProductPicker(false);
    setWizardStep(1);
  };

  const editLine = async (line) => {
    if (locked || processing) return;
    const request = ++selectionRequest.current;
    try {
      if (line.motor_system) {
        const pair = cart.filter((item) => item.motor_system?.group_id === line.motor_system.group_id);
        const responses = await Promise.all(pair.map((item) => api.get("/products", { params: { search: item.product_name, limit: 100 } })));
        if (request !== selectionRequest.current) return;
        const current = [...new Map(responses.flatMap((response) => response.data.products || []).map((product) => [product._id, product])).values()];
        const restored = restoreMotorSelection(pair, current);
        setSelected(restored.curtain); setMeasurement(builderForm(restored.curtain, restored.measurement));
        setMotorProduct(restored.motor); setMotorRateForm(restored.motorRateForm); setEditMotorPair(pair); setMotorEnabled(true);
        setEditId(pair.find((item) => item.motor_system.role === "curtain").id);
        manualMotorContext.current = null;
        motorFxContext.current = { currency: restored.motor.currency || "TRY", saved: true, pending: false };
        setMotorFxSaved(motorFxContext.current.currency !== "TRY");
        fxContext.current = { currency: restored.curtain.currency || "TRY", saved: true, pending: false };
        setFxSaved(fxContext.current.currency !== "TRY");
        setDualEnabled(false); setSecondaryProduct(null); setEditDualPair(null); setLegacyDualHeights(null); setBatchEnabled(false);
        setWizardStep(2);
        return;
      }
      setMotorEnabled(false); setMotorProduct(null); setEditMotorPair(null); setMotorRateForm({}); setMotorFxSaved(false);
      manualMotorContext.current = null; motorFxContext.current = { currency: "TRY", saved: false, pending: false };
      if (line.dual_plise) {
        const pair = cart.filter((item) => item.dual_plise?.group_id === line.dual_plise.group_id);
        const responses = await Promise.all(pair.map((item) => api.get("/products", { params: { search: item.product_name, limit: 100 } })));
        if (request !== selectionRequest.current) return;
        const restored = restoreDualSelection(pair, responses.flatMap((response) => response.data.products || []));
        setSelected(restored.primary);
        setSecondaryProduct(restored.secondary);
        setEditDualPair(pair);
        setLegacyDualHeights(restored.legacyHeights);
        setEditId(null);
        setDualEnabled(true);
        setBatchEnabled(true);
        setBatchRows([{ ...createMeasurementRow(restored.row), key: nextKey() }]);
        setBatchTarget("1");
        setMeasurement(restored.measurement);
        setWizardStep(2);
        return;
      }
      const response = await api.get("/products", { params: { search: isObaFoldingProduct({ ...line, calculation_type: line.calc_type }) ? "katlama" : line.product_name, limit: 3000 } });
      if (request !== selectionRequest.current) return;
      let currentProduct = response.data.products?.find((item) => item._id === line.product_id);
      if (!currentProduct) throw new Error("Ürün katalogda bulunamadı. Bu kalemi kaldırıp yeniden ürün seçebilirsiniz.");
      if (isObaFoldingProduct(currentProduct)) {
        currentProduct = prepareObaFoldingProduct(currentProduct, response.data.products || []);
        currentProduct.extra_options = currentProduct.extra_options.map((option) => {
          const saved = line.accessories?.find((item) => item.name === option.option_name);
          return saved ? { ...option, price_impact: saved.unit_price / (option.currency === "TRY" ? 1 : line.currency_rate) } : option;
        });
      }
      const savedCurrency = line.original_currency || currentProduct.currency || currentProduct.price_currency || "TRY";
      const savedPrice = Number.isFinite(line.original_unit_price) && line.original_unit_price >= 0 ? line.original_unit_price : savedCurrency === "TRY" && Number.isFinite(line.base_unit_price) ? line.base_unit_price : currentProduct.sale_price;
      const product = { ...currentProduct, ...(line.pricing_snapshot?.rustic_size_prices ? { product_name: line.product_name, fixed_dimensions: null, rustic_size_prices: line.pricing_snapshot.rustic_size_prices } : {}), currency: savedCurrency, price_currency: savedCurrency, sale_price: savedPrice };
      fxContext.current = { currency: line.original_currency || product.currency || product.price_currency || "TRY", saved: true };
      setFxSaved(fxContext.current.currency !== "TRY");
      setSelected(product);
      setDualEnabled(false);
      setSecondaryProduct(null);
      setEditDualPair(null);
      setLegacyDualHeights(null);
      setBatchRows([{ ...createMeasurementRow({ ...line, label: "", count: line.count || 1 }), key: nextKey() }]);
      setEditId(line.id);
      setBatchEnabled(false);
      setMeasurement(builderForm(product, { ...defaultMeasurement(product), case_mode: line.case_mode || "ayri", profile_width_cm: line.profile_width_cm ? String(line.profile_width_cm) : "", mechanical_panels: line.mechanical_panels || undefined, room_name: line.room_name, area: line.area, facade: line.facade, window_name: line.window_name, variant: line.variant, item_note: line.item_note, chain_direction: line.chain_direction || "", width: String(line.width), height: String(line.height), count: String(line.count || line.pieces || 1), order_mode: line.order_mode || "adet", pleat_id: PLEATS.find((option) => option.name === line.pleat_name)?.id || "sik", labor_price: String(line.labor_unit_price || 0), currency_rate: line.original_currency !== "TRY" ? String(line.currency_rate || "") : "", currency_rate_mode: line.currency_rate_mode || "manual", currency_rate_source: line.currency_rate_source || "manual", currency_rate_type: line.currency_rate_type || null, currency_rate_date: line.currency_rate_date || null, currency_rate_fetched_at: line.currency_rate_fetched_at || null, separate_right: Boolean(line.panels?.length > 1 && (line.panels[0].width !== line.panels[1].width || line.panels[0].height !== line.panels[1].height)), right_width: String(line.panels?.[1]?.width || line.width), right_height: String(line.panels?.[1]?.height || line.height), accessory_colors: accessoryColorsFromLine(line), accessory_counts: accessoryCountsFromLine(line), extra_indices: (product.extra_options || []).map((option, index) => line.accessories?.some((saved) => saved.name === option.option_name) ? index : -1).filter((index) => index >= 0) }));
      setWizardStep(1);
    } catch (error) { if (request === selectionRequest.current) toast.error(error.message || "Ürün düzenlenemedi."); }
  };

  const openProductPicker = () => {
    setPickerRoom(measurement?.room_name || lastRoom.current || "");
    setPickerContext(measurement ? { room_name: measurement.room_name, area: measurement.area, facade: measurement.facade, window_name: measurement.window_name } : null);
    setFilters(previous => ({ ...previous, search: "", brand: "", category: "", page: 1 }));
    setProductPicker(true);
  };
  const finishProductAddition = (updatedCart, keepOpen, newRoom) => {
    if (newRoom) {
      closeProduct(); setPickerRoom(""); setPickerContext(null); setProductPicker(true);
      setFilters(previous => ({ ...previous, search: "", brand: "", category: "", page: 1 }));
      toast.success("Ürün eklendi. Yeni odayı ve istediğiniz ürünü seçin.");
      return;
    }
    if (!keepOpen) { closeProduct(); return; }
    selectionRequest.current += 1;
    setEditId(null); setEditDualPair(null); setEditMotorPair(null);
    setMotorEnabled(false); setMotorProduct(null); setMotorRateForm({}); setMotorFxSaved(false);
    manualMotorContext.current = null; motorFxContext.current = { currency: "TRY", saved: false, pending: false };
    setDualEnabled(false); setSecondaryProduct(null); setDualProducts([]); setLegacyDualHeights(null);
    setBatchEnabled(supportsMeasurementBatch(selected));
    setBatchRows([{ ...createMeasurementRow(), key: nextKey() }]); setBatchTarget("1");
    setMeasurement(builderForm(selected, nextFacadeMeasurement(selected, measurement, updatedCart)));
    setWizardStep(1);
    toast.success("Cam eklendi. Aynı odadaki yeni camın cephesini ve ölçülerini girin.");
  };

  const addLine = (continueWithNextFacade = false) => {
    const keepOpen = continueWithNextFacade === true && !editId && !editDualPair && !editMotorPair;
    const newRoom = continueWithNextFacade === "room" && !editId && !editDualPair && !editMotorPair;
    const labelLines = (lines) => keepOpen ? labelFacadeLines(lines, cart, measurement.room_name) : lines;
    if (locked || processing) return;
    if (!measurement.room_name.trim()) { toast.error("Oda / bölüm adını girin."); return; }
    if (motorEnabled || editMotorPair) {
      if (motorEnabled ? !motorCalculation?.value : !calculation?.line) { toast.error(motorEnabled ? motorCalculation?.error : calculation?.error); return; }
      const lines = labelLines(motorEnabled ? motorCalculation.value.lines.map((line) => {
        const saved = editMotorPair?.find((item) => item.motor_system.role === line.motor_system.role);
        return { ...line, id: saved?.id || (line.motor_system.role === "curtain" && editId ? editId : line.id), motor_system: { ...line.motor_system, group_id: editMotorPair?.[0].motor_system.group_id || line.motor_system.group_id } };
      }) : [{ ...calculation.line, id: editId || nextKey() }]);
      if (retainedCartCount + lines.length > 1000) { toast.error("Bir siparişte en fazla 1000 ürün kalemi bulunabilir."); return; }
      const removed = new Set(editMotorPair?.map((item) => item.id) || (editId ? [editId] : []));
      const position = cart.findIndex((item) => removed.has(item.id));
      const updated = cart.filter((item) => !removed.has(item.id));
      updated.splice(position < 0 ? updated.length : position, 0, ...lines);
      try { validateMotorSystemGroups(updated); validateDualPliseGroups(updated); } catch (error) { toast.error(error.message); return; }
      setCart(updated); lastRoom.current = measurement.room_name.trim(); dirty(); finishProductAddition(updated, keepOpen, newRoom);
      if (!keepOpen && !newRoom) toast.success(editId ? "Motorlu sistem güncellendi." : "Motorlu perde siparişe eklendi.");
      return;
    }
    if (batchActive) {
      if (!batchCalculation?.value) { toast.error(batchCalculation?.error || "Ölçü satırlarını kontrol edin."); return; }
      if (retainedCartCount + batchCalculation.value.lines.length > 1000) { toast.error("Bir siparişte toplam en fazla 1000 kumaş / ürün kalemi bulunabilir."); return; }
      const lines = labelLines(batchCalculation.value.lines.map((line) => {
        const saved = editDualPair?.find((item) => item.dual_plise.role === line.dual_plise?.role);
        return saved ? { ...line, id: saved.id, dual_plise: { ...line.dual_plise, group_id: saved.dual_plise.group_id } } : { ...line, id: line.id || nextKey() };
      }));
      // An edited pair must stay one physical system; new systems use new rows.
      if (editDualPair && batchRows.length !== 1) { toast.error("Bu çiftli sistemi düzenleyin; diğer camları yeni ürün olarak ekleyin."); return; }
      const removed = new Set(editDualPair?.map((item) => item.id) || (editId ? [editId] : []));
      const position = cart.findIndex((item) => removed.has(item.id));
      const updated = cart.filter((item) => !removed.has(item.id));
      updated.splice(position < 0 ? updated.length : position, 0, ...lines);
      try { validateDualPliseGroups(updated); } catch (error) { toast.error(error.message); return; }
      setCart(updated);
      lastRoom.current = measurement.room_name.trim();
      dirty();
      finishProductAddition(updated, keepOpen, newRoom);
      if (!keepOpen && !newRoom) toast.success(editDualPair || editId ? "Ölçüler güncellendi." : dualActive ? `${batchCalculation.value.pieces} çiftli sistem siparişe eklendi.` : `${lines.length} ölçü satırı / ${batchCalculation.value.pieces} adet siparişe eklendi.`);
      return;
    }
    if (!calculation?.line) { toast.error(calculation?.error || "Ölçüleri kontrol edin."); return; }
    if (!editId && cart.length >= 1000) { toast.error("Bir siparişte toplam en fazla 1000 ölçü satırı bulunabilir."); return; }
    const [line] = labelLines([{ ...calculation.line, id: editId || nextKey() }]);
    const updated = editId ? cart.map((item) => item.id === editId ? line : item) : [...cart, line];
    setCart(updated);
    lastRoom.current = line.room_name;
    dirty();
    finishProductAddition(updated, keepOpen, newRoom);
    if (!keepOpen && !newRoom) toast.success(editId ? "Ürün ölçüleri güncellendi." : "Ürün siparişe eklendi.");
  };

  const validateHeader = () => {
    if (!cart.length) { toast.error("Siparişe en az bir ürün ekleyin."); return false; }
    if (!header.first_name.trim() || !header.last_name.trim()) { toast.error("Müşterinin adını ve soyadını girin."); return false; }
    if (!header.delivery_date || !header.delivery_method) { toast.error("Teslim tarihi ve teslim şeklini seçin."); return false; }
    if (header.delivery_method === "montaj" && !header.customer_address.trim()) { toast.error("Montaj için adres girin."); return false; }
    if (totals.error) { toast.error(totals.error); return false; }
    if (paymentCalculation.error) { toast.error(paymentCalculation.error); return false; }
    return true;
  };

  const acceptSavedSale = (record, status) => {
    const restored = restoreSaleDraft(record);
    setCart(restored.cart);
    setHeader(restored.header);
    paymentContext.current = { currency: restored.header.payment_currency || "TRY", saved: true, pending: false };
    setPaymentSaved(paymentContext.current.currency !== "TRY");
    setDiscount(String(restored.discount));
    setRecordedFee(Number(record.credit_card_fee) || 0);
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
    let submitted = false;
    try {
      const payload = salePayload(cart, header, discount, status, idempotencyKey.current, recordedFee);
      submitted = true;
      const response = existingId ? await api.put(`/sales/${existingId}`, payload) : await api.post("/sales", payload);
      if (!response.data?._id || response.data.status !== status) throw new Error("Sipariş kaydı doğrulanamadı. Tekrar göndermeden sipariş takibini kontrol edin.");
      acceptSavedSale(response.data, status);
    } catch (error) {
      let reconciled = false;
      if (submitted && !error.response) {
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
    setMotorEnabled(false); setMotorProduct(null); setEditMotorPair(null); manualMotorContext.current = null;
    motorFxContext.current = { currency: "TRY", saved: false, pending: false };
    setCart([]); setHeader({ ...EMPTY_HEADER }); setAgreedPrice(null); setDiscount("0"); setRecordedFee(0); setExistingId(null); setSavedSale(null); setReviewed(false); closeProduct(); setTab("products");
    restoredId.current = null; idempotencyKey.current = nextKey();
    paymentContext.current = { currency: "TRY", saved: false, pending: false }; setPaymentSaved(false);
    navigate("/dashboard/pos", { replace: true, state: null });
  };
  const acceptPaymentSale = (record) => {
    const restored = restoreSaleDraft(record);
    setSavedSale(record); setCart(restored.cart); setHeader(restored.header);
    setDiscount(String(restored.discount)); setRecordedFee(Number(record.credit_card_fee) || 0);
  };
  const printOrder = (kind) => { if (!approved || cancelled) return; try { openCurtainPrint(savedSale, kind); } catch (error) { toast.error(error.message); } };
  const currency = selected?.currency || selected?.price_currency || "TRY";
  const mode = selected ? productMode(selected) : "standard";
  const directionRequired = selected ? needsControlDirection(selected) : false;
  const foldingBuilder = supportsFoldingPanels(selected);
  const panelBuilderActive = (foldingBuilder || directionRequired && selected?.calculation_type === "m2") && hasMechanicalPanels(measurement);
  const caseColors = selected && supportsMeasurementBatch(selected) ? getCaseColorOptions(selected) : [];
  const selectedCaseColors = caseColors.filter((choice) => measurement?.extra_indices?.includes(choice.index));
  const accessoryGroups = mechanismGroups(selected).map((group) => ({ ...group, options: group.options.filter(({ index }) => index !== foldingRodOption(selected)?.index && !hemAccessoryOptions(selected).some((choice) => choice.index === index) && !caseColors.some((choice) => choice.index === index) && (!motorEnabled || sanitizedMechanicalIndices(selected, [index], { motorized: true }).length)) })).filter((group) => group.options.length);
  const dualCaseColors = dualActive && secondaryProduct ? getDualCaseColors(selected, secondaryProduct) : [];
  const primaryRoleLabel = dualRole === "tul" ? "Tül" : "Güneşlik";
  const secondaryRoleLabel = dualRole === "tul" ? "Güneşlik" : "Tül";
  const dualGroupIds = [...new Set(cart.filter((line) => line.dual_plise).map((line) => line.dual_plise.group_id))];
  const motorGroupIds = [...new Set(cart.filter((line) => line.motor_system).map((line) => line.motor_system.group_id))];

  const productSelectionContents = <>
      <div className="row" style={{ justifyContent: "space-between" }}><h2>Ürün seçin</h2><span className="muted">{totalProducts} ürün</span></div>
      {locked && <div className="notice">{cancelled ? "Bu sipariş iptal edildi." : delivered ? "Bu iş teslim edildi." : "Bu sipariş onaylandı."} Yeni bir sipariş için <button onClick={newOrder}><Plus size={16} />Yeni sipariş</button></div>}
      <div className="row" role="group" aria-label="Ürün grubu">{[["curtains", "Perdeler"], ["automation", "Motor ve kumanda"]].map(([value, label]) => <button key={value} type="button" className="chip" aria-pressed={filters.pos_group === value} onClick={() => setFilters((previous) => ({ ...previous, pos_group: value, category: "", search: "", page: 1 }))}>{label}</button>)}</div>
      <div className="filters">
        <Field label={<span className="row"><Search size={16} />Ürün / desen / barkod ara</span>}><input autoComplete="off" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Örn. Isabella veya 2506" /></Field>
        <Field label="Marka"><select value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}><option value="">Tüm markalar</option>{brands.map((brand) => <option key={brand._id} value={brand._id}>{brand.brand_name}</option>)}</select></Field>
        <Field label="Kategori"><select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}><option value="">Tüm kategoriler</option>{categories.filter((category) => isAutomationCategoryName(category.category_name) === (filters.pos_group === "automation")).map((category) => <option key={category._id} value={category._id}>{category.category_name}</option>)}</select></Field>
      </div>
      {fetchError ? <div className="empty"><p className="error">{fetchError}</p><button onClick={() => setRefresh((value) => value + 1)}>Yeniden dene</button></div> : loading ? <div className="empty" role="status"><Loader2 className="spin" size={28} style={{ margin: "0 auto 10px" }} />Ürünler yükleniyor…</div> : !products.length ? <div className="empty"><Package size={32} style={{ margin: "0 auto" }} /><p>Bu seçimde ürün bulunamadı.</p></div> : <div className="products">{products.map((product) => <button key={product._id} className="product-card" disabled={locked || processing} onClick={() => openProduct(product)}><span className="muted">{product.product_brand?.brand_name} · {product.product_category?.category_name}</span><span className="product-title">{product.product_name}</span>{showFabricSpecs(product) ? <span className="muted">{product.product_color && product.product_color !== "Belirtilmedi" ? product.product_color : "Renk / VR seçimi ürün içinde"}</span> : null}{showFabricSpecs(product) && (product.fabric_width_cm || product.grammage_gr) ? <span className="muted">Kumaş eni {product.fabric_width_cm || "—"} cm · {product.grammage_gr || "—"} g</span> : null}<span className="product-price">{hasRusticSizePrices(product) ? `${formatMoney(product.rustic_size_prices[0].sale_price, product.currency || "TRY")} başlangıç` : formatMoney(product.sale_price, product.currency || product.price_currency || "TRY")} <span className="muted">/ {hasRusticSizePrices(product) ? "takım" : product.calculation_type === "m2" ? "m²" : product.calculation_type === "mt" ? "m" : "adet"}</span></span></button>)}</div>}
      <div className="row pagination"><button disabled={filters.page <= 1 || loading} onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}><ArrowLeft size={17} />Önceki</button><span className="muted">Sayfa {filters.page} / {pages}</span><button disabled={filters.page >= pages || loading} onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}>Sonraki<ArrowRight size={17} /></button></div>
  </>;

  return <div className="curtain-pos">
    <style>{POS_STYLE}</style>
    <header className="pos-brand"><img src="/sahinsoy-logo.svg" alt="Şahinsoy Perde ve Döşemelik logosu" /><div><h1>Şahinsoy POS</h1><p className="muted">Satış ve sipariş ekranı</p></div></header>
    <aside className="notice" aria-label="Günlük döviz kurları">
      <div className="row" style={{ justifyContent: "space-between" }}><strong>TCMB · Günlük döviz satış kuru</strong><button type="button" disabled={fxLoading || processing} onClick={refreshRates}>{fxLoading ? <Loader2 className="spin" size={16} /> : null}{fxError ? "Kuru yeniden dene" : "Kurları yenile"}</button></div>
      <div role="status">{fxLoading ? <p className="muted">Günlük kur yükleniyor…</p> : fxQuote && <p>USD: <strong>{formatExchangeRate(fxQuote.rates.USD)} ₺</strong> · EUR: <strong>{formatExchangeRate(fxQuote.rates.EUR)} ₺</strong> · Kur tarihi: {formatRateDate(fxQuote.rate_date)}</p>}{fxError && <p className="error">{fxError} Dövizli üründe elle kur girebilir veya yeniden deneyebilirsiniz.</p>}</div>
      <p className="muted">Günlük kurdur; gün içi anlık fiyat değildir. Kurları yenilemek siparişe eklenmiş ürünlerin tutarını değiştirmez.</p>
    </aside>
    <div className="pos-tabs" role="tablist" aria-label="Satış adımları">
      <button role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}><Package size={19} />1 · Ürünler</button>
      <button role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}><ShoppingCart size={19} />2 · Sipariş özeti ({cart.length})</button>
    </div>
    {savedSale && <div className={`notice ${approved ? "saved" : ""}`} role="status"><strong>{cancelled ? "Sipariş iptal edildi." : delivered ? "İş teslim edildi." : approved ? "Sipariş onaylandı." : "Teklif beklemede olarak kaydedildi."}</strong> No: #{savedSale._id.slice(-8).toUpperCase()}{cancelled ? " · Bu kayıt geçmişte korunur; yeniden onaylanamaz ve çıktı hazırlanamaz." : delivered ? ` · ${savedSale.delivered_at ? new Date(savedSale.delivered_at).toLocaleDateString("tr-TR") : ""} Teslim kaydı korunur; müşteri ve imalat PDF'leri aşağıda hazır.` : approved ? " · İmalat ve müşteri çıktıları aşağıda hazır." : " · Onaylayabilir veya ölçüleri güncelleyebilirsiniz."}{cancelled && savedSale.stock_restoration_pending ? " Stok iadesi otomatik tamamlanamadı; ürünlerin stok miktarlarını kontrol edin." : ""}</div>}
    {!savedSale && existingId && <div className="notice">Kayıtlı siparişi düzenliyorsunuz. Değişiklikleri kaydetmek için Beklemede veya Siparişi onayla düğmesini kullanın.</div>}

    {tab === "products" ? <section className="panel" role="tabpanel" aria-label="Ürün seçimi">
      {!productPicker && productSelectionContents}
      <div className="actions divider"><button className="primary" onClick={() => setTab("summary")}>Sonraki: Sipariş özeti ({cart.length})<ArrowRight size={18} /></button></div>
    </section> : <div role="tabpanel" aria-label="Sipariş özeti">
      <div className="summary-grid">
        <section className="panel"><h2>Sipariş özeti</h2><p className="muted">{cart.length} ürün kalemi · {rooms.length} oda / bölüm</p>
          {!cart.length && <div className="empty">Henüz ürün eklenmedi. Ürünler sekmesinden ilk ürününüzü seçin.</div>}
          {rooms.map((room) => <div key={room}><div className="room-heading"><Home size={20} />{room || "Bölüm belirtilmedi"}</div>{displayCart.filter((line) => line.room_name === room).map((line) => <article className="cart-line" key={line.id}>
            <h3>{line.product_name}{line.area ? ` · ${line.area}` : ""}</h3><p className="muted">{[line.brand_name, line.variant ? `Renk / VR: ${line.variant}` : "", line.pleat_name, line.facade, line.window_name].filter(Boolean).join(" · ")}</p>
            {line.dual_plise && <p><strong>Çiftli plise {dualGroupIds.indexOf(line.dual_plise.group_id) + 1} · {line.dual_plise.role === "tul" ? "Tül" : "Güneşlik"}</strong>{line.dual_plise.case_color ? ` · Kasa: ${line.dual_plise.case_color}` : ""}</p>}
            {line.motor_system && <p><strong>Motorlu sistem {motorGroupIds.indexOf(line.motor_system.group_id) + 1} · {line.motor_system.role === "curtain" ? "Perde" : "Motor"}</strong></p>}
            {hasMechanicalPanels(line) ? <MechanicalDetails line={line} /> : <>{line.chain_direction && <p>{line.motor_system?.role === "curtain" ? "Motor yönü" : "Zincir / ip yönü"}: <strong>{line.chain_direction}</strong></p>}{line.mode === "fon" ? <p>{line.count} {line.order_mode === "takim" ? "takım" : "adet"} · {line.pieces} kanat · {line.panels.map((panel) => `${panel.label}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} cm`).join(" / ")}</p> : line.width || line.height ? <p>En {formatNumber(line.width)} cm{!usesWidthOnlyMeasurements(line) && <> · Boy {formatNumber(line.height)} cm</>}{line.mode === "textile" ? ` · ${line.pieces} parça` : ""}</p> : null}</>}
            <p>{line.discount_display && <>Liste fiyatı: <del className="muted">{formatMoney(line.discount_display.original_unit_price)} / {line.unit_label}</del> · <strong>{discountLabel(line.discount_display.percent)} iskonto · Net birim fiyat</strong><br /></>}{line.mode === "fon" || line.mode === "textile" ? "Giden kumaş" : "Miktar"}: <strong>{formatNumber(line.quantity)} {line.unit_label}</strong> × {formatMoney(line.base_unit_price)} = {formatMoney(line.material_total)}</p>
            {line.original_currency && line.original_currency !== "TRY" && <p className="muted">Siparişte kayıtlı kur: 1 {line.original_currency} = {formatExchangeRate(line.currency_rate)} ₺{line.currency_rate_source === "TCMB" && line.currency_rate_date ? ` · TCMB / ${formatRateDate(line.currency_rate_date)}` : " · Elle girilen kur"}</p>}
            {hasBillingDimensions(line) && <p className="muted">Hesap ölçüsü: {formatNumber(line.billable_width)} × {formatNumber(line.billable_height)} cm</p>}
            {(line.calc_type === "m2" || isRusticProduct(line)) && line.calculation_note && <p className="muted">{line.calculation_note}</p>}
            {line.labor_total > 0 && <p>İşçilik: {formatNumber(line.quantity)} m × {formatMoney(line.labor_unit_price)} = {formatMoney(line.labor_total)}</p>}
            {line.accessories?.map((option, index) => <p className="muted" key={index}>{option.name}{option.count_per_piece ? ` · ${option.count_per_piece} ilave / perde` : ""}{option.color ? ` · Renk: ${option.color}` : ""}: {isPercentageOption(option) ? `%${formatRate(option.quantity)} → ${formatMoney(option.total)}` : `${formatNumber(option.quantity)} ${option.unit} × ${formatMoney(option.unit_price)} = ${formatMoney(option.total)}`}</p>)}
            {line.item_note && <p className="muted">Not: {line.item_note}</p>}
            <div className="line-price"><span>{line.discount_display ? "Net tutar: " : ""}{formatMoney(line.item_total)}</span>{!locked && <div className="row"><button disabled={processing} onClick={() => editLine(cart.find((item) => item.id === line.id))}>{line.motor_system ? "Motorlu sistemi düzenle" : line.dual_plise ? "Çiftli sistemi düzenle" : "Düzenle"}</button><button className="button-danger" aria-label={`${line.product_name} kalemini kaldır`} disabled={processing} onClick={() => { setCart((previous) => previous.filter((item) => line.motor_system ? item.motor_system?.group_id !== line.motor_system.group_id : line.dual_plise ? item.dual_plise?.group_id !== line.dual_plise.group_id : item.id !== line.id)); dirty(); }}><Trash2 size={16} />{line.motor_system ? "Motorlu sistemi kaldır" : line.dual_plise ? "Çiftli sistemi kaldır" : "Kaldır"}</button></div>}</div>
          </article>)}</div>)}
          {totals.discountPercent > 0 && <p className="muted">Birim fiyatlar ve kalem tutarları {discountLabel(totals.discountPercent)} iskonto uygulanmış net fiyatlardır. Kuruş yuvarlaması olabilir.</p>}
          <div className="actions divider"><button disabled={processing || locked} onClick={() => setTab("products")}><ArrowLeft size={18} />Ürün eklemeye dön</button></div>
        </section>
        <section className="panel"><h2>Müşteri ve teslim bilgileri</h2><fieldset disabled={processing || locked}><div className="fields">
          <Field label="Müşteri adı"><input value={header.first_name} onChange={(event) => updateHeader("first_name", event.target.value)} autoComplete="given-name" maxLength={100} placeholder="Ad" required /></Field>
          <Field label="Müşteri soyadı"><input value={header.last_name} onChange={(event) => updateHeader("last_name", event.target.value)} autoComplete="family-name" maxLength={100} placeholder="Soyad" required /></Field>
          <Field label="İletişim numarası"><input type="tel" value={header.customer_phone} onChange={(event) => updateHeader("customer_phone", event.target.value)} autoComplete="tel" maxLength={30} placeholder="05xx xxx xx xx" /></Field>
          <Field label="Teslim tarihi"><input type="date" value={header.delivery_date} onChange={(event) => updateHeader("delivery_date", event.target.value)} required /></Field>
          <Field label="Ölçüyü kim aldı?" full><select value={header.measurement_source || "unspecified"} onChange={(event) => updateHeader("measurement_source", event.target.value)}><option value="unspecified">Belirtilmedi</option><option value="customer">Müşteri ölçüsü</option><option value="team">Ekibimiz ölçtü</option></select></Field>
          <Field label="Ölçü durumu" full><select value={header.measurement_status || "preliminary"} onChange={(event) => updateHeader("measurement_status", event.target.value)}><option value="preliminary">Ön ölçü · yerinde teyit bekleniyor</option>{header.measurement_status === "scheduled" && <option value="scheduled" disabled>Ölçü randevusu planlandı</option>}<option value="confirmed">Ölçü teyit edildi</option></select><p className="muted">Ön ölçüyle de sipariş alabilirsiniz. Sonradan Ölçü alınacak ekranından yeni ölçüleri ve ölçüyü alan kişiyi kaydedin.</p></Field>
          <Field label="Adres" full><textarea value={header.customer_address} onChange={(event) => updateHeader("customer_address", event.target.value)} autoComplete="street-address" maxLength={600} placeholder="Montaj / teslim adresi" /></Field>
        </div><p className="choice-label">Teslim şekli</p><div className="row"><button className="chip" aria-pressed={header.delivery_method === "magaza"} onClick={() => updateHeader("delivery_method", "magaza")}>Mağaza teslimi</button><button className="chip" aria-pressed={header.delivery_method === "montaj"} onClick={() => updateHeader("delivery_method", "montaj")}>Montaj</button></div>
          <div className="fields divider"><NumberField label="İskonto oranı (%)" min={0} step="any" value={agreedPrice ? discountPercentInput(discount) : discount} onChange={(value) => { setAgreedPrice(null); setDiscount(value); dirty(); }} /><Field label="Anlaşılan toplam tutar (₺)"><input type="number" inputMode="decimal" min={recordedFee} step="0.01" value={agreedPriceActive ? agreedPrice.value : totals.error ? "" : totals.total} onChange={(event) => changeAgreedPrice(event.target.value)} /><p className="muted">Tutar girince iskonto otomatik hesaplanır. Oran yaklaşık gösterilse de girilen toplam tutar korunur.</p></Field><Field label="Kalan ödeme yöntemi"><select value={header.payment_method} onChange={(event) => updateHeader("payment_method", event.target.value)}><option>Nakit</option><option>Kredi Kartı</option><option>Havale / EFT</option><option>Mail Order</option><option>Parçalı / Karma</option><option>Belirlenmedi</option></select><p className="muted">Bu seçim ödeme planıdır; tahsilat kaydı oluşturmaz.</p></Field><Field label="Kalan ödeme zamanı"><select value={header.balance_payment_due || "Belirlenmedi"} onChange={(event) => updateHeader("balance_payment_due", event.target.value)}><option>İş tesliminde</option><option>Peşin / Şimdi</option><option>Belirlenmedi</option><option>Manuel açıklama</option></select></Field><Field label="Ödeme planı açıklaması" full><textarea value={header.payment_plan_note || ""} onChange={(event) => updateHeader("payment_plan_note", event.target.value)} maxLength={1000} placeholder="Örn. kalan 15.000 TL iş tesliminde: 10.000 TL mail order, 5.000 TL nakit" /></Field><Field label="Sipariş notu" full><textarea value={header.sale_note} maxLength={1000} onChange={(event) => updateHeader("sale_note", event.target.value)} placeholder="Müşteri / imalat için sipariş notu" /></Field></div>
        </fieldset>
          <div className="price-box"><div className="total-row"><span>{totals.discountPercent > 0 ? "İskonto öncesi toplam" : "Ara toplam"}</span><strong>{formatMoney(totals.subtotal)}</strong></div><div className="total-row"><span>İskonto ({discountLabel(totals.discountPercent)})</span><strong>− {formatMoney(totals.discountAmount)}</strong></div>{recordedFee > 0 && <div className="total-row"><span>Kayıtlı ödeme farkı</span><strong>{formatMoney(recordedFee)}</strong></div>}<div className="total-row grand-total"><span>Sipariş bedeli</span><span>{formatMoney(totals.total)}</span></div>{totals.error && <p className="error" role="alert">{totals.error}</p>}</div>
          <fieldset className="review-card" disabled={processing || locked}>
            <h3>Döviz ödeme karşılığı</h3>
            <Field label="Ödeme para birimi"><select value={header.payment_currency || "TRY"} onChange={(event) => selectPaymentCurrency(event.target.value)}><option value="TRY">Türk lirası · TRY</option><option value="EUR">Euro · EUR</option><option value="USD">ABD doları · USD</option></select></Field>
            {header.payment_currency && header.payment_currency !== "TRY" && <>
              <p className="choice-label">{paymentSaved ? "Siparişte kayıtlı ödeme kuru" : header.payment_rate_mode === "manual" ? "Elle girilen ödeme kuru" : "Harem · Döviz alış kuru"}</p>
              <div className="row" role="group" aria-label="Ödeme kuru seçimi"><button type="button" className="chip" aria-pressed={!paymentSaved && header.payment_rate_mode === "automatic"} disabled={paymentLoading} onClick={applyPaymentRate}>{paymentSaved ? "Güncel ödeme kurunu uygula" : "Otomatik ödeme kuru"}</button><button type="button" className="chip" aria-pressed={!paymentSaved && header.payment_rate_mode === "manual"} onClick={useManualPaymentRate}>Ödeme kurunu elle gir</button><button type="button" disabled={paymentLoading} onClick={refreshPaymentRates}>{paymentLoading ? <Loader2 className="spin" size={16} /> : null}Ödeme kurunu yenile</button></div>
              <Field label={`${header.payment_currency} / TL ödeme kuru`}><input type="number" inputMode="decimal" min="0.0001" step="any" value={header.payment_currency_rate || ""} readOnly={paymentSaved || header.payment_rate_mode === "automatic"} onChange={(event) => { setHeader((previous) => ({ ...previous, ...manualPaymentFields, payment_currency_rate: event.target.value })); dirty(); }} /></Field>
              {header.payment_rate_source === "Harem" && header.payment_rate_quoted_at && <p className="muted">Harem · Alış · {new Date(header.payment_rate_quoted_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>}
              {paymentLoading && <p className="muted" role="status">Harem alış kuru yükleniyor…</p>}
              {paymentError && <p className="error" role="alert">{paymentError} Yeniden deneyin veya ödeme kurunu elle girin.</p>}
              {!paymentLoading && paymentCalculation.error && <p className="error">{paymentCalculation.error}</p>}
              {paymentCalculation.value && <div className="price-box" aria-live="polite"><p>1 {paymentCalculation.value.currency} = {formatExchangeRate(paymentCalculation.value.rate)} ₺</p><p>{formatMoney(totals.total)} ÷ {formatExchangeRate(paymentCalculation.value.rate)}</p><p className="big">{formatMoney(paymentCalculation.value.amount, paymentCalculation.value.currency)}</p></div>}
              <p className="muted">TL sipariş toplamı değişmez. Bu tutar döviz ödeme karşılığıdır; tahsilat kaydı oluşturmaz. Seçilen ödeme kuru kaydedilir, yenileme tutarı kendiliğinden değiştirmez.</p>
            </>}
          </fieldset>
        </section>
      </div>
      {reviewed && <div className="review-card" role="status"><strong>{header.first_name} {header.last_name}</strong> · İletişim: {header.customer_phone || "Belirtilmedi"} · Teslim: {header.delivery_date} · {header.delivery_method === "montaj" ? "Montaj" : "Mağaza teslimi"}<p>{cart.length} ürün kalemi / {rooms.length} oda · İskonto {discountLabel(totals.discountPercent)} ({formatMoney(totals.discountAmount)}) · Ödenecek {formatMoney(totals.total)}</p></div>}
      <div className="actions divider">
        <button disabled={!cart.length || processing || locked} onClick={() => { if (validateHeader()) setReviewed(true); }}><ClipboardList size={18} />Siparişi gözden geçir</button>
        <button disabled={!cart.length || processing || locked} onClick={() => saveOrder("beklemede")}>{processing ? <Loader2 className="spin" size={18} /> : null}Beklemede</button>
        <button className="primary" disabled={!cart.length || processing || locked} onClick={() => saveOrder("tamamlandi")}>{processing ? <Loader2 className="spin" size={18} /> : <CheckCircle size={18} />}Siparişi onayla</button>
      </div>
      {savedSale && <PaymentPanel key={savedSale._id} sale={savedSale} onUpdate={acceptPaymentSale} />}
      <div className="actions divider">{savedSale && !cancelled && !delivered && <button className="primary" disabled={processing} onClick={() => navigate(`/dashboard/sales/${savedSale._id}/measurements`)}><ClipboardList size={18} />{savedSale.measurement_status === "confirmed" ? "Ölçü bilgileri" : "Ölçü alınacak"}</button>}<button disabled={!approved || processing} onClick={() => printOrder("customer")}><Printer size={18} />Müşteri sipariş kağıdı · A4 / PDF</button><button disabled={!approved || processing || !hasManufacturingItems(cart)} onClick={() => printOrder("manufacturing")}><Printer size={18} />Atölye takip formu · A4 / PDF</button>{locked && <button onClick={newOrder}><Plus size={18} />Yeni sipariş</button>}</div>
      {!locked && <p className="muted" style={{ marginTop: 12 }}>İmalat ve müşteri çıktıları, sipariş onaylanıp kaydedildikten sonra açılır.</p>}
    </div>}

    {productPicker && <div className="modal-backdrop"><section className="modal modal-measurements" role="dialog" aria-modal="true" aria-label="Oda ve ürün seçimi">
      <div className="modal-heading"><h2>Oda ve ürün seçimi</h2><button type="button" className="modal-close" aria-label="Ürün seçimini kapat" onClick={closeProductPicker}><X size={23} /></button></div>
      <p className="muted">Odayı ve ürünü kendiniz seçin. Siparişe eklenmiş kalemler korunur. Farklı ürün seçince yeni ürünün ölçülerini girin.</p>
      <div role="group" aria-label="Yeni ürünün odası" className="pos-room-options">{roomOptions.map(room => <button key={room} type="button" className="chip" aria-pressed={pickerRoom === room} disabled={locked || processing} onClick={() => setPickerRoom(room)}>{room}</button>)}</div>
      <Field label="Yeni ürün için oda / bölüm adı"><input value={pickerRoom} maxLength={100} onChange={event => setPickerRoom(event.target.value)} placeholder="Oda seçin veya örn. Çocuk Odası 2 yazın" /></Field>
      <div className="divider">{productSelectionContents}</div>
      <div className="actions divider"><button type="button" onClick={closeProductPicker}>{selected ? "Ölçü ekranına dön" : "Vazgeç"}</button><button type="button" onClick={() => { closeProductPicker(); closeProduct(); setTab("products"); }}>POS ürün listesine dön</button></div>
    </section></div>}
    {!productPicker && selected && measurement && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeProduct(); }}><section className={`modal${batchActive || motorEnabled ? " modal-measurements" : ""}`} role="dialog" aria-modal="true" aria-labelledby="pos-product-heading">
      <div className="modal-heading"><div><h2 id="pos-product-heading">{selected.product_name}</h2><p className="muted">{selected.product_brand?.brand_name} · Adım {wizardStep} / 2: {wizardStep === 1 ? "Oda, cephe ve pencere" : "Ölçü ve fiyat"}</p></div><button className="modal-close" aria-label="Ürün penceresini kapat" onClick={closeProduct}><X size={23} /></button></div>
      {!editId && !editDualPair && !editMotorPair && <div className="actions" style={{ marginBottom: 12 }}><button type="button" disabled={locked || processing} onClick={openProductPicker}><Package size={17} />Ürün seçimi</button><span className="muted">İstersen bu oda / cephe için farklı ürün seçebilirsin.</span></div>}
      {wizardStep === 1 ? <>
        <h3 className="choice-label">Oda / bölüm seçin</h3>
        <div role="group" aria-label="Oda seçenekleri" className="pos-room-options">
          {roomOptions.map((room) => <button key={room} type="button" className="chip min-w-0 w-full break-words" aria-pressed={measurement.room_name === room} disabled={locked || processing} onClick={() => updateMeasurement("room_name", room)}>{room}</button>)}
        </div>
        <div className="fields divider"><Field label="Oda / bölüm adı"><input value={measurement.room_name} onChange={(event) => updateMeasurement("room_name", event.target.value)} placeholder="Oda seçin veya kendi oda adınızı yazın" maxLength={100} aria-describedby="pos-room-name-hint" disabled={locked || processing} /></Field><Field label="Bölüm / cam adı (isteğe bağlı)"><input value={measurement.area} maxLength={100} onChange={(event) => updateMeasurement("area", event.target.value)} placeholder="Örn. balkon kapısı" /></Field></div>
        <p id="pos-room-name-hint" className="muted">İstediğiniz kadar oda ekleyebilirsiniz. Örn. Yatak Odası 2, Çocuk Odası 2. Eklediğiniz oda adları sonraki ürünlerde tekrar seçilebilir.</p>
        <p className="choice-label">Hangi cephe? <span className="muted">İsteğe bağlı</span></p><div className="row">{FACADES.map((facade) => <button key={facade} className="chip" aria-pressed={measurement.facade === facade} onClick={() => updateMeasurement("facade", measurement.facade === facade ? "" : facade)}>{facade}</button>)}</div><p className="choice-label">Hangi pencere? <span className="muted">İsteğe bağlı</span></p><div className="row">{WINDOWS.map((windowName) => <button key={windowName} className="chip" aria-pressed={measurement.window_name === windowName} onClick={() => updateMeasurement("window_name", measurement.window_name === windowName ? "" : windowName)}>{windowName}</button>)}</div><p className="muted divider">Her camı ayrı bölüm olarak ekleyebilirsiniz. Ölçü adımındaki “Ekle ve yeni cephe aç” ile aynı ürünü bu odanın diğer camlarına ekleyin. Her oda için kullanılabilir.</p><div className="actions divider"><button onClick={closeProduct}>İptal</button><button className="primary" onClick={() => { if (!measurement.room_name.trim()) toast.error("Oda / bölüm adını girin."); else setWizardStep(2); }}>İleri<ArrowRight size={18} /></button></div>
      </> : <>
        {motorAvailable && <div className="review-card"><h3>Kullanım şekli</h3><div role="group" aria-label="Kullanım şekli" className="row"><button type="button" className="chip" aria-pressed={!motorEnabled} onClick={() => changeMotorMode(false)}>Manuel</button><button type="button" className="chip" aria-pressed={motorEnabled} disabled={motorCatalogLoading || Boolean(motorCatalogError)} onClick={() => changeMotorMode(true)}>Motorlu</button></div><p className="muted">{motorEnabled ? "Her perde parçasına bir motor eklenir. Manuel mekanizma ve redüktör farkları uygulanmaz." : "Motorlu seçerseniz ölçüye uygun motorları aşağıdan seçebilirsiniz."}</p>{motorCatalogLoading && <p className="muted">Motor ve mekanizma listesi yükleniyor…</p>}{motorCatalogError && <p className="error">{motorCatalogError} <button type="button" onClick={() => setMotorCatalogRefresh((value) => value + 1)}>Yeniden dene</button></p>}</div>}
        {dualRole && <div className="review-card"><label className="check"><input type="checkbox" checked={dualActive} disabled={Boolean(editDualPair)} onChange={toggleDual} />Çiftli sisteme çevir · tül + güneşlik</label>{dualActive && <><p className="muted">İlk ürün: {selected.product_name} · {primaryRoleLabel}. İkinci kumaşı aşağıdan seçin. En ve boy bir kez girilir, iki kumaşa da uygulanır. Her kumaş kendi fiyatı ve minimum 1 m² kuralıyla hesaplanır.</p><Field label={`İkinci kumaş · ${secondaryRoleLabel}`}><select value={secondaryProduct?._id || ""} disabled={dualLoading || Boolean(editDualPair)} onChange={(event) => setSecondaryProduct(dualProducts.find((product) => product._id === event.target.value) || null)}><option value="">{dualLoading ? "Ürünler yükleniyor…" : "Seri seçin"}</option>{[...dualProducts, ...(secondaryProduct && !dualProducts.some((product) => product._id === secondaryProduct._id) ? [secondaryProduct] : [])].map((product) => <option key={product._id} value={product._id}>{product.product_name} · {formatMoney(product.sale_price)} / m²</option>)}</select></Field>{dualError && <p className="error">{dualError} <button type="button" onClick={() => setDualRefresh((value) => value + 1)}>Yeniden dene</button></p>}<p className="muted">Aynı cam için tek en, tek boy ve kasa rengi seçilir. İki kumaşın renk / VR seçimleri ayrıdır. Ek çiftli mekanizma ücreti uygulanmaz.</p></>}</div>}
        {batchAvailable && !dualActive && <div className="row" role="group" aria-label="Ölçü giriş şekli"><button type="button" className="chip" aria-pressed={batchEnabled} onClick={() => setBatchEnabled(true)}>Çoklu ölçü listesi</button><button type="button" className="chip" aria-pressed={!batchEnabled} onClick={() => setBatchEnabled(false)}>Tek ölçü</button></div>}
        <div className="fields"><Field label={dualActive ? `${primaryRoleLabel} · ortak renk / VR (isteğe bağlı)` : panelBuilderActive || batchActive ? "Ortak renk / VR numarası (isteğe bağlı)" : "Renk / VR numarası"} full><input list="pos-variant-list" value={measurement.variant} maxLength={150} onChange={(event) => updateMeasurement("variant", event.target.value)} placeholder="Renk / VR seçin veya yazın" /><datalist id="pos-variant-list">{(selected.variants || []).map((variant, index) => { const label = typeof variant === "string" ? variant : [variant.vr || variant.vr_number || variant.variant_code || variant.code, variant.color || variant.color_name].filter(Boolean).join(" · "); return <option key={index} value={label} />; })}</datalist></Field>
          {dualActive && <Field label={`${secondaryRoleLabel} · ortak renk / VR (isteğe bağlı)`} full><input list="pos-secondary-variant-list" value={measurement.secondary_variant || ""} maxLength={150} onChange={(event) => updateMeasurement("secondary_variant", event.target.value)} placeholder="İkinci kumaşın renk / VR’si" /><datalist id="pos-secondary-variant-list">{(secondaryProduct?.variants || []).map((variant, index) => <option key={index} value={typeof variant === "string" ? variant : [variant.vr || variant.vr_number || variant.variant_code || variant.code, variant.color || variant.color_name].filter(Boolean).join(" · ")} />)}</datalist></Field>}
          {mode === "fon" && <Field label="Satış şekli"><select value={measurement.order_mode} onChange={(event) => updateMeasurement("order_mode", event.target.value)}><option value="takim">Takım · 2 kanat</option><option value="adet">Adet · tek kanat</option></select></Field>}
          {!batchActive && caseColors.length > 0 && <Field label="Kasa rengi"><select value={selectedCaseColors.length === 1 ? selectedCaseColors[0].option_name : ""} onChange={(event) => setMeasurement((previous) => ({ ...previous, extra_indices: selectCaseColorIndices(selected, previous.extra_indices, event.target.value) }))}><option value="">Seçilmedi</option>{caseColors.map((choice) => <option key={choice.option_name} value={choice.option_name}>{choice.label}</option>)}</select></Field>}
          {!batchActive && <NumberField label={panelBuilderActive ? "Bu ölçü grubundan kaç adet?" : mode === "textile" ? "Parça sayısı" : (mode === "fon" && measurement.order_mode === "takim") || selected.supplier_unit === "Takım" ? "Takım adedi" : "Adet sayısı"} value={measurement.count} onChange={(value) => updateMeasurement("count", value)} min={1} step={1} />}
          {!panelBuilderActive && !batchActive && <><NumberField label={mode === "fon" ? (measurement.order_mode === "takim" ? "Sol kanat eni (cm)" : "Kanat eni (cm)") : mode === "textile" ? "Toplam cephe / bitmiş en (cm)" : "En (cm)"} value={measurement.width} onChange={(value) => updateMeasurement("width", value)} min={selected.calculation_type === "adet" ? 0 : 1} readOnly={Boolean(selected.fixed_dimensions?.width_cm) && !hasRusticSizePrices(selected)} />
          {!widthOnly && <NumberField label={mode === "fon" && measurement.order_mode === "takim" ? "Sol kanat boyu (cm)" : "Boy (cm)"} value={measurement.height} onChange={(value) => updateMeasurement("height", value)} min={selected.calculation_type === "m2" || mode === "fon" || mode === "textile" ? 1 : 0} />}</>}
          {(mode === "textile" || mode === "fon") && <><Field label="Pile türü"><select value={measurement.pleat_id} onChange={(event) => updateMeasurement("pleat_id", event.target.value)}>{PLEATS.map((pleat) => <option key={pleat.id} value={pleat.id}>{pleat.name} · 1'e {pleat.factor}</option>)}</select></Field><NumberField label="Giden kumaşın metre işçiliği (₺ / m)" value={measurement.labor_price} onChange={(value) => updateMeasurement("labor_price", value)} /></>}
          {currency !== "TRY" && <div className="full review-card">
            <p><strong>{fxSaved ? "Siparişte kayıtlı kur" : "Döviz kuru seçimi"}</strong></p>
            <div className="row" role="group" aria-label="Döviz kuru seçimi"><button type="button" className="chip" aria-pressed={!fxSaved && measurement.currency_rate_mode === "automatic"} disabled={locked || processing || fxLoading || !["USD", "EUR"].includes(currency)} onClick={applyAutomaticRate}>{fxSaved ? "Güncel kuru uygula" : "Otomatik kur"}</button><button type="button" className="chip" aria-pressed={!fxSaved && measurement.currency_rate_mode === "manual"} disabled={locked || processing} onClick={useManualRate}>Elle kur gir</button></div>
            <Field label={`${currency} / TL kuru`}><input type="number" inputMode="decimal" step="any" min="0.0001" value={measurement.currency_rate} readOnly={fxSaved || measurement.currency_rate_mode === "automatic"} disabled={locked || processing} onChange={(event) => setMeasurement((previous) => ({ ...previous, ...manualRateFields, currency_rate: event.target.value }))} /></Field>
            {measurement.currency_rate_source === "TCMB" && measurement.currency_rate_date && <p className="muted">TCMB · Döviz satış · {formatRateDate(measurement.currency_rate_date)}</p>}
            {fxSaved && <p className="muted">Kaydedilmiş kur korunur. Yeni kuru kullanmak için Güncel kuru uygula düğmesine basın.</p>}
            {!fxSaved && measurement.currency_rate_mode === "automatic" && !measurement.currency_rate && <p className={fxError ? "error" : "muted"}>{fxLoading ? "Günlük kur yükleniyor…" : "Otomatik kur kullanılamıyor. Kuru yeniden deneyin veya elle girin."}</p>}
            {!fxSaved && measurement.currency_rate_mode === "automatic" && Boolean(measurement.currency_rate) && <p className="muted">Bu ürünün seçili kuru korunur. Güncellemek için Otomatik kur düğmesine basın.</p>}
            {(fxError || !fxQuote) && <button type="button" disabled={fxLoading || locked || processing} onClick={refreshRates}>{fxLoading ? <Loader2 className="spin" size={16} /> : null}Kuru yeniden dene</button>}
          </div>}
        </div>
        {batchActive && <fieldset className="divider" disabled={locked || processing}>
          {legacyDualHeights && <p className="notice">Bu eski kayıtta iki farklı boy vardı: {formatNumber(legacyDualHeights.tul)} ve {formatNumber(legacyDualHeights.guneslik)} cm. Yeni ortak boyu Boy alanına girin; iki ürün birlikte yeniden hesaplanacak.</p>}
          <h3>{widthOnly ? "En ölçü listesi" : dualActive ? "Çiftli cam ölçü listesi" : "Cam ölçü listesi"}</h3><p className="muted">{widthOnly ? "Her satıra en, adet ve renk / VR girin. Boy ölçüsü kullanılmaz. Her ölçünün minimum ve yuvarlama kuralları ayrı uygulanır." : dualActive ? "Her camın enini ve boyunu bir kez girin. Aynı ölçü iki kumaşa uygulanır; her ürünün minimumu 1 m²’dir. Adet, çiftli sistem sayısıdır." : "Her camın enini ve boyunu ayrı girin. Aynı ölçüden birden fazlaysa Adet alanını kullanın. Her satırın minimum m² ve yuvarlama hesabı ayrı yapılır."}</p>
          {!editDualPair && <div className="row"><NumberField label="Toplam ölçü satırı" value={batchTarget} min={1} step={1} onChange={setBatchTarget} /><button type="button" onClick={prepareBatchRows}>Satırları hazırla</button></div>}
          <div className="measure-list" role="region" aria-label={widthOnly ? "En ölçüleri" : "Cam ölçüleri"} tabIndex={0}>
            <table><thead><tr><th>{widthOnly ? "Bölüm / ölçü" : "Cam / bölüm"}</th><th>En (cm)</th>{!widthOnly && <th>Boy (cm)</th>}<th>Adet</th><th>{dualActive ? `${primaryRoleLabel} VR` : "Renk / VR"}</th>{dualActive && <th>{secondaryRoleLabel} VR</th>}{!widthOnly && <th>Kasa rengi</th>}<th>Hesap</th><th>İşlem</th></tr></thead><tbody>
              {batchRows.map((row, index) => <tr key={row.key}>
                <td><input aria-label={`${index + 1}. cam adı`} value={row.label} maxLength={100} placeholder={`${widthOnly ? "Ölçü" : "Cam"} ${index + 1}`} onChange={(event) => updateBatchRow(row.key, "label", event.target.value)} /></td>
                <td><input type="number" inputMode="decimal" min="0.01" step="any" aria-label={`${index + 1}. cam eni (cm)`} value={row.width} onChange={(event) => updateBatchRow(row.key, "width", event.target.value)} /></td>
                {!widthOnly && <td><input type="number" inputMode="decimal" min="0.01" step="any" aria-label={`${index + 1}. cam boyu (cm)`} value={row.height} onChange={(event) => updateBatchRow(row.key, "height", event.target.value)} /></td>}
                <td><input type="number" inputMode="numeric" min="1" step="1" aria-label={`${index + 1}. cam adedi`} value={row.count} onChange={(event) => updateBatchRow(row.key, "count", event.target.value)} /></td>
                <td><input list="pos-variant-list" aria-label={`${index + 1}. cam renk / VR`} value={row.variant} maxLength={150} placeholder={measurement.variant || "Ortak renk"} onChange={(event) => updateBatchRow(row.key, "variant", event.target.value)} /></td>
                {dualActive && <td><input list="pos-secondary-variant-list" aria-label={`${index + 1}. cam ikinci kumaş renk / VR`} value={row.secondary_variant || ""} maxLength={150} placeholder={measurement.secondary_variant || "İkinci renk"} onChange={(event) => updateBatchRow(row.key, "secondary_variant", event.target.value)} /></td>}
                {!widthOnly && <td><select aria-label={`${index + 1}. cam kasa rengi`} value={dualActive ? (row.case_color || "").split(":").at(-1).trim() : row.case_color || ""} disabled={dualActive ? !dualCaseColors.length : !caseColors.length} onChange={(event) => updateBatchRow(row.key, "case_color", event.target.value)}><option value="">Seçilmedi</option>{(dualActive ? dualCaseColors : caseColors).map((choice) => <option key={choice.option_name} value={dualActive ? choice.label : choice.option_name}>{choice.label}{!dualActive && selected.extra_options[choice.index].price_impact > 0 ? ` · ${formatMoney(selected.extra_options[choice.index].price_impact, selected.extra_options[choice.index].currency || currency)} / ${accessoryUnit(selected.extra_options[choice.index], selected)}` : ""}</option>)}</select></td>}
                <td>{batchPreviews[index] ? <><strong>{formatMoney(batchPreviews[index].item_total)}</strong><p className="muted">{dualActive ? `Tül ${formatNumber(batchPreviews[index].tul.quantity)} + güneşlik ${formatNumber(batchPreviews[index].guneslik.quantity)} m²` : `${formatNumber(batchPreviews[index].quantity)} ${batchPreviews[index].unit_label} × ${formatMoney(batchPreviews[index].base_unit_price)}`}</p></> : "—"}</td>
                <td><div className="row"><button type="button" aria-label={`${index + 1}. ölçüyü kopyala`} title="Kopyala" disabled={Boolean(editDualPair)} onClick={() => appendBatchRow(row, index)}><Copy size={17} /></button><button type="button" className="button-danger" aria-label={`${index + 1}. ölçüyü kaldır`} title="Kaldır" disabled={batchRows.length <= 1} onClick={() => setBatchRows((previous) => previous.filter((item) => item.key !== row.key))}><Trash2 size={17} /></button></div></td>
              </tr>)}
            </tbody></table>
          </div>
          {!editDualPair && <button type="button" onClick={() => appendBatchRow()}><Plus size={18} />Ölçü satırı ekle</button>}
          <p className="muted">{widthOnly ? "Her satırın eni, adedi ve renk / VR bilgisi ayrı kaydedilir. Satırdaki renk / VR boşsa ortak renk kullanılır. Mekanik ürünler atölye formuna eklenmez." : dualActive ? "Her satır aynı camdaki tül ve güneşliği birlikte oluşturur. İki kumaşın birim fiyatları ayrı uygulanıp toplanır. Kasa rengi her camda ayrı seçilir." : "Oda, cephe, ortak renk / VR ve aşağıdaki aksesuarlar tüm satırlara uygulanır. Kasa rengi her satırda ayrı seçilir. Satırdaki renk / VR doluysa o renk kullanılır. Her satır siparişte ve müşteri sipariş kağıdında ayrı görünür."}</p>
        </fieldset>}
        {selected.fixed_dimensions?.width_cm > 0 && !hasRusticSizePrices(selected) && <p className="muted">Bu ürünün eni sabittir. Farklı en için uygun ölçüdeki ürünü seçin.</p>}
        {hasRusticSizePrices(selected) && <section className="notice" aria-label="Rustik ölçü fiyat listesi"><h3>Ölçüye göre takım fiyatı</h3><p>Eni serbest girin. 100 cm altı 100 cm, ara ölçüler bir üst liste ölçüsünün fiyatıyla hesaplanır. Boy ölçüsü kullanılmaz.</p><div className="row">{selected.rustic_size_prices.map((size) => <span key={size.width_cm} style={{ padding: "8px 10px", borderRadius: 8, background: calculation?.line?.billable_width === size.width_cm ? "#e0c7a3" : "#fffdf8", fontWeight: calculation?.line?.billable_width === size.width_cm ? 750 : 400 }}>{formatNumber(size.width_cm, 0)} cm: {formatMoney(size.sale_price, selected.currency || "TRY")} / takım</span>)}</div></section>}
        {isRusticProduct(selected) && selected.calculation_type === "mt" && <p className="muted">Metre fiyatı: {formatMoney(selected.sale_price, selected.currency || "TRY")} / m · Minimum hesap eni 100 cm. Boy kullanılmaz.</p>}
        {selected.technical_limits && <p className="muted">Sistem sınırları: {[["min_width_cm", "En en az", "cm"], ["max_width_cm", "En en çok", "cm"], ["min_height_cm", "Boy en az", "cm"], ["max_height_cm", "Boy en çok", "cm"], ["max_m2", "Alan en çok", "m²"], ["max_load_kg", "Yük en çok", "kg"], ["tube_diameter_mm", "Boru çapı", "mm"], ["slat_width_mm", "Lamel eni", "mm"]].filter(([key]) => selected.technical_limits[key] > 0).map(([key, label, unit]) => `${label} ${formatNumber(selected.technical_limits[key])} ${unit}`).join(" · ")}. Ölçü girildiğinde ölçü sınırları kontrol edilir; ağırlık ve donanım uyumunu ayrıca kontrol edin.</p>}
        {panelBuilderActive && <fieldset className="divider" disabled={locked || processing}>
          <h3>Kasa ve parçalar</h3><div role="group" aria-label="Kasa seçimi" className="row" style={{ marginTop: 12 }}><button type="button" className="chip" aria-pressed={measurement.case_mode === "ayri"} onClick={() => updateMeasurement("case_mode", "ayri")}>Her parça ayrı kasada</button><button type="button" className="chip" aria-pressed={measurement.case_mode === "ortak"} onClick={() => updateMeasurement("case_mode", "ortak")}>Tüm parçalar tek kasada</button></div>
          {measurement.case_mode === "ortak" && <div className="fields divider"><NumberField label="Kasa / profil eni (cm, isteğe bağlı)" value={measurement.profile_width_cm || ""} min={0} onChange={(value) => updateMeasurement("profile_width_cm", value)} /><p className="muted full">{foldingBuilder ? "Kasa / profil eni yalnız bilgi içindir. Her parçanın mekanizma eni ayrı hesaplanır." : "Yalnız imalat bilgisi; kasa fiyatı parçaların gerçek enleri toplamından hesaplanır."}</p></div>}
          <p className="muted">Her parçanın enini, boyunu{directionRequired ? " ve yönünü" : ""} girin. Parçaları soldan sağa ekleyin; Sol / Orta / Sağ konumu otomatik belirlenir. Renk / VR isteğe bağlıdır. Ortak renk / VR girilmişse boş bırakılan parçalara uygulanır. Özel konum adlarını Bölüm / cam adı alanına yazabilirsiniz.</p>
          {measurement.mechanical_panels.map((panel, index) => <section className="review-card" key={index} aria-label={`${index + 1}. mekanik parça`}><div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><h3>{mechanicalPartTitle(panel, index, measurement.mechanical_panels.length, measurement.case_mode)}</h3><button type="button" className="button-danger" aria-label={`${index + 1}. parçayı kaldır`} disabled={measurement.mechanical_panels.length <= 1} onClick={() => removeMechanicalPanel(index)}><Trash2 size={16} />Kaldır</button></div><div className="fields"><NumberField label={`${index + 1}. parça eni (cm)`} value={panel.width} min={1} onChange={(value) => updateMechanicalPanel(index, "width", value)} /><NumberField label={`${index + 1}. parça boyu (cm)`} value={panel.height} min={1} onChange={(value) => updateMechanicalPanel(index, "height", value)} /><Field label={measurement.case_mode === "ayri" ? "Kasa konumu" : "Parça konumu"}><select aria-label={`${index + 1}. ${measurement.case_mode === "ayri" ? "kasa" : "parça"} konumu`} value={panel.position_override || ""} onChange={(event) => updateMechanicalPanel(index, "position_override", event.target.value)}><option value="">Otomatik ({mechanicalPanelPosition(index, measurement.mechanical_panels.length).replace(/^Tek parça$/, "Tek")})</option><option value="Sol">Sol</option><option value="Orta">Orta</option><option value="Sağ">Sağ</option></select></Field><Field label={`${index + 1}. parça renk / VR numarası (isteğe bağlı)`} full><input list="pos-variant-list" value={panel.variant} maxLength={150} placeholder={measurement.variant || "Renk / VR yazın"} onChange={(event) => updateMechanicalPanel(index, "variant", event.target.value)} /></Field></div>{directionRequired && <><p className="choice-label">{motorEnabled ? "Motor yönü" : "Zincir / ip yönü"}</p><div role="group" aria-label={`${index + 1}. parça ${motorEnabled ? "motor yönü" : "zincir / ip yönü"}`} className="row">{["Sağ", "Sol"].map((direction) => <button key={direction} type="button" className="chip" style={{ minWidth: 120 }} aria-pressed={panel.chain_direction === direction} onClick={() => updateMechanicalPanel(index, "chain_direction", direction)}>{direction}</button>)}</div></>}</section>)}
          <button type="button" onClick={addMechanicalPanel}><Plus size={18} />Parça ekle</button>
        </fieldset>}
        {mode === "fon" && measurement.order_mode === "takim" && <><label className="check"><input type="checkbox" checked={measurement.separate_right} onChange={(event) => updateMeasurement("separate_right", event.target.checked)} />Sağ kanat ölçüsü farklı</label>{measurement.separate_right && <div className="fields"><NumberField label="Sağ kanat eni (cm)" value={measurement.right_width} onChange={(value) => updateMeasurement("right_width", value)} min={1} /><NumberField label="Sağ kanat boyu (cm)" value={measurement.right_height} onChange={(value) => updateMeasurement("right_height", value)} min={1} /></div>}</>}
        {(mode === "textile" || mode === "fon") && <p className="muted">Her kanada / parçaya 40 cm dikiş payı eklenir. Boy ölçüsü sadece imalat içindir; fiyatı değiştirmez.</p>}
        {directionRequired && !panelBuilderActive && <div className="divider"><h3 className="choice-label">{motorEnabled ? "Motor yönü" : "Zincir / ip yönü"}</h3><div role="group" aria-label={motorEnabled ? "Motor yönü" : "Zincir / ip yönü"} className="row">{["Sağ", "Sol"].map((direction) => <button key={direction} type="button" className="chip" style={{ minWidth: 120 }} aria-pressed={measurement.chain_direction === direction} disabled={locked || processing} onClick={() => updateMeasurement("chain_direction", direction)}>{direction}</button>)}</div><p className="muted">{motorEnabled ? "Motorun bulunacağı yönü seçin." : "Ürünün zincir / ip yönünü seçin."}</p></div>}
        {selected.calculation_type === "m2" && <div className="notice" style={{ marginTop: 12 }}><strong>m² hesap kuralları</strong><p>Fiyat, en × boy ve adet üzerinden hesaplanır. İmalat için girdiğiniz ölçüler korunur.</p>{Number(selected.min_width_cm) > 0 && <p>Hesapta minimum en: {formatNumber(selected.min_width_cm)} cm</p>}{Number(selected.min_height_cm) > 0 && <p>Hesapta minimum boy: {formatNumber(selected.min_height_cm)} cm</p>}{Number(selected.dimension_rounding_cm) > 0 && <p>Hesapta en ve boy {formatNumber(selected.dimension_rounding_cm)} cm'lik adımlara yukarı yuvarlanır.</p>}{Number(selected.min_m2) > 0 && <p>Minimum miktar: {formatNumber(selected.min_m2)} m² / adet</p>}{Number(selected.rounding_step) > 0 && <p>m² miktarı {formatNumber(selected.rounding_step)} m² adımına yukarı yuvarlanır.</p>}</div>}
        {currency !== "TRY" && <p className="muted">{hasRusticSizePrices(selected) ? "Takım fiyatı girilen ene göre listeden seçilir." : `Fiyat ${formatMoney(selected.sale_price, currency)} / birim.`} Seçilen kur bu ürün kalemine kaydedilir; sonraki kur yenilemeleri bu tutarı değiştirmez.</p>}
        <FoldingRodOptions product={selected} measurement={measurement} line={calculation?.line} onChange={(value) => setMeasurement((previous) => setFoldingRodCount(selected, previous, value))} />
        <HemAccessories product={selected} measurement={measurement} onModelChange={(value) => setMeasurement((previous) => selectHemAccessory(selected, previous, value))} onColorChange={(name, color) => setMeasurement((previous) => ({ ...previous, accessory_colors: { ...(previous.accessory_colors || {}), [name]: color } }))} />
        {!dualActive && Boolean(accessoryGroups.length) && <div className="divider"><h3>Aksesuar seçenekleri</h3><p className="muted">Eklemek istediğiniz başlığı açın.</p>{accessoryGroups.map((group) => <details key={group.key} className="accessory-group"><summary>{group.label}{measurement.extra_indices.some((index) => group.options.some((entry) => entry.index === index)) ? " · Seçim var" : ""}</summary>{group.options.map(({ option, index }) => <label className="accessory" key={option._id || index}><input type="checkbox" checked={measurement.extra_indices.includes(index)} onChange={(event) => { const indices = event.target.checked ? [...measurement.extra_indices, index] : measurement.extra_indices.filter((item) => item !== index); setMeasurement((previous) => normalizeHemForMechanism(selected, { ...previous, extra_indices: motorAvailable ? sanitizedMechanicalIndices(selected, indices, { motorized: motorEnabled }) : indices })); }} /><span>{option.option_name}<span className="muted"> · {isPercentageOption(option) ? "%" + formatRate(option.price_impact) : formatMoney(option.price_impact, option.currency || currency) + " / " + accessoryUnit(option, selected)}</span></span></label>)}</details>)}</div>}
        {motorEnabled && <MotorOptions product={selected} products={motorCatalog} measurement={measurement} motor={motorProduct} rateForm={motorRateForm} rateSaved={motorFxSaved} loading={motorCatalogLoading} error={motorCatalogError} onRetry={() => setMotorCatalogRefresh((value) => value + 1)} onSelect={selectMotor} onRateChange={(value) => { motorFxContext.current = { ...motorFxContext.current, saved: false, pending: false }; setMotorFxSaved(false); setMotorRateForm((previous) => ({ ...previous, ...manualRateFields, currency_rate: value })); }} onUseAutomatic={useAutomaticMotorRate} onUseManual={useManualMotorRate} fxLoading={fxLoading} />}
        {!dualActive && selected.extra_options?.some((option) => option.pricing_basis === "mt" || option.calculation_type === "mt") && <p className="muted">Metreli aksesuarlar gerçek en üzerinden hesaplanır.</p>}
        <Field label="Ürün / imalat notu" full><textarea maxLength={500} value={measurement.item_note} onChange={(event) => updateMeasurement("item_note", event.target.value)} placeholder="Örn. etek modeli, kasa rengi…" /></Field>
        <div className="price-box" aria-live="polite">{motorEnabled ? (motorCalculation?.value ? <><p>Perde ve aksesuarlar: <strong>{formatMoney(motorCalculation.value.curtain.item_total)}</strong></p><p>{motorCalculation.value.motorCount} motor × {formatMoney(motorCalculation.value.motor.base_unit_price)} = <strong>{formatMoney(motorCalculation.value.motor.item_total)}</strong></p><p className="big">{formatMoney(motorCalculation.value.total)}</p><p className="muted">Motor ve perde birlikte siparişe eklenecek.</p></> : <p className="error">{motorCalculation?.error}</p>) : batchActive ? (batchCalculation?.value ? <><p><strong>{batchRows.length} ölçü satırı · {batchCalculation.value.pieces} adet</strong></p><p>Toplam hesaplanan miktar: <strong>{formatNumber(batchCalculation.value.quantity)} {batchCalculation.value.unit_label || "m²"}</strong></p><p className="big">{formatMoney(batchCalculation.value.total)}</p><p className="muted">{widthOnly ? "Her satırın fiyatı kendi eni ve adedine göre ayrı hesaplandı." : "Her camın fiyatı kendi ölçüsü ve adedine göre ayrı hesaplandı."}</p></> : <p className="error">{batchCalculation?.error}</p>) : calculation?.line ? <><MechanicalDetails line={calculation.line} /><p>{mode === "fon" || mode === "textile" ? "Giden kumaş" : "Hesaplanan miktar"}: <strong>{formatNumber(calculation.line.quantity)} {calculation.line.unit_label}</strong>{mode === "fon" ? ` · ${calculation.line.pieces} kanat` : ""}</p>{hasBillingDimensions(calculation.line) && <p>Hesap ölçüsü: {formatNumber(calculation.line.billable_width)} × {formatNumber(calculation.line.billable_height)} cm</p>}<p>{formatNumber(calculation.line.quantity)} {calculation.line.unit_label} × {formatMoney(calculation.line.base_unit_price)} = {formatMoney(calculation.line.material_total)}</p>{calculation.line.labor_total > 0 && <p>İşçilik: {formatNumber(calculation.line.quantity)} m × {formatMoney(calculation.line.labor_unit_price)} = {formatMoney(calculation.line.labor_total)}</p>}{calculation.line.accessories_total > 0 && <p>Aksesuarlar: {formatMoney(calculation.line.accessories_total)}</p>}<p className="muted">{calculation.line.calculation_note}</p><p className="big">{formatMoney(calculation.line.item_total)}</p></> : <p className="error">{calculation?.error}</p>}</div>
        <div className="actions"><button onClick={() => setWizardStep(1)}><ArrowLeft size={18} />Geri</button>{!editId && !editDualPair && !editMotorPair && <button disabled={(motorEnabled ? !motorCalculation?.value : batchActive ? !batchCalculation?.value : !calculation?.line) || locked || processing} onClick={() => addLine(true)}><Plus size={18} />Ekle ve yeni cephe aç</button>}{!editId && !editDualPair && !editMotorPair && <button disabled={(motorEnabled ? !motorCalculation?.value : batchActive ? !batchCalculation?.value : !calculation?.line) || locked || processing} onClick={() => addLine("room")}><Home size={18} />Ekle ve yeni oda aç</button>}<button className="primary" disabled={(motorEnabled ? !motorCalculation?.value : batchActive ? !batchCalculation?.value : !calculation?.line) || locked || processing} onClick={() => addLine()}><Plus size={18} />{editId || editDualPair || editMotorPair ? "Değişiklikleri kaydet" : batchActive ? "Tüm ölçüleri siparişe ekle" : "Siparişe ekle"}</button></div>
      </>}
    </section></div>}
  </div>;
}
