import { useMemo, useState } from "react";
import { formatMoney, normalizeName } from "../libs/curtainCalculation.js";
import { motorCandidates, motorEligibility, shortMotorName } from "../libs/motorCatalog.js";

const brandOf = (product) => /somfy/.test(normalizeName(product?.product_name)) ? "Somfy" : "OBA";
const currencyOf = (product) => product?.currency || product?.price_currency || "TRY";
const sourceDetails = (product) => {
  const limits = product?.technical_limits || product?.pricing_snapshot?.technical_limits || {};
  return [
    limits.min_width_cm > 0 && `En az ${limits.min_width_cm} cm en`,
    limits.max_width_cm > 0 && `En çok ${limits.max_width_cm} cm en`,
    limits.max_height_cm > 0 && `En çok ${limits.max_height_cm} cm boy`,
    limits.max_m2 > 0 && `En çok ${limits.max_m2} m²`,
    limits.tube_diameter_mm > 0 && `${limits.tube_diameter_mm} mm boru`,
  ].filter(Boolean).join(" · ");
};

export default function MotorOptions({ product, products = [], measurement = {}, motor, rateForm = {}, rateSaved = false, loading = false, error = "", onRetry, onSelect, onRateChange, onUseAutomatic, onUseManual, fxLoading = false }) {
  const [brand, setBrand] = useState("Tümü");
  const [page, setPage] = useState(0);
  const candidates = useMemo(() => motorCandidates(product, products), [product, products]);
  const filtered = candidates.filter((candidate) => brand === "Tümü" || brandOf(candidate) === brand);
  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 6, currentPage * 6 + 6);
  const panels = measurement.mechanical_panels?.length ? measurement.mechanical_panels : [{ width: measurement.width, height: measurement.height }];
  const selectedEligibility = motor ? motorEligibility(product, motor, panels, { extra_indices: measurement.extra_indices || [] }) : null;
  const category = normalizeName(product?.product_category?.category_name || product?.category_name);
  const title = category === "jaluzi" ? "Jaluzi motorları" : category === "zebra" ? "Zebra motorları" : "Stor motorları";
  const currency = currencyOf(motor);
  const automatic = rateForm.currency_rate_mode === "automatic";
  const sourceDate = rateForm.currency_rate_date;
  return <section className="motor-options divider" aria-label="Motor seçimi">
    <style>{`.curtain-pos .motor-options-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.curtain-pos button.motor-option{display:flex;align-items:flex-start;flex-direction:column;text-align:left;gap:7px;padding:15px;min-height:145px;overflow-wrap:anywhere}.curtain-pos button.motor-option[aria-pressed=true]{border:2px solid #80512f;background:#efe0ca;color:#443325}.curtain-pos .motor-option .motor-name{font-size:16px;font-weight:750}.curtain-pos .motor-option .motor-price{font-size:20px;color:#80512f;font-weight:750;margin-top:auto}.curtain-pos .motor-option .motor-reason{font-size:13px;font-weight:500;color:#9e3328}.curtain-pos .motor-selection{margin-top:16px}.curtain-pos .motor-rate{margin-top:15px}@media(max-width:600px){.curtain-pos .motor-options-grid{grid-template-columns:1fr}}`}</style>
    <h3>{title}</h3>
    <p className="muted">Her sayfada en fazla 6 motor gösterilir. Ölçülere uygun motoru seçin; her perde parçasına 1 motor eklenir.</p>
    <div className="row" role="group" aria-label="Motor markası" style={{ marginTop: 12 }}>{["Tümü", "OBA", "Somfy"].map((name) => <button key={name} type="button" className="chip" aria-pressed={brand === name} onClick={() => { setBrand(name); setPage(0); }}>{name}</button>)}</div>
    {loading && <p className="notice" role="status">Motor seçenekleri yükleniyor…</p>}
    {error && <div className="notice"><p className="error" role="alert">{error}</p><button type="button" onClick={onRetry} disabled={loading}>Yeniden dene</button></div>}
    {!loading && !error && !filtered.length && <p className="notice">Bu grupta motor seçeneği bulunamadı.{brand !== "Tümü" ? " Diğer markaları görmek için Tümü seçin." : " Ürün listesini yeniden yükleyin."}</p>}
    <div className="motor-options-grid">{visible.map((candidate) => {
      const eligibility = motorEligibility(product, candidate, panels, { extra_indices: measurement.extra_indices || [] });
      const selected = motor?._id === candidate._id;
      const displayed = selected ? motor : candidate;
      return <button type="button" key={candidate._id} className="motor-option" aria-pressed={selected} disabled={loading || !eligibility.eligible} onClick={() => { if (!selected) onSelect(candidate); }}>
        <span className="muted">{brandOf(candidate)}{selected ? " · Seçildi" : ""}</span>
        <span className="motor-name">{shortMotorName(candidate)}</span>
        <span className="muted">{sourceDetails(candidate)}</span>
        {!eligibility.eligible && <span className="motor-reason">{eligibility.reason}</span>}
        <span className="motor-price">{formatMoney(displayed.sale_price, currencyOf(displayed))} / adet</span>
      </button>;
    })}</div>
    {filtered.length > 0 && <div className="row pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Önceki motorlar</button><span className="muted">{filtered.length} motor · {currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sonraki motorlar</button></div>}
    {!motor && <p className="muted" style={{ marginTop: 14 }}>Motor henüz seçilmedi. Uygun bir modeli seçtikten sonra fiyatı perdeye eklenecek.</p>}
    {motor && <div className="review-card motor-selection">
      <h3>Seçilen motor: {shortMotorName(motor)}</h3>
      <p>{formatMoney(motor.sale_price, currency)} / adet · Her parçaya 1 motor</p>
      {selectedEligibility && !selectedEligibility.eligible && <p className="error" role="alert">{selectedEligibility.reason}</p>}
      {currency !== "TRY" && <div className="motor-rate">
        <div className="row" role="group" aria-label="Motor döviz kuru"><button type="button" className="chip" aria-pressed={automatic} disabled={fxLoading} onClick={onUseAutomatic}>{fxLoading ? "Kur alınıyor…" : rateSaved ? "Güncel kuru uygula" : "Otomatik kur"}</button><button type="button" className="chip" aria-pressed={!automatic} disabled={fxLoading} onClick={onUseManual}>{rateSaved ? "Elle kur uygula" : "Elle kur gir"}</button></div>
        <label style={{ marginTop: 12 }}>Motor kuru · 1 {currency} kaç TL?<input aria-label={`Motor ${currency}/TL kuru`} inputMode="decimal" value={rateForm.currency_rate ?? ""} readOnly={rateSaved || automatic} onChange={(event) => onRateChange(event.target.value)} placeholder="Döviz kuru" /></label>
        <p className="muted">{rateSaved ? "Siparişte kayıtlı motor kuru korunur." : automatic ? `TCMB döviz satış kuru${sourceDate ? ` · ${sourceDate}` : ""}` : "Motor tutarı, girdiğiniz kurla TL olarak hesaplanır."}</p>
      </div>}
    </div>}
  </section>;
}
