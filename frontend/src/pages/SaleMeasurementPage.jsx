import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../libs/axios';
import { openCurtainPrint } from '../libs/curtainPrint';
import { buildMeasurementRevision, measurementFormForLine } from '../../../backend/src/libs/orderMeasurement.js';
const money = value => Number(value || 0).toLocaleString('tr-TR', {
  style: 'currency',
  currency: 'TRY'
});
const number = value => Number(value || 0).toLocaleString('tr-TR', {
  maximumFractionDigits: 4
});
const date = value => value ? new Date(value).toLocaleDateString('tr-TR') : '—';
const dateTime = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
const editable = sale => ['beklemede', 'tamamlandi'].includes(sale?.status);
const revisionOf = sale => Number(sale?.measurement_revision || 0);
const statusLabel = status => ({
  preliminary: 'Ön ölçü',
  scheduled: 'Ölçü planlandı',
  confirmed: 'Ölçü teyit edildi'
})[status] || 'Ön ölçü';
const card = 'rounded-2xl border border-[#decdb7] bg-[#fffdf8] p-5 sm:p-6';
const primary = 'min-h-12 rounded-xl bg-[#80512f] px-5 py-3 font-semibold text-[#fffaf3] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'min-h-12 rounded-xl border border-[#b99a77] bg-[#fffdf8] px-5 py-3 font-semibold text-[#593d29] disabled:cursor-not-allowed disabled:opacity-50';
const input = 'mt-2 w-full rounded-xl border border-[#c8ad8c] px-3 py-3 text-lg text-[#392b22] disabled:opacity-70';
function metadataFor(sale) {
  return {
    measurement_date: sale.measurement_date ? String(sale.measurement_date).slice(0, 10) : '',
    measurement_master: sale.measurement_master || '',
    measurement_note: sale.measurement_note || ''
  };
}
function formsFor(sale) {
  try {
    return (sale?.pos_details?.cart || []).map(measurementFormForLine);
  } catch {
    return [];
  }
}
function comparableMeasurements(value) {
  return JSON.stringify(value, (key, item) => ['width', 'height', 'right_width', 'right_height', 'profile_width_cm'].includes(key) ? Number(String(item ?? 0).replace(',', '.')) : item);
}
function dims(line) {
  if (line.mechanical_panels?.length) {
    const panels = line.mechanical_panels.map((panel, index) => `${panel.position || panel.label || `${index + 1}. parça`}: ${number(panel.width)} × ${number(panel.height)} cm`).join(' · ');
    return panels + (Number(line.profile_width_cm) > 0 ? ` · Profil: ${number(line.profile_width_cm)} cm` : '');
  }
  if (line.mode === 'fon' && line.panels?.length) {
    return line.panels.map(panel => `${panel.label}: ${number(panel.width)} × ${number(panel.height)} cm`).join(' · ');
  }
  return `${number(line.width)} × ${number(line.height)} cm`;
}
function actorLabel(actor) {
  if (!actor) return 'Belirtilmedi';
  if (typeof actor === 'string') return `Kullanıcı #${actor.slice(-8).toUpperCase()}`;
  return actor.user_username || actor.username || (actor._id ? `Kullanıcı #${String(actor._id).slice(-8).toUpperCase()}` : 'Belirtilmedi');
}
function DimensionInputs({
  value,
  onChange,
  widthLabel = 'En (cm)',
  heightLabel = 'Boy (cm)'
}) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <label className="font-semibold">{widthLabel}<input className={input} inputMode="decimal" aria-label={widthLabel} value={value.width ?? ''} onChange={event => onChange('width', event.target.value)} placeholder="Örn. 155" />
    </label>
    <label className="font-semibold">{heightLabel}<input className={input} inputMode="decimal" aria-label={heightLabel} value={value.height ?? ''} onChange={event => onChange('height', event.target.value)} placeholder="Örn. 250" />
    </label>
  </div>;
}
function MeasurementLine({
  line,
  form,
  onChange
}) {
  const location = [line.room_name, line.area, line.facade, line.window_name].filter(Boolean).join(' · ');
  const team = line.mode === 'fon' && line.order_mode === 'takim';
  return <article className={card}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-xl font-bold">{line.product_name}</h3>
        <p className="mt-1 text-[#6f5843]">{[line.brand_name, line.variant ? `Renk / VR: ${line.variant}` : '', line.pleat_name].filter(Boolean).join(' · ')}</p>{location && <p className="mt-2 font-semibold">{location}</p>}</div>
      <div className="text-right">
        <p className="font-semibold">{number(line.quantity)} {line.unit_label} · {money(line.item_total)}</p>
        <p className="mt-1 text-sm text-[#6f5843]">Kayıtlı ölçü: {dims(line)}</p>
      </div>
    </div>
    <p className="my-4 rounded-xl bg-[#f4ecdf] px-4 py-3 text-[#593d29]">{team ? `${number(line.count)} takım · ${number(line.pieces)} kanat` : `${number(line.pieces || line.count)} ${line.mode === 'textile' ? 'parça' : line.mode === 'fon' ? 'kanat' : 'adet'}`} · Ürün {money(line.base_unit_price)} / {line.unit_label}{line.labor_unit_price ? ` · İşçilik ${money(line.labor_unit_price)} / m` : ''}. Birim fiyatlar korunur.</p>
    {form.mechanical_panels?.length ? <div className="space-y-4">
      <p className="font-semibold">{line.case_mode === 'ortak' ? 'Ortak kasa' : 'Ayrı kasalar'} · {line.mechanical_panels.length} parça</p>
      {form.mechanical_panels.map((panel, index) => <section key={index} className="rounded-xl border border-[#decdb7] p-4">
        <h4 className="mb-3 font-bold">{line.mechanical_panels[index].position || line.mechanical_panels[index].label || `${index + 1}. parça`} {line.case_mode === 'ortak' ? 'parça' : 'kasa'}</h4>
        <p className="mb-3 text-sm text-[#6f5843]">Renk / VR: {line.mechanical_panels[index].variant || line.variant || 'Belirtilmedi'} · Zincir / ip yönü: {line.mechanical_panels[index].chain_direction || 'Belirtilmedi'}</p>
        <DimensionInputs value={panel} widthLabel={`${index + 1}. parça eni (cm)`} heightLabel={`${index + 1}. parça boyu (cm)`} onChange={(key, value) => onChange('mechanical_panels', form.mechanical_panels.map((item, position) => position === index ? {
          ...item,
          [key]: value
        } : item))} />
      </section>)}
      {line.case_mode === 'ortak' && <label className="block font-semibold">Fiziksel kasa / profil eni (cm) — isteğe bağlı<input className={input} inputMode="decimal" value={form.profile_width_cm ?? ''} onChange={event => onChange('profile_width_cm', event.target.value)} />
        <span className="mt-2 block text-sm font-normal text-[#6f5843]">İmalat içindir. Kasa farkı parçaların gerçek enleri toplamıyla hesaplanır.</span>
      </label>}
    </div> : <>
      <DimensionInputs value={form} widthLabel={team ? 'Sol kanat eni (cm)' : line.mode === 'textile' ? 'Toplam en (cm)' : 'En (cm)'} heightLabel={team ? 'Sol kanat boyu (cm)' : 'Boy (cm)'} onChange={onChange} />
      {team && <div className="mt-4">
        <DimensionInputs value={{
          width: form.right_width,
          height: form.right_height
        }} widthLabel="Sağ kanat eni (cm)" heightLabel="Sağ kanat boyu (cm)" onChange={(key, value) => onChange(key === 'width' ? 'right_width' : 'right_height', value)} />
      </div>}
      {line.chain_direction && <p className="mt-3 text-[#6f5843]">Zincir / ip yönü: {line.chain_direction}</p>}
    </>}
  </article>;
}
function RevisionHistory({
  history
}) {
  if (!history?.length) return <p className="text-[#6f5843]">Henüz ölçü veya randevu değişikliği kaydedilmedi.</p>;
  return <div className="space-y-3">{[...history].reverse().map((entry, index) => <details key={`${entry.revision}-${index}`} className="rounded-xl border border-[#decdb7] bg-[#fffdf8] p-4">
    <summary className="cursor-pointer font-semibold">Revizyon {entry.revision} · {entry.kind === 'plan' ? 'Ölçü randevusu' : 'Ölçü teyidi'} · {dateTime(entry.changed_at)}</summary>
    <div className="mt-4 space-y-3 text-[#593d29]">
      <p>Kaydı yapan: {actorLabel(entry.changed_by)} · Usta: {entry.after?.measurement_master || 'Belirtilmedi'}</p>
      <p>Ölçü tarihi: {date(entry.after?.measurement_date)} · Durum: {statusLabel(entry.after?.measurement_status)}</p>
      {entry.after?.measurement_note && <p className="whitespace-pre-wrap">Not: {entry.after.measurement_note}</p>}
      {entry.kind === 'measurement' && <>
        <p className="font-semibold">Sipariş tutarı: {money(entry.before?.grand_total)} → {money(entry.after?.grand_total)}</p>
        {(entry.after?.pos_details?.cart || []).map((line, position) => {
            const before = entry.before?.pos_details?.cart?.[position];
            return <div key={line.id || position} className="rounded-lg bg-[#f4ecdf] p-3">
              <strong>{line.product_name}</strong>
              <p className="mt-1">Önce: {before ? dims(before) : 'Kayıt bulunmuyor'}</p>
              <p>Sonra: {dims(line)}</p>
              <p>{number(before?.quantity)} → {number(line.quantity)} {line.unit_label} · {money(before?.item_total)} → {money(line.item_total)}</p>
            </div>;
          })}
      </>}
    </div>
  </details>)}</div>;
}
export default function SaleMeasurementPage() {
  const {
    id
  } = useParams();
  const [sale, setSale] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [metadata, setMetadata] = useState({
    measurement_date: '',
    measurement_master: '',
    measurement_note: ''
  });
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogWarning, setCatalogWarning] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [unknownRequest, setUnknownRequest] = useState(null);
  const requestRef = useRef(null);
  const busyRef = useRef(false);
  const reviewRef = useRef(null);
  const applyRecord = useCallback(record => {
    setSale(record);
    setMeasurements(formsFor(record));
    setMetadata(metadataFor(record));
    setReview(null);
    setConflict(false);
    setUnknownRequest(null);
    requestRef.current = null;
  }, []);
  const fetchRecord = useCallback(async () => {
    const response = await api.get('/sales');
    const record = Array.isArray(response.data) ? response.data.find(item => item._id === id) : null;
    if (!record) throw new Error('Sipariş bulunamadı veya bu kayda erişiminiz yok.');
    return record;
  }, [id]);
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError('');
      setSale(null);
      try {
        const record = await fetchRecord();
        if (active) applyRecord(record);
      } catch (error) {
        if (active) setLoadError(error.response?.data?.message || error.message || 'Sipariş yüklenemedi.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchRecord, applyRecord]);
  useEffect(() => {
    if (!sale) return;
    let active = true;
    (async () => {
      setCatalogLoading(true);
      const names = [...new Set((sale.pos_details?.cart || []).map(line => line.product_name).filter(Boolean))];
      const results = await Promise.allSettled(names.map(search => api.get('/products', {
        params: {
          search,
          limit: 100
        }
      })));
      if (!active) return;
      const found = results.flatMap(result => result.status === 'fulfilled' ? result.value.data.products || [] : []);
      setProducts([...new Map(found.map(product => [product._id, product])).values()]);
      setCatalogWarning(results.some(result => result.status === 'rejected'));
      setCatalogLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [sale]);
  const preview = useMemo(() => {
    if (!sale || !measurements.length) return {
      value: null,
      error: 'Bu eski siparişte ayrıntılı ölçü kaydı yok. Ürünleri ve hesap kurallarını kontrol etmek gerekir.'
    };
    try {
      return {
        value: buildMeasurementRevision(sale, {
          measurements
        }, products),
        error: ''
      };
    } catch (error) {
      return {
        value: null,
        error: error.message || 'Ölçü hesabı yapılamadı.'
      };
    }
  }, [sale, measurements, products]);
  const originalForms = useMemo(() => formsFor(sale), [sale]);
  const geometryChanged = comparableMeasurements(measurements) !== comparableMeasurements(originalForms);
  const metadataChanged = sale ? JSON.stringify(metadata) !== JSON.stringify(metadataFor(sale)) : false;
  const locked = busy || conflict || Boolean(unknownRequest) || !editable(sale);
  const changeLine = (index, key, value) => {
    if (locked || review) return;
    setMeasurements(previous => previous.map((form, position) => position === index ? {
      ...form,
      [key]: value
    } : form));
    requestRef.current = null;
  };
  const reload = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      applyRecord(await fetchRecord());
      setLoadError('');
      toast.success('Siparişin son kaydı yüklendi.');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Sipariş yenilenemedi.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const validMetadata = (planning = false) => {
    if (!metadata.measurement_master.trim()) {
      toast.error('Ölçüyü alacak / alan ustanın adını girin.');
      return false;
    }
    if (planning && !metadata.measurement_date) {
      toast.error('Ölçü randevusu tarihini seçin.');
      return false;
    }
    return true;
  };
  const reconcile = async request => {
    const record = await fetchRecord();
    const completed = request.kind === 'measurement' ? record.measurement_history?.some(entry => entry.request_id === request.client_request_id) : record.measurement_history?.some(entry => entry.kind === 'plan' && entry.revision === request.expected_revision + 1 && (entry.after?.measurement_master || '') === request.measurement_master && (entry.after?.measurement_note || '') === request.measurement_note && String(entry.after?.measurement_date || '').slice(0, 10) === request.measurement_date);
    if (completed) {
      applyRecord(record);
      toast.success(request.kind === 'measurement' ? 'Yeni ölçüler ve güncel sipariş tutarı kaydedildi.' : 'Ölçü randevusu kaydedildi.');
      return 'completed';
    }
    if (revisionOf(record) !== request.expected_revision || !editable(record)) {
      setConflict(true);
      setUnknownRequest(null);
      setReview(null);
      toast.error('Sipariş başka bir işlemde değişti. Son kaydı yükleyip ölçüleri tekrar kontrol edin.');
      return 'conflict';
    }
    return 'unchanged';
  };
  const save = async kind => {
    if (locked || busyRef.current || !validMetadata(kind === 'plan')) return;
    if (kind === 'measurement' && (!review || preview.error)) return;
    const cleanMetadata = {
      ...metadata,
      measurement_master: metadata.measurement_master.trim(),
      measurement_note: metadata.measurement_note.trim()
    };
    const fingerprint = JSON.stringify({
      measurements,
      ...cleanMetadata,
      expected_revision: revisionOf(sale)
    });
    if (kind === 'measurement' && requestRef.current?.fingerprint !== fingerprint) requestRef.current = {
      fingerprint,
      id: crypto.randomUUID()
    };
    const request = {
      kind,
      ...cleanMetadata,
      expected_revision: revisionOf(sale),
      ...(kind === 'measurement' ? {
        measurements,
        client_request_id: requestRef.current.id
      } : {})
    };
    const {
      kind: endpointKind,
      ...payload
    } = request;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await api.post(`/sales/${id}/${endpointKind === 'plan' ? 'measurement-plan' : 'measurements'}`, payload);
      if (response.data?._id !== id || revisionOf(response.data) <= request.expected_revision) throw new Error('Kaydın sonucu doğrulanamadı.');
      applyRecord(response.data);
      toast.success(kind === 'measurement' ? 'Ölçü teyit edildi. Sipariş tutarı ve PDF ölçüleri güncellendi.' : 'Ölçü randevusu kaydedildi.');
    } catch (error) {
      if (error.response?.status === 409) {
        setReview(null);
        try {
          const current = await fetchRecord();
          if (revisionOf(current) !== request.expected_revision || !editable(current)) setConflict(true);
        } catch {
          // A rejected transaction made no change; retain the form for a manual retry.
        }
        toast.error(error.response.data?.message || 'Ölçü kaydedilemedi. Siparişin son kaydını kontrol edin.');
      } else if (error.response?.status >= 400 && error.response?.status < 500) {
        toast.error(error.response.data?.message || 'Ölçü kaydedilemedi. Alanları kontrol edin.');
      } else {
        try {
          const result = await reconcile(request);
          if (result === 'unchanged') {
            setUnknownRequest(request);
            toast.error('Kaydın sonucu henüz doğrulanamadı. Yeniden kaydetmeden önce sonucu kontrol edin.');
          }
        } catch {
          setUnknownRequest(request);
          toast.error('Kaydın sonucu doğrulanamadı. Bağlantı gelince sonucu kontrol edin.');
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const checkResult = async () => {
    if (!unknownRequest || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await reconcile(unknownRequest);
      if (result === 'unchanged') {
        setUnknownRequest(null);
        toast('Değişiklik son kayıtta görünmüyor. Kontrol edip aynı isteği yeniden kaydedebilirsiniz.');
      }
    } catch {
      toast.error('Sonuç hâlâ doğrulanamıyor. Bağlantıyı kontrol edip tekrar deneyin.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const reviewMeasurements = () => {
    if (locked || catalogLoading || !validMetadata()) return;
    if (preview.error || !preview.value) {
      toast.error(preview.error || 'Ölçü hesabı yapılamadı.');
      return;
    }
    setReview(preview.value);
    setTimeout(() => {
      reviewRef.current?.focus();
      reviewRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 0);
  };
  const print = kind => {
    try {
      openCurtainPrint(sale, kind);
    } catch (error) {
      toast.error(error.message || 'PDF açılamadı.');
    }
  };
  if (loading) return <div className={card} role="status">Sipariş ve ölçü bilgileri yükleniyor…</div>;
  if (!sale) return <div className={`${card} space-y-4`}>
    <h1 className="text-2xl font-bold">Ölçü / Teyit</h1>
    <p role="alert">{loadError || 'Sipariş bulunamadı.'}</p>
    <div className="flex flex-wrap gap-3">
      <button onClick={reload} disabled={busy} className={secondary}>Tekrar dene</button>
      <Link to="/dashboard/sales" className={secondary}>Sipariş takibine dön</Link>
    </div>
  </div>;
  return <div className="mx-auto max-w-6xl space-y-5 text-[#392b22]">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">Ölçü / Teyit</h1>
        <p className="mt-2 text-[#6f5843]">Ön ölçüyle alınan siparişe evdeki son ölçüleri girin. Ürün ve işçilik birim fiyatları aynı kalır.</p>
      </div>
      <Link to="/dashboard/sales" className={secondary}>Sipariş takibine dön</Link>
    </div>
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{sale.customer_name || 'Müşteri adı girilmedi'}</h2>
          <p className="mt-2">Sipariş #{String(sale._id).slice(-8).toUpperCase()} · {sale.status === 'tamamlandi' ? 'Sipariş onaylandı' : sale.status === 'beklemede' ? 'Beklemede' : 'Bu kayıt düzenlenemez'}</p>
          <p className="mt-1">Telefon: {sale.customer_phone || '—'} · Teslim: {date(sale.delivery_date)}</p>{sale.customer_address && <p className="mt-1 whitespace-pre-wrap">Adres: {sale.customer_address}</p>}</div>
        <div className="text-right">
          <span className="inline-block rounded-full bg-[#eee1d0] px-4 py-2 font-bold">{statusLabel(sale.measurement_status)}</span>
          <p className="mt-2">Revizyon {revisionOf(sale)}</p>
          <strong className="mt-2 block text-2xl">{money(sale.grand_total)}</strong>
        </div>
      </div>
      {sale.measurement_status !== 'confirmed' && <p className="mt-4 rounded-xl border border-[#d8bd8e] bg-[#fff4da] p-4 font-semibold">Ölçüler henüz teyit edilmedi. İmalata geçmeden önce ustanın aldığı ölçüleri kaydedip teyit edin.</p>}
      {!editable(sale) && <p className="mt-4" role="alert">İptal edilen, teslim edilen veya kaybedilen siparişlerde ölçü değiştirilemez.</p>}
    </section>

    {conflict && <section className={`${card} border-amber-600`} role="alert">
      <h2 className="text-xl font-bold">Siparişin son kaydı değişti</h2>
      <p className="mt-2">Eski bilgilerle kayıt yapılamaz. Son kaydı yüklediğinizde buradaki kaydedilmemiş girişler temizlenir; ölçüleri yeni kayıt üzerinden tekrar kontrol edin.</p>
      <button className={`${secondary} mt-4`} disabled={busy} onClick={reload}>Son kaydı yükle</button>
    </section>}
    {unknownRequest && <section className={`${card} border-amber-600`} role="alert">
      <h2 className="text-xl font-bold">Kaydın sonucu kontrol edilmeli</h2>
      <p className="mt-2">Bağlantı kesildiği için işlemin kaydedilip kaydedilmediği henüz doğrulanamadı. Tekrar kayıt göndermeden önce siparişin son durumunu kontrol edin.</p>
      <button className={`${secondary} mt-4`} disabled={busy} onClick={checkResult}>{busy ? 'Kontrol ediliyor…' : 'Kaydın sonucunu kontrol et'}</button>
    </section>}

    <section className={card}>
      <h2 className="text-xl font-bold">Ölçü randevusu ve usta bilgisi</h2>
      <fieldset disabled={locked || Boolean(review)} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="font-semibold">Ölçü tarihi<input type="date" className={input} value={metadata.measurement_date} onChange={event => {
              setMetadata(previous => ({
                ...previous,
                measurement_date: event.target.value
              }));
              requestRef.current = null;
            }} />
          </label>
          <label className="font-semibold">Ustanın adı<input className={input} maxLength={120} value={metadata.measurement_master} onChange={event => {
              setMetadata(previous => ({
                ...previous,
                measurement_master: event.target.value
              }));
              requestRef.current = null;
            }} placeholder="Ölçüyü alacak / alan kişi" />
          </label>
        </div>
        <label className="block font-semibold">Ölçü notu / değişiklik açıklaması<textarea className={`${input} min-h-24 text-base`} maxLength={1000} value={metadata.measurement_note} onChange={event => {
            setMetadata(previous => ({
              ...previous,
              measurement_note: event.target.value
            }));
            requestRef.current = null;
          }} placeholder="Örn. Salonda müşterinin verdiği en, evde alınan ölçüyle düzeltildi." />
        </label>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button disabled={locked || Boolean(review) || geometryChanged || sale.measurement_status === 'scheduled' && !metadataChanged} className={secondary} onClick={() => save('plan')}>{busy ? 'Kaydediliyor…' : 'Ölçü randevusunu kaydet'}</button>
        <p className="text-sm text-[#6f5843]">Randevu kaydı ölçüleri ve sipariş tutarını değiştirmez.{geometryChanged ? ' Yeni ölçüleri kaydetmek için aşağıdaki teyit adımını kullanın.' : ''}</p>
      </div>
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Ustanın aldığı yeni ölçüler</h2>
        <p className="mt-2 text-[#6f5843]">Tüm ölçüler santimetredir. Ürün, renk / VR, pile, parça sayısı ve aksesuar seçimi korunur.</p>
      </div>
      <fieldset disabled={locked || Boolean(review)} className="space-y-4">{measurements.length > 0 && (sale.pos_details?.cart || []).map((line, index) => <MeasurementLine key={line.id || index} line={line} form={measurements[index]} onChange={(key, value) => changeLine(index, key, value)} />)}</fieldset>
      {catalogLoading && <p role="status">Hesap kuralları kontrol ediliyor…</p>}
      {catalogWarning && <p className="text-[#6f5843]">Katalog alınamadı. Yeterli hesap bilgisi varsa siparişte kayıtlı kurallar kullanılacak.</p>}
      {preview.error && <p className="rounded-xl border border-[#d8bd8e] bg-[#fff4da] p-4" role="alert">{preview.error}</p>}
    </section>

    {preview.value && <section className={card} aria-label="Ölçüye göre tutar önizlemesi">
      <h2 className="text-xl font-bold">Güncel ölçüye göre hesap</h2>
      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <p>Kayıtlı sipariş tutarı</p>
          <strong className="mt-1 block text-2xl">{money(sale.grand_total)}</strong>
        </div>
        <div>
          <p>Yeni ölçüye göre tutar</p>
          <strong className="mt-1 block text-2xl">{money(preview.value.grand_total)}</strong>
        </div>
        <div>
          <p>Tutar farkı</p>
          <strong className="mt-1 block text-2xl">{money(preview.value.grand_total - sale.grand_total)}</strong>
        </div>
      </div>
      <p className="mt-4 text-[#6f5843]">İskonto %{number(sale.discount_percent)} ve kayıtlı ödeme bilgileri korunur. Bu tutar, ölçü teyit edilip kaydedilene kadar önizlemedir.</p>
      <button className={`${primary} mt-5`} disabled={locked || catalogLoading || Boolean(review) || sale.measurement_status === 'confirmed' && !geometryChanged && !metadataChanged} onClick={reviewMeasurements}>Ölçüleri ve tutarı gözden geçir</button>
    </section>}

    {review && <section className={`${card} border-2 border-[#80512f]`} aria-label="Ölçü teyidi öncesi kontrol">
      <h2 ref={reviewRef} tabIndex={-1} className="text-2xl font-bold">Yeni ölçüleri teyit et</h2>
      <p className="mt-2">Aşağıdaki ölçüler kaydedilecek. Siparişin ürün ve işçilik fiyatları korunarak miktarlar ve toplam tutar güncellenecek.</p>
      <div className="mt-4 space-y-3">{review.pos_details.cart.map((line, index) => {
          const original = sale.pos_details.cart[index];
          return <article key={line.id || index} className="rounded-xl bg-[#f4ecdf] p-4">
            <h3 className="font-bold">{line.product_name}</h3>
            <p className="mt-2">Önce: {dims(original)}</p>
            <p>Yeni: {dims(line)}</p>
            <p className="mt-2 font-semibold">{number(original.quantity)} → {number(line.quantity)} {line.unit_label} · {money(original.item_total)} → {money(line.item_total)}</p>
          </article>;
        })}</div>
      <p className="mt-5 text-xl font-bold">Sipariş toplamı: {money(sale.grand_total)} → {money(review.grand_total)}</p>
      <p className="mt-2">Usta: {metadata.measurement_master} · Ölçü tarihi: {date(metadata.measurement_date)}</p>{metadata.measurement_note && <p className="mt-2 whitespace-pre-wrap">Not: {metadata.measurement_note}</p>}<div className="mt-5 flex flex-wrap gap-3">
        <button className={secondary} disabled={locked} onClick={() => setReview(null)}>Ölçülere dön</button>
        <button className={primary} disabled={locked} onClick={() => save('measurement')}>{busy ? 'Kaydediliyor…' : 'Teyit et ve yeni ölçüleri kaydet'}</button>
      </div>
    </section>}

    {sale.status === 'tamamlandi' && <section className={card}>
      <h2 className="text-xl font-bold">Kayıtlı siparişin güncel PDF’leri</h2>
      <p className="mt-2 text-[#6f5843]">Revizyon {revisionOf(sale)} · {statusLabel(sale.measurement_status)}. PDF’ler kayıtlı ölçüleri kullanır.{geometryChanged || metadataChanged ? ' Buradaki kaydedilmemiş değişiklikler PDF’ye yansımaz.' : ''}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className={secondary} disabled={busy || geometryChanged || metadataChanged || Boolean(unknownRequest) || conflict} onClick={() => print('customer')}>Müşteri sipariş kağıdı / PDF</button>
        <button className={secondary} disabled={busy || geometryChanged || metadataChanged || Boolean(unknownRequest) || conflict} onClick={() => print('manufacturing')}>İmalat planı / PDF</button>
      </div>
    </section>}

    <section className={card}>
      <h2 className="mb-4 text-xl font-bold">Ölçü ve randevu geçmişi</h2>
      <RevisionHistory history={sale.measurement_history} />
    </section>
  </div>;
}
