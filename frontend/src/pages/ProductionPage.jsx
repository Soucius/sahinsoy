import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { productionApi } from '../libs/productionApi';
import VisitPlanner from '../components/VisitPlanner';
import { DUTIES, staffLoginKey } from '../../../backend/src/libs/productionAccess.js';
const SUPPLY = { awaiting_order: 'Ürün siparişi verilecek', ordered: 'Ürün siparişi verildi', in_transit: 'Kargoda', received: 'Ürün mağazaya geldi' };
const STAGES = { waiting: 'Üretim bekliyor', cutting: 'Kesimde', cut: 'Kesildi', sewing: 'Dikim sırasında', sewn: 'Dikildi', ready: 'Teslime / montaja hazır', installation: 'Montajda', installed: 'Montaj tamamlandı' };
const ACTIONS = { cutting: 'Kesime başla', cut: 'Kesimi bitir', sewing: 'Dikime başla', sewn: 'Dikimi bitir', ready: 'Hazır olarak işaretle', installation: 'Montaja başla', installed: 'Montajı tamamla' };
const date = value => value ? new Date(value).toLocaleDateString('tr-TR') : 'Belirlenmedi';
const number = value => Number(value || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const field = 'w-full rounded-xl border border-[#d8c5ae] px-3 py-2';
const button = 'rounded-xl border border-[#d8c5ae] px-4 py-2 font-semibold disabled:opacity-50';
const primary = `${button} bg-[#754b2e] text-white`;
const stageLabel = job => job.supply !== 'received' ? SUPPLY[job.supply] : STAGES[job.stage];
function JobDetails({ job }) {
  const s = job.snapshot;
  return <div className="mt-4 space-y-3 text-lg">
    <p><strong>Ölçü:</strong> {number(s.width)}{s.height > 0 ? ` × ${number(s.height)}` : ''} cm · {number(s.pieces)} parça</p>
    <p><strong>{s.kind === 'textile' ? 'Giden kumaş' : 'Ürün miktarı'}:</strong> {number(s.quantity)} {s.unit_label}</p>
    {s.pleat_name && <p><strong>Pile:</strong> {s.pleat_name}</p>}
    {s.case_color && <p><strong>Kasa rengi:</strong> {s.case_color}</p>}
    {s.case_mode && <p><strong>Kasa düzeni:</strong> {s.case_mode === 'ortak' ? 'Ortak kasa' : 'Ayrı kasalar'}{s.case_count > 0 ? ` · ${s.case_count} kasa` : ''}{s.profile_width_cm > 0 ? ` · Profil eni ${number(s.profile_width_cm)} cm` : ''}</p>}
    {s.glass_label && <p><strong>Cam:</strong> {s.glass_label}</p>}
    {s.dual_role && <p><strong>Çiftli sistem:</strong> {s.dual_role === 'tul' ? 'Tül' : 'Güneşlik'}</p>}
    {s.motor_role && <p><strong>Motorlu sistem:</strong> {s.motor_role === 'motor' ? 'Motor' : 'Perde'} · Bağlı grup {s.motor_group.slice(-8)}</p>}
    {s.chain_direction && <p><strong>Zincir / motor yönü:</strong> {s.chain_direction}</p>}
    {[...(s.panels || []), ...(s.mechanical_panels || [])].length > 0 && <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="py-2">Parça</th><th>En</th><th>Boy</th><th>Kesim / seçenek</th></tr></thead><tbody>{[...(s.panels || []), ...(s.mechanical_panels || [])].map((p, i) => <tr key={i} className="border-b"><td className="py-3 pr-3">{p.position || p.label || `${i + 1}. parça`}</td><td className="pr-3">{number(p.width)} cm</td><td className="pr-3">{p.height ? `${number(p.height)} cm` : '—'}</td><td>{[p.cut_width ? `Kesim eni ${number(p.cut_width)} cm` : '', p.variant, p.case_color, p.chain_direction].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div>}
    {s.accessories?.length > 0 && <p><strong>Seçenekler:</strong> {s.accessories.map(a => [a.name, a.color, a.count_per_piece > 1 ? `${a.count_per_piece} adet / perde` : '', a.quantity > 0 ? `${number(a.quantity)} ${a.unit || 'adet'}` : ''].filter(Boolean).join(' · ')).join(' / ')}</p>}
    {s.item_note && <p className="whitespace-pre-wrap"><strong>Sipariş notu:</strong> {s.item_note}</p>}
  </div>;
}
function JobCard({ job, order, admin, staff, busy, change }) {
  const [note, setNote] = useState(job.note || '');
  const [tracking, setTracking] = useState(job.tracking || '');
  const disabled = busy || order.closed || order.needs_refresh;
  const s = job.snapshot;
  return <section className="border border-[#deceb9] rounded-2xl p-4 sm:p-5 bg-[#fffcf6]">
    <div className="flex flex-wrap gap-3 items-start justify-between"><div><h3 className="font-bold text-xl">{s.product_name}</h3><p className="mt-1 text-[#78634f]">{[s.brand_name, s.room_name, s.area, s.facade, s.window_name].filter(Boolean).join(' · ')}</p><p className="font-semibold mt-2">Renk / VR: {s.variant || 'Belirtilmedi'}</p></div><span className="rounded-full bg-[#eee1d0] px-4 py-2 font-bold">{stageLabel(job)}</span></div>
    <>{job.warnings?.length > 0 && <ul className="list-disc pl-5 my-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">{job.warnings.map((warning, index) => <li key={`${warning.code}-${index}`} className="ml-4 font-semibold">{warning.label}</li>)}</ul>}</>
    <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold">Ölçüleri ve ürün bilgilerini göster</summary><JobDetails job={job} /></details>
    {admin && <div className="mt-4 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <label className="font-semibold">Tedarik durumu<select className={`${field} mt-2`} disabled={disabled} value={job.supply} onChange={e => change({ supply: e.target.value })}>{Object.entries(SUPPLY).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {Object.entries(DUTIES).filter(([d]) => s.kind === 'textile' || d === 'installation').map(([duty, label]) => <label key={duty} className="font-semibold">{label} sorumlusu<select aria-label={`${s.product_name} ${label} sorumlusu`} className={`${field} mt-2`} disabled={disabled} value={job[duty] || ''} onChange={e => change({ [duty]: e.target.value || null })}><option value="">Atanmadı</option>{staff.filter(p => (p.active && p.duties.includes(duty)) || p._id === String(job[duty])).map(p => <option key={p._id} value={p._id}>{p.name}{!p.active ? ' (giriş kapalı)' : !p.duties.includes(duty) ? ' (görev yetkisi yok)' : ''}</option>)}</select></label>)}
    </div>}
    {admin && <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); change({ tracking }); }}><input aria-label="Kargo veya tedarik referansı" placeholder="Kargo / tedarik referansı (isteğe bağlı)" className={field} value={tracking} maxLength={200} disabled={disabled} onChange={e => setTracking(e.target.value)} /><button className={button} disabled={disabled || tracking === (job.tracking || '')}>Kaydet</button></form>}
    <form className="flex flex-wrap sm:flex-nowrap gap-2 mt-3" onSubmit={e => { e.preventDefault(); change({ note }); }}><textarea aria-label={`${s.product_name} iş notu`} placeholder="İş notu / bekleme nedeni…" className={`${field} min-h-16`} value={note} disabled={disabled} maxLength={1000} onChange={e => setNote(e.target.value)} /><button className={button} disabled={disabled || note === (job.note || '')}>Notu kaydet</button></form>
    <div className="flex flex-wrap gap-3 mt-4">{job.next_stages.map(stage => <button key={stage} className={primary} disabled={disabled} onClick={() => change({ stage })}>{ACTIONS[stage]}</button>)}</div>
    {order.measurement_status !== 'confirmed' && job.stage === 'waiting' && job.supply === 'received' && <p className="text-sm mt-3 text-[#80512f]">Kesin ölçü bekleniyor. Üretim / montaj başlatılamaz.</p>}
    {s.kind !== 'textile' && <p className="text-sm mt-3 text-[#78634f]">Hazır / mekanik ürün: kesim ve dikim sürecine girmez.</p>}
  </section>;
}
function StaffEditor({ entry, busy, close, save }) {
  const [form, setForm] = useState({ name: entry.name || '', duties: entry.duties || [], active: entry.active ?? true, password: '' });
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="staff-title" className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-3xl bg-[#fffcf6] p-6"><h2 id="staff-title" className="text-2xl font-bold">{entry._id ? 'Personel giriş ve görev izinleri' : 'Personel hesabı aç'}</h2><form className="space-y-4 mt-5" onSubmit={e => { e.preventDefault(); save({ ...form, ...(entry._id ? { expected_version: entry.session_version } : {}) }); }}>
    <label className="block font-semibold">Ad soyad<input className={`${field} mt-2`} required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label className="block font-semibold">{entry._id ? 'Yeni parola (değiştirmeyeceksen boş bırak)' : 'Parola'}<input className={`${field} mt-2`} type="password" autoComplete="new-password" required={!entry._id} minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
    <p className="text-sm text-[#78634f]">Personel, burada yazdığın ad soyad ve parolasıyla giriş yapar. En az 6 karakter. Parolayı personele kendin ilet; bu ekranda sonradan görüntülenmez.</p>
    <fieldset><legend className="font-semibold mb-2">Görev yetkileri</legend>{Object.entries(DUTIES).map(([d, label]) => <label className="inline-flex items-center gap-2 mr-5 min-h-12" key={d}><input type="checkbox" checked={form.duties.includes(d)} onChange={e => setForm({ ...form, duties: e.target.checked ? [...form.duties, d] : form.duties.filter(v => v !== d) })} />{label}</label>)}</fieldset>
    <label className="flex gap-3 items-center min-h-12"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Giriş izni açık</label>
    <p className="text-sm text-[#78634f]">Yalnız kendisine atadığın işleri görür. Yetki veya parola değiştiğinde açık personel oturumu kapanır.</p>
    <div className="flex gap-3"><button type="button" className={button} disabled={busy} onClick={close}>Vazgeç</button><button className={primary} disabled={busy || !form.duties.length}>{busy ? 'Kaydediliyor…' : 'İzinleri kaydet'}</button></div>
  </form></section></div>;
}
export default function ProductionPage({ admin = false }) {
  const client = useMemo(() => productionApi(admin), [admin]);
  const [actor, setActor] = useState(null), [orders, setOrders] = useState([]), [staff, setStaff] = useState([]), [presets, setPresets] = useState([]), [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('jobs'), [search, setSearch] = useState(''), [filter, setFilter] = useState('active'), [editing, setEditing] = useState(null), [refreshTarget, setRefreshTarget] = useState(null);
  const busyRef = useRef(false), navigate = useNavigate();
  async function load() {
    try {
      const [me, jobs, people, pending] = await Promise.all([client.get('/me'), client.get('/orders'), admin ? client.get('/staff') : null, admin ? client.get('/candidates') : null]);
      setActor(me.data); setOrders(jobs.data); setStaff(people?.data.staff || []); setPresets(people?.data.presets || []); setCandidates(pending?.data || []); setError('');
    } catch (e) {
      setError(e.response?.data?.message || 'Üretim bilgileri yüklenemedi. Bağlantınızı kontrol edip yenileyin.');
      if (!admin && e.response?.status === 401) { localStorage.removeItem('production_token'); navigate('/uretim/giris', { replace: true }); }
    } finally { setLoading(false); }
  }
  useEffect(() => { let stopped = false; const get = () => { if (!stopped) load(); }; get(); const timer = setInterval(get, 60000); window.addEventListener('sahinsoy-visits-changed', get); return () => { stopped = true; clearInterval(timer); window.removeEventListener('sahinsoy-visits-changed', get); }; // Refresh permissions and assigned work without changing an open form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  async function mutate(operation, success) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true);
    try { await operation(); toast.success(success); await load(); }
    catch (e) { toast.error(e.response?.data?.message || 'İşlem kaydedilemedi. Yenileyip tekrar deneyin.'); if (e.response?.status === 409 || e.response?.status === 401) await load(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const query = search.toLocaleLowerCase('tr-TR').trim();
  const matches = orders.flatMap(order => {
    if (filter === 'closed' ? !order.closed : order.closed) return [];
    const jobs = order.jobs.filter(job => (['active', 'closed'].includes(filter) || job.stage === filter || job.supply === filter) && (!query || `${order.customer_name} ${order.sale_id.slice(-8)} ${Object.values(job.snapshot).filter(v => typeof v === 'string').join(' ')}`.toLocaleLowerCase('tr-TR').includes(query)));
    return jobs.length ? [{ ...order, jobs }] : [];
  });
  const activeJobs = orders.filter(o => !o.closed).flatMap(o => o.jobs);
  const staffName = value => staff.find(p => p._id === String(value))?.name || 'Atanmadı';
  function describeChange(value) { return Object.entries(value || {}).flatMap(([key, val]) => key === 'jobs' ? [] : [`${({ stage: 'Aşama', supply: 'Tedarik', note: 'Not', tracking: 'Kargo', ...DUTIES })[key] || key}: ${STAGES[val] || SUPPLY[val] || (DUTIES[key] ? staffName(val) : val) || '—'}`]).join(' · '); }
  const saveStaff = form => mutate(async () => { if (editing._id) await client.patch(`/staff/${editing._id}`, form); else await client.post('/staff', form); setEditing(null); }, 'Personel izinleri kaydedildi.');
  return <main className={admin ? 'space-y-5' : 'max-w-6xl mx-auto p-4 sm:p-7 space-y-5'}>
    <header className="flex flex-wrap gap-4 justify-between items-center"><div><p className="text-sm uppercase tracking-widest text-[#967353]">Şahinsoy · Üretim</p><h1 className="text-3xl font-bold mt-2">{admin ? 'Üretim ve tedarik takibi' : `Merhaba${actor ? `, ${actor.name}` : ''}`}</h1><p className="mt-2 text-[#78634f]">{admin ? 'Ürünlerin gelişinden kesim, dikim ve montaja kadar tüm işler.' : 'Yalnız sana atanan işler. Aşamayı tamamladığında aşağıdaki düğmeyle kaydet.'}</p></div><div className="flex gap-3"><button className={button} onClick={load} disabled={busy}>Yenile</button>{!admin && <button className={button} onClick={() => { localStorage.removeItem('production_token'); navigate('/uretim/giris', { replace: true }); }}>Çıkış yap</button>}</div></header>
    {(admin || actor?.duties?.includes('installation')) && <VisitPlanner admin={admin} />}
    {error && <p role="alert" className="border border-red-300 bg-red-50 rounded-xl p-4">{error}</p>}
    {loading ? <p>Üretim işleri yükleniyor…</p> : error ? null : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Tedarikte', activeJobs.filter(j => j.supply !== 'received').length], ['Üretimde', activeJobs.filter(j => ['cutting', 'cut', 'sewing'].includes(j.stage)).length], ['Hazır', activeJobs.filter(j => ['sewn', 'ready'].includes(j.stage)).length], ['Montajda', activeJobs.filter(j => j.stage === 'installation').length]].map(([label, count]) => <div key={label} className="rounded-2xl border bg-[#eee1d0] p-4"><p>{label}</p><strong className="text-3xl block mt-1">{count}</strong></div>)}</div>
      {admin && <nav className="flex flex-wrap gap-3"><button className={tab === 'jobs' ? primary : button} onClick={() => setTab('jobs')}>İş takibi</button><button className={tab === 'new' ? primary : button} onClick={() => setTab('new')}>Üretime aktar ({candidates.length})</button><button className={tab === 'staff' ? primary : button} onClick={() => setTab('staff')}>Personel ve giriş izinleri</button></nav>}
      {tab === 'staff' && admin ? <section className="space-y-4"><h2 className="text-2xl font-bold">Personel ve giriş izinleri</h2><p>Personel giriş adresi: <a className="underline font-semibold" href="/uretim/giris" target="_blank" rel="noreferrer">{window.location.origin}/uretim/giris</a></p><div className="flex flex-wrap gap-3">{presets.filter(p => !staff.some(s => staffLoginKey(s.name).split(' ')[0] === staffLoginKey(p.name))).map(p => <button className={button} key={p.username} onClick={() => setEditing(p)}>{p.name} için hesap aç</button>)}<button className={button} onClick={() => setEditing({})}>Yeni personel</button></div>{staff.map(p => <article className="rounded-2xl border bg-[#fffcf6] p-5" key={p._id}><div className="flex flex-wrap gap-3 justify-between"><div><h3 className="text-xl font-bold">{p.name}</h3><p className="mt-2">{p.duties.map(d => DUTIES[d]).join(' / ')} · <strong>{p.active ? 'Giriş izni açık' : 'Giriş izni kapalı'}</strong></p></div><button className={button} disabled={busy} onClick={() => setEditing(p)}>İzinleri düzenle</button></div><details className="mt-3"><summary className="cursor-pointer py-2">İzin geçmişi</summary>{p.access_history?.map((h, i) => <p key={i} className="py-2 text-sm">{new Date(h.at).toLocaleString('tr-TR')} · {h.by} · {h.action}</p>)}</details></article>)}</section>
      : tab === 'new' && admin ? <section className="space-y-4"><h2 className="text-2xl font-bold">Onaylanan siparişler</h2><p>Aktarılan işler üretim bekliyor durumunda başlar. Malzeme durumunu ve sorumluları sen belirlersin.</p>{!candidates.length && <p>Aktarılmayı bekleyen onaylı sipariş yok.</p>}{candidates.map(s => <article className="rounded-2xl border bg-[#fffcf6] p-5 flex flex-wrap justify-between gap-4" key={s._id}><div><h3 className="text-xl font-bold">{s.customer_name || 'Müşteri'} · #{s._id.slice(-8).toUpperCase()}</h3><p className="mt-2">{s.item_count} ürün · Teslim: {date(s.delivery_date)}</p></div><button className={primary} disabled={busy} onClick={() => mutate(() => client.post('/orders', { sale_id: s._id }), 'Sipariş üretim takibine aktarıldı.')}>Üretime aktar</button></article>)}</section>
      : <><div className="grid sm:grid-cols-[1fr_280px] gap-3"><input className={field} placeholder="Müşteri, oda, ürün veya sipariş ara…" aria-label="Üretim işi ara" value={search} onChange={e => setSearch(e.target.value)} /><select className={field} aria-label="İş durumu filtresi" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Tüm açık işler</option>{Object.entries(SUPPLY).map(([id, label]) => <option key={id} value={id}>{label}</option>)}{Object.entries(STAGES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="closed">Kapanan / iptal edilen işler</option></select></div>
      {!matches.length && <p className="rounded-2xl border bg-[#fffcf6] p-7">{admin ? 'Bu filtrede üretim işi yok. Onaylı siparişleri “Üretime aktar” bölümünden ekleyebilirsin.' : 'Bu filtrede sana atanmış iş yok.'}</p>}
      {matches.map(order => <article key={order._id} className="rounded-3xl bg-[#f0e5d6] border border-[#d8c5ae] p-4 sm:p-6 space-y-4"><header className="flex flex-wrap gap-4 justify-between"><div><h2 className="text-2xl font-bold">{order.customer_name || 'Müşteri'} · #{order.sale_id.slice(-8).toUpperCase()}</h2><p className="mt-2">Teslim: {date(order.delivery_date)} · {['montaj', 'installation'].includes(order.delivery_method) ? 'Montaj' : 'Mağaza teslimi'}</p>{order.closed && <strong className="block mt-2">{order.sale_status === 'iptal' ? 'Sipariş iptal edildi' : 'Sipariş kapandı'} · İşlemler kapalı</strong>}</div>{admin && <a className={`${button} inline-flex items-center`} href={`/dashboard/sales/${order.sale_id}/measurements`}>Ölçü bilgileri</a>}</header>
        {order.needs_refresh && <div className="rounded-xl bg-amber-50 border border-amber-300 p-4"><p><strong>Ölçü / ürün bilgisi değişti.</strong> Eski ölçülerle işlem yapılması durduruldu.</p>{admin && !order.closed && <button className={`${button} mt-3`} disabled={busy} onClick={() => setRefreshTarget(order)}>Güncel sipariş bilgilerini al</button>}</div>}
        {order.jobs.map(job => <JobCard key={`${order._id}-${job.line_id}-${order.revision}`} job={job} order={order} admin={admin} staff={staff} busy={busy} change={changes => mutate(() => client.patch(`/orders/${order._id}/jobs/${job.line_id}`, { expected_revision: order.revision, changes }), 'İş kaydedildi.')} />)}
        <details><summary className="cursor-pointer py-3 font-bold">İşlem geçmişi</summary><div className="space-y-3 mt-2">{[...order.history].reverse().map((h, i) => <div className="border-l-2 border-[#b38b62] pl-4" key={i}><p className="font-semibold">{h.actor_name} · {new Date(h.at).toLocaleString('tr-TR')}</p><p>{h.action}{h.line_id ? ` · ${order.jobs.find(j => j.line_id === h.line_id)?.snapshot.product_name || 'Ürün satırı'}` : ''}</p>{describeChange(h.before) && <p className="text-sm text-[#78634f]">Önce: {describeChange(h.before)}</p>}{describeChange(h.after) && <p className="text-sm">Sonra: {describeChange(h.after)}</p>}</div>)}</div></details>
        {admin && <details><summary className="cursor-pointer py-3 font-bold">Müşteri mesajı ve bildirim izni</summary>
          <p className="text-sm mt-2">Mağaza hattı bağlıyken ve müşteri izni kayıtlıyken bütün ürünler hazır olduğunda bildirim gönderilir. Deneme modunda yalnız tanımlı deneme alıcısına standart Meta mesajı gider.</p>
          <a href="/dashboard/whatsapp" className="inline-block underline font-semibold py-3">WhatsApp bağlantısını ve gönderim durumunu gör</a>
          <label className="flex gap-3 items-center py-3"><input type="checkbox" disabled={busy || order.closed} checked={Boolean(order.whatsapp_consent)} onChange={e => mutate(() => client.patch(`/orders/${order._id}/whatsapp-consent`, { expected_revision: order.revision, granted: e.target.checked }), 'Müşteri bildirim izni kaydedildi.')} />Müşteri, bu sipariş için WhatsApp bildirimi almayı kabul etti.</label>
          <p className="mt-2">Telefon: {order.customer_phone || 'Kayıtlı değil'}</p><textarea aria-label="Müşteri mesajı taslağı" className={`${field} min-h-28 mt-3`} readOnly value={order.message_draft} /><button className={`${button} mt-3`} onClick={async () => { try { await navigator.clipboard.writeText(order.message_draft); toast.success('Mesaj taslağı kopyalandı.'); } catch { toast.error('Kopyalanamadı. Metni seçerek kopyalayabilirsin.'); } }}>Taslağı kopyala</button>
        </details>}
      </article>)}</>}
    </>}
    {editing && <StaffEditor key={editing._id || editing.username || 'new'} entry={editing} busy={busy} close={() => setEditing(null)} save={saveStaff} />}
    {refreshTarget && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="refresh-title" className="max-w-lg rounded-3xl bg-[#fffcf6] p-6"><h2 id="refresh-title" className="text-2xl font-bold">Güncel ölçü ve ürünleri al</h2><p className="mt-4">Ürün veya ölçüsü değişen satırların üretim aşaması “Üretim bekliyor” durumuna döner. Eski işlemler geçmişte korunur. Ekibine yeni ölçüyü bildirip bu satırları yeniden kontrol et.</p><div className="mt-5 flex gap-3"><button className={button} disabled={busy} onClick={() => setRefreshTarget(null)}>Vazgeç</button><button className={primary} disabled={busy} onClick={() => mutate(async () => { await client.post(`/orders/${refreshTarget._id}/refresh`, { expected_revision: refreshTarget.revision }); setRefreshTarget(null); }, 'Üretim bilgileri güncellendi.')}>Güncelle</button></div></section></div>}
  </main>;
}
