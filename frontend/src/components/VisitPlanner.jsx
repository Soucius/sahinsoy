import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { productionApi } from '../libs/productionApi';

const kinds = { measurement: 'Ölçü', installation: 'Montaj', store: 'Mağaza teslimi' };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
const dateLabel = value => value ? value.split('-').reverse().join('.') : 'Tarih belirlenmedi';
const button = 'min-h-11 rounded-xl border border-[#d8c5ae] bg-white px-4 py-2 font-semibold disabled:opacity-50';
const field = 'w-full rounded-xl border border-[#d8c5ae] bg-white px-3 py-3';
const shiftDay = (value, days) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
export default function VisitPlanner({ admin = false }) {
  const client = useMemo(() => productionApi(admin), [admin]);
  const [result, setResult] = useState(null), [day, setDay] = useState(today), [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [form, setForm] = useState(null), [forbidden, setForbidden] = useState(false);
  const saving = useRef(false), request = useRef(0), formRef = useRef(null);
  useEffect(() => { if (editing) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [editing]);
  const load = useCallback(async () => {
    const id = ++request.current;
    try { const response = await client.get('/visits'); if (id === request.current) { setResult(response.data); setError(''); setForbidden(false); } }
    catch (e) { if (id === request.current) { setError(e.response?.data?.message || 'Günlük plan yüklenemedi. Görünen liste eski olabilir.'); if (e.response?.status === 403) setForbidden(true); } }
  }, [client]);
  useEffect(() => { load(); const timer = setInterval(load, 60000); const current = request; return () => { current.current++; clearInterval(timer); }; }, [load]);
  const cards = result?.cards || [], currentDay = result?.today || today();
  const active = cards.filter(card => !card.completed);
  const selectedDay = cards.filter(card => (showCompleted || !card.completed) && card.date === day);
  const query = search.trim().toLocaleLowerCase('tr-TR');
  const matches = cards.filter(card => (showCompleted || !card.completed) && (!query || `${card.customer_name} ${card.sale_id} ${card.assigned_name}`.toLocaleLowerCase('tr-TR').includes(query)) && (filter === 'overdue' ? card.date && card.date < currentDay && !card.completed : filter === 'undated' ? !card.date && !card.completed : card.date === day && (filter === 'all' || card.kind === filter)));
  function edit(card) { setEditing(card); setForm({ request_id: crypto.randomUUID(), kind: card.kind, date: card.date || day, assigned_to: card.assigned_to || '', note: card.note, expected_revision: card.revision, expected_date: card.date, expected_measurement_revision: card.measurement_revision }); setNotice(''); }
  async function save(event) {
    event.preventDefault(); if (!editing || saving.current) return;
    saving.current = true; setBusy(true); setNotice('');
    try {
      await client.post(`/visits/${editing.sale_id}`, form);
      setEditing(null); setForm(null); setNotice('Termin ve sorumlu kaydedildi.'); await load();
    } catch (e) { setNotice(e.response?.data?.message || 'Kayıt yanıtı alınamadı. Planı yenileyip kontrol et; aynı isteği tekrar kaydetmek ikinci randevu oluşturmaz.'); if (e.response?.status === 409) await load(); }
    finally { saving.current = false; setBusy(false); }
  }
  if (forbidden) return null;
  return <section aria-label={admin ? 'Günlük kontrol ve termin planı' : 'Bana atanan ölçü ve montaj planı'} className="rounded-3xl border border-[#d8c5ae] bg-[#fffaf3] p-4 sm:p-6 space-y-5 text-[#3d2d22]">
    <header className="flex flex-wrap gap-3 items-start justify-between"><div><h2 className="text-2xl font-bold">{admin ? 'Günlük kontrol ve terminler' : 'Günlük planım · Ölçü ve montaj'}</h2><p className="mt-2 text-sm">{admin ? 'Ölçü, montaj, mağaza teslimi ve geciken işleri buradan planla. Tarih değişikliği siparişin tutarını veya tahsilatını değiştirmez.' : 'Yalnız sana atanan ziyaretler. Tarih ve sorumlu değişikliklerini mağaza yöneticin yapar.'}</p></div><button className={button} disabled={busy} onClick={load}>Planı yenile</button></header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-[#eee1d0] p-3">{notice}</p>}
    {!result ? <p>Günlük plan yükleniyor…</p> : <>
      {result.truncated && <p role="alert" className="rounded-xl bg-amber-50 p-3">İlk 2.000 sipariş/randevu tarandı; plan tam değil. Daha eski kayıtlar için kapsam genişletilmeli.</p>}
      <div className={`grid grid-cols-2 ${admin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
        {Object.entries(kinds).filter(([kind]) => admin || kind !== 'store').map(([kind, label]) => <button key={kind} className={`${button} text-left ${filter === kind ? 'ring-2 ring-[#80512f]' : ''}`} onClick={() => setFilter(kind)}><span className="block">{label} · {dateLabel(day)}</span><strong className="block text-3xl mt-2">{selectedDay.filter(card => card.kind === kind).length}</strong></button>)}
        <button className={`${button} text-left bg-red-50 ${filter === 'overdue' ? 'ring-2 ring-red-700' : ''}`} onClick={() => setFilter('overdue')}><span className="block">Geciken işler · Bugüne göre</span><strong className="block text-3xl mt-2 text-red-800">{active.filter(card => card.date && card.date < currentDay).length}</strong></button>
      </div>
      <div className="flex flex-wrap gap-3 items-end"><label className="grid gap-2 text-sm">Plan tarihi<input type="date" className={field} value={day} required onChange={event => { if (event.target.value) { setDay(event.target.value); setFilter('all'); } }} /></label><button className={button} onClick={() => { setDay(currentDay); setFilter('all'); }}>Bugün</button><button className={button} onClick={() => { setDay(shiftDay(currentDay, 1)); setFilter('all'); }}>Yarın</button><button className={button} onClick={() => setFilter('all')}>Günün tüm işleri</button><button className={button} onClick={() => setFilter('undated')}>Tarihi belirlenmeyenler ({active.filter(card => !card.date).length})</button></div>
      <div className="flex flex-wrap gap-4 items-center"><label className="grow min-w-52">Müşteri / sipariş / sorumlu ara<input className={`${field} mt-2`} value={search} onChange={event => setSearch(event.target.value)} /></label><label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />Tamamlanan ölçü / montajları da göster</label></div>
      <p className="text-sm font-semibold">{filter === 'overdue' ? `Geciken açık işler · ${dateLabel(currentDay)} öncesi` : filter === 'undated' ? 'Tarihi belirlenmeyen açık işler' : `${dateLabel(day)} · ${filter === 'all' ? 'Tüm işler' : kinds[filter]}`} · {matches.length} kayıt</p>
      {!matches.length && <p className="rounded-xl border border-dashed p-5">Bu seçimde {admin ? 'planlanmış iş' : 'sana atanmış ziyaret'} yok.</p>}
      <div className="grid gap-4 xl:grid-cols-2">{matches.map(card => <article key={card.key} className="rounded-2xl border border-[#d8c5ae] bg-white p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-3"><strong className={`rounded-lg px-3 py-2 ${card.kind === 'measurement' ? 'bg-blue-50 text-blue-900' : card.kind === 'installation' ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900'}`}>{kinds[card.kind]}</strong><span className="font-semibold">{dateLabel(card.date)}{!card.completed && card.date && card.date < currentDay ? ' · Gecikmiş' : ''}{card.completed ? card.kind === 'installation' ? ' · Montaj tamamlandı' : ' · Ölçü teyit edildi' : ''}</span></div>
        <h3 className="text-xl font-bold">{card.customer_name}</h3><p className="text-sm">Sipariş #{card.sale_id.slice(-8).toUpperCase()}</p>
        {card.kind !== 'store' && <p><strong>Sorumlu:</strong> {card.assigned_name || 'Atanmadı'}</p>}
        {admin && card.customer_phone && <p>Telefon: {card.customer_phone}</p>}{admin && card.customer_address && <p className="whitespace-pre-wrap">Adres: {card.customer_address}</p>}
        {card.note && <p className="whitespace-pre-wrap rounded-lg bg-[#fffaf3] p-3">{card.note}</p>}
        {!card.explicit_plan && <p className="text-xs text-[#78634f]">{card.kind === 'measurement' ? 'Siparişteki ölçü tarihinden gösteriliyor.' : 'Siparişteki teslim tarihinden gösteriliyor; sorumlu ve iş notunu planlayabilirsin.'}</p>}
        {card.changed_elsewhere && <p className="text-sm text-amber-900">Tarih sipariş/ölçü ekranından değişti; güncel tarih gösteriliyor.</p>}
        {card.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900 space-y-1">{card.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        {admin && <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !!error} onClick={() => edit(card)}>Termini / sorumluyu düzenle</button><Link className={button} to={`/dashboard/sales/${card.sale_id}/${card.kind === 'measurement' ? 'measurements' : 'payments'}`}>{card.kind === 'measurement' ? 'Ölçü bilgileri' : 'Sipariş / tahsilatlar'}</Link></div>}
        {admin && card.history?.length > 0 && <details><summary className="cursor-pointer underline text-sm">Termin değişiklik geçmişi</summary><div className="mt-2 space-y-2 text-sm">{[...card.history].reverse().map((event, index) => <p key={index}>{new Date(event.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} · {event.name} · {dateLabel(event.before?.date)} → {dateLabel(event.after?.date)}</p>)}</div></details>}
      </article>)}</div>
      {admin && <details><summary className="cursor-pointer font-semibold py-2">Başka siparişe termin / sorumlu belirle</summary><div className="grid gap-3 sm:grid-cols-2 mt-3">{cards.filter(card => !card.completed).map(card => <button key={card.key} className={`${button} text-left`} onClick={() => edit(card)}>{card.customer_name} · #{card.sale_id.slice(-8).toUpperCase()} · {kinds[card.kind]} · {dateLabel(card.date)}</button>)}</div></details>}
      {admin && form && editing && <section ref={formRef} role="dialog" aria-modal="false" aria-label="Termin ve sorumlu düzenle" className="rounded-2xl border-2 border-[#80512f] bg-white p-5"><h3 className="text-xl font-bold">{editing.customer_name} · {kinds[editing.kind]} termini</h3><form onSubmit={save} className="space-y-4 mt-4"><label className="grid gap-2">Termin tarihi<input autoFocus type="date" className={field} required min="2020-01-01" max="2100-12-31" disabled={busy} value={form.date} onChange={event => setForm({ ...form, request_id: crypto.randomUUID(), date: event.target.value })} /></label>
        {editing.kind !== 'store' && <label className="grid gap-2">Sorumlu personel<select className={field} value={form.assigned_to} disabled={busy} onChange={event => setForm({ ...form, request_id: crypto.randomUUID(), assigned_to: event.target.value })}><option value="">Şimdilik atanmadı</option>{result.staff.filter(person => person.active && person.duties.includes('installation') || person.id === form.assigned_to).map(person => <option key={person.id} value={person.id}>{person.name}{!person.active || !person.duties.includes('installation') ? ' · Görev / giriş iznini kontrol et' : ''}</option>)}</select></label>}
        <label className="grid gap-2">{editing.kind === 'store' ? 'Mağaza teslim notu' : 'Personele görünecek ziyaret notu'}<textarea className={field} rows={3} maxLength={1000} disabled={busy} value={form.note} onChange={event => setForm({ ...form, request_id: crypto.randomUUID(), note: event.target.value })} /></label>
        {editing.kind === 'measurement' && editing.completed && editing.date !== form.date && <p className="rounded-xl bg-amber-50 p-3">Yeni ölçü tarihi kaydedilirse sipariş yeniden “Ölçü planlandı” olur. Kesin ölçüler girilene kadar üretim aşamaları yeniden kontrol ister.</p>}
        <p className="text-sm">{editing.kind === 'measurement' ? 'Bu tarih ölçü randevusuyla aynı kayıttır.' : 'Bu tarih siparişin teslim tarihiyle birlikte güncellenir.'} Randevu kaydı teslim edildi veya ödeme alındı anlamına gelmez.</p>
        <div className="flex gap-3"><button className={`${button} bg-[#754b2e] text-white`} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Termini kaydet'}</button><button type="button" className={button} disabled={busy} onClick={() => { setForm(null); setEditing(null); }}>Vazgeç</button></div>
      </form></section>}
    </>}
  </section>;
}
