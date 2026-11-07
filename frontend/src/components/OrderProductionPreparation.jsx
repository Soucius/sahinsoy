import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { productionApi } from '../libs/productionApi';
import { initialProductionForm } from '../libs/productionPreparationForm';

const SUPPLY = { awaiting_order: 'Sipariş verilecek', ordered: 'Sipariş verildi', in_transit: 'Kargoda', received: 'Mağazada' };
const DONE = ['sewn', 'ready', 'installation', 'installed'];
const field = 'w-full rounded-xl border border-[#c8ad8c] bg-white px-3 py-3 disabled:opacity-60';
const button = 'rounded-xl border border-[#b99a77] px-4 py-3 font-semibold disabled:opacity-50';
const primary = `${button} bg-[#80512f] text-white`;
const key = value => value ? String(value) : null;
function missingAssignments(data, deliveryMethod) {
  return data.jobs.some(job => job.snapshot.kind === 'textile' && !DONE.includes(job.stage) && (!job.sewing || job.stage === 'waiting' && !job.cutting)
    || ['montaj', 'installation'].includes(deliveryMethod) && !['installation', 'installed'].includes(job.stage) && !job.installation);
}

export default function OrderProductionPreparation({ sale, blocked, onBusyChange }) {
  const client = useMemo(() => productionApi(true), []);
  const [data, setData] = useState(null), [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [editing, setEditing] = useState(false), [unknown, setUnknown] = useState(false);
  const requestRef = useRef(null), busyRef = useRef(false), resultRef = useRef(null);
  useEffect(() => { onBusyChange?.(busy || unknown); }, [busy, unknown, onBusyChange]);

  function apply(data, preserveDraft = false) {
    setData(data);
    setForm(previous => initialProductionForm(data, preserveDraft ? previous : undefined));
    setEditing(!data.order || data.order.needs_refresh || missingAssignments(data, sale.delivery_method));
    setError('');
  }
  async function load() {
    setLoading(true);
    try { const response = await client.get(`/preparation/${sale._id}`, { timeout: 12000 }); apply(response.data); }
    catch (error) { setError(error.response?.data?.message || 'Üretim hazırlığı yüklenemedi. Yeniden deneyin.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setNotice('');
    client.get(`/preparation/${sale._id}`, { signal: controller.signal, timeout: 12000 }).then(response => {
      if (active) apply(response.data, true);
    }).catch(error => { if (active) setError(error.response?.data?.message || 'Üretim hazırlığı yüklenemedi. Yeniden deneyin.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
    // A saved measurement revision reloads the exact source fingerprint before transfer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sale._id, sale.measurement_revision, sale.measurement_status]);

  function change(patch) { setForm(previous => ({ ...previous, ...patch })); requestRef.current = null; setNotice(''); }
  async function reconcile() {
    const response = await client.get(`/preparation/${sale._id}`, { timeout: 12000 });
    const found = response.data.order?.history?.some(entry => entry.after?.preparation_request?.id === requestRef.current?.request_id);
    apply(response.data); setUnknown(false);
    if (found) { setNotice('Üretim hazırlığı kaydedildi. İşler ilgili personelin panelinde.'); requestRef.current = null; }
    else setNotice('Son kayıtta bu işlem görünmüyor. Bilgileri kontrol edip aynı işlemi yeniden gönderebilirsiniz.');
    window.dispatchEvent(new Event('sahinsoy-visits-changed'));
  }
  async function save(event) {
    event.preventDefault();
    if (busyRef.current || blocked || unknown || !data || !form) return;
    const payload = { request_id: requestRef.current?.request_id || crypto.randomUUID(), expected_fingerprint: data.source_fingerprint,
      expected_revision: data.order?.revision ?? null, cutting: form.cutting || null, sewing: form.sewing || null, installation: form.installation || null,
      materials: data.jobs.map(job => ({ line_id: job.line_id, supply: form.materials[job.line_id] })), confirm_changed_work: form.confirm_changed_work };
    requestRef.current = payload; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await client.post(`/preparation/${sale._id}`, payload, { timeout: 20000 });
      if (response.data?.sale_id !== sale._id || !response.data.history?.some(entry => entry.after?.preparation_request?.id === payload.request_id)) throw new Error('Kayıt doğrulanamadı.');
      setData(previous => ({ ...previous, order: response.data, jobs: response.data.jobs, changed_started: [] }));
      setEditing(false); requestRef.current = null;
      setNotice('Üretime gönderildi. İşler seçilen personelin panelinde; malzeme bekleyenler beklemede kalır.');
      window.dispatchEvent(new Event('sahinsoy-visits-changed'));
    } catch (error) {
      if (error.response?.status >= 400 && error.response?.status < 500) {
        requestRef.current = null;
        setError(error.response.data?.message || 'Alanları kontrol edin.');
        if (error.response.status === 409) setNotice('Son bilgileri yükleyip kontrol edin; eski bilgilerle tekrar göndermeyin.');
      } else {
        setUnknown(true); setError('Bağlantı kesildi. Yeniden göndermeden önce aşağıdan kaydın sonucunu kontrol edin.');
      }
    } finally { busyRef.current = false; setBusy(false); resultRef.current?.focus(); }
  }
  async function checkResult() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await reconcile(); }
    catch { setError('Sonuç henüz doğrulanamıyor. Bağlantı geldiğinde tekrar kontrol edin.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const textile = data?.jobs.some(job => job.snapshot.kind === 'textile' && !DONE.includes(job.stage));
  const installation = ['montaj', 'installation'].includes(sale.delivery_method);
  const disabled = busy || blocked || unknown || data?.measurement_status !== 'confirmed' || data?.sale_status !== 'tamamlandi';
  const personName = id => data?.staff.find(person => person._id === key(id))?.name || (id ? 'Kayıtlı personel' : 'Atanmadı');
  const options = duty => data.staff.filter(person => person.active && person.duties.includes(duty)).map(person => <option value={person._id} key={person._id}>{person.name}</option>);

  return <section className="rounded-2xl border border-[#decdb7] bg-[#fffdf8] p-5 sm:p-6" aria-label="Üretim hazırlığı">
    <h2 className="text-xl font-bold">{data?.order && !data.order.needs_refresh ? 'Üretim takibi' : 'Üretime hazırla'}</h2>
    {loading ? <p className="mt-3" role="status">Üretim bilgileri yükleniyor…</p> : <>
      {data?.measurement_status !== 'confirmed' && <p className="mt-3 rounded-xl bg-[#fff4da] p-3">Önce yukarıdan son ölçüleri kaydedin. Ölçü bekleyen iş henüz üretime gönderilmez.</p>}
      {blocked && data?.measurement_status === 'confirmed' && <p className="mt-3">Kaydedilmemiş ölçü değişikliği var. Önce ölçüyü kaydedin veya kaydedilen ölçülere geri dönün.</p>}
      {data?.order?.needs_refresh && <p className="mt-3 rounded-xl bg-[#fff4da] p-3">Siparişin ölçü / ürün bilgisi değişti. Bu ekrandan güncel bilgileri üretime gönderebilirsiniz.</p>}
      {data && form && (editing ? <form className="mt-4 space-y-4" onSubmit={save}>
        <fieldset disabled={disabled} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">{textile && <>
            <label className="grid gap-2 font-semibold">Kesim sorumlusu<select className={field} value={form.cutting} onChange={event => change({ cutting: event.target.value })}><option value="">Personel seç</option>{options('cutting')}</select></label>
            <label className="grid gap-2 font-semibold">Dikim sorumlusu<select className={field} value={form.sewing} onChange={event => change({ sewing: event.target.value })}><option value="">Terzi seç</option>{options('sewing')}</select></label>
          </>}{installation && <label className="grid gap-2 font-semibold">Montaj sorumlusu<select className={field} value={form.installation} onChange={event => change({ installation: event.target.value })}><option value="">Personel seç</option>{options('installation')}</select></label>}</div>
          {data.order && <p className="text-sm text-[#6f5843]">Bu seçimler sorumlusu olmayan ürünlere uygulanır. Ürüne özel atamalar ve tamamlanmış işler korunur.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Malzeme durumu</h3><button type="button" className={button} onClick={() => change({ materials: Object.fromEntries(data.jobs.map(job => [job.line_id, 'received'])) })}>Tümü mağazada</button></div>
          {data.jobs.map(job => <div className="grid items-center gap-3 border-b border-[#eadfd1] pb-3 sm:grid-cols-[1fr_220px]" key={job.line_id}>
            <div><strong>{job.snapshot.product_name}</strong><p className="mt-1 text-sm text-[#6f5843]">{[job.snapshot.room_name, job.snapshot.facade, job.snapshot.variant].filter(Boolean).join(' · ')}</p></div>
            <label className="sr-only" htmlFor={`material-${job.line_id}`}>{job.snapshot.product_name} malzeme durumu</label>
            <select id={`material-${job.line_id}`} className={field} disabled={job.stage !== 'waiting'} value={form.materials[job.line_id]} onChange={event => change({ materials: { ...form.materials, [job.line_id]: event.target.value } })}>{Object.entries(SUPPLY).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          </div>)}
          {data.changed_started.length > 0 && <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-4"><input className="mt-1" type="checkbox" checked={form.confirm_changed_work} onChange={event => change({ confirm_changed_work: event.target.checked })} /><span><strong>Başlamış {data.changed_started.length} ürünün ölçüsü / ürünü değişmiş.</strong> {data.changed_started.map(job => job.product_name).join(', ')}. Değişen ürünler üretim beklemeye dönecek; ekiple yeniden kontrol edeceğim.</span></label>}
        </fieldset>
        <button className={primary} disabled={disabled || data.changed_started.length > 0 && !form.confirm_changed_work}>{busy ? 'Kaydediliyor…' : data.order ? 'Üretim hazırlığını kaydet' : 'Üretime gönder'}</button>
        <p className="text-sm text-[#6f5843]">Sorumluların paneline düşer. Kesim / dikim, personel başlattığında ilerler.</p>
      </form> : <div className="mt-4 space-y-3">
        <p className="font-semibold">Sipariş üretim takibinde.</p>
        <div className="space-y-2">{data.jobs.map(job => <p key={job.line_id}><strong>{job.snapshot.product_name}</strong> · {SUPPLY[job.supply]}{job.snapshot.kind === 'textile' ? ` · Kesim: ${personName(job.cutting)} · Dikim: ${personName(job.sewing)}` : ''}{installation ? ` · Montaj: ${personName(job.installation)}` : ''}</p>)}</div>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || blocked || unknown} onClick={() => { setForm(initialProductionForm(data)); setEditing(true); setNotice(''); }}>Malzeme / eksik sorumlu düzenle</button><Link className={button} to={`/dashboard/production?order=${sale._id}`}>İşin ilerleyişini gör</Link></div>
      </div>)}
    </>}
    <div ref={resultRef} tabIndex={-1} className="mt-4" role="status" aria-live="polite">{notice}</div>
    {error && <p className="mt-3 text-red-800" role="alert">{error}</p>}
    {unknown ? <button type="button" className={`${button} mt-3`} disabled={busy} onClick={checkResult}>Kaydın sonucunu kontrol et</button>
      : error && <button type="button" className={`${button} mt-3`} disabled={busy} onClick={load}>Son bilgileri yükle</button>}
  </section>;
}
