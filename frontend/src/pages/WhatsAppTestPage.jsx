import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../libs/axios';
import { productionApi } from '../libs/productionApi';

const button = 'rounded-xl border border-[#d8c5ae] px-5 py-3 font-semibold disabled:opacity-50';
const date = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
export default function WhatsAppTestPage() {
  const client = useMemo(() => productionApi(true), []);
  const [access, setAccess] = useState('loading'), [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [tested, setTested] = useState(false);
  const busyRef = useRef(false), requestId = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all([client.get('/me'), api.get('/whatsapp')]).then(([me, result]) => {
      if (!active) return;
      setAccess(me.data.kind === 'admin' ? 'allowed' : 'denied'); setData(result.data); setError('');
    }).catch(e => {
      if (!active) return;
      setAccess([401, 403].includes(e.response?.status) ? 'denied' : 'allowed');
      setError(e.response?.data?.message || 'WhatsApp bağlantı bilgileri alınamadı. Yenileyip tekrar deneyin.');
    });
    return () => { active = false; };
  }, [client, refresh]);
  useEffect(() => { const timer = setInterval(() => setRefresh(n => n + 1), 10000); return () => clearInterval(timer); }, []);
  async function send(operation, message) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice('');
    try { await operation(); setNotice(message); setRefresh(n => n + 1); }
    catch (e) { setError(e.response?.data?.message || 'İstek tamamlanamadı. Listeyi yenileyip kontrol edin.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (access === 'loading') return <p>Giriş izni kontrol ediliyor…</p>;
  if (access === 'denied') return <p role="alert">WhatsApp bildirimleri yalnız mağaza yöneticisine açıktır. Yönetici hesabıyla yeniden giriş yapın.</p>;
  const connection = data?.connection;
  return <main className="max-w-5xl mx-auto space-y-5 text-[#443325]">
    <header className="flex flex-wrap justify-between gap-4"><div><p className="text-sm text-[#78634f]">ŞAHİNSOY · WHATSAPP</p><h1 className="text-3xl font-bold mt-2">WhatsApp bildirimleri</h1><p className="mt-3">Ürün hazır bildirimlerini ve mesajların ulaşma durumunu buradan izle.</p></div><button className={button} onClick={() => setRefresh(n => n + 1)} disabled={busy}>Yenile</button></header>
    {error && <p role="alert" className="border border-red-300 bg-red-50 rounded-xl p-4">{error}</p>}
    {notice && <p role="status" className="border border-[#b38b62] bg-[#f4ecdf] rounded-xl p-4">{notice}</p>}
    {connection && <section className="rounded-2xl border border-[#d8c5ae] bg-[#f4ecdf] p-5 space-y-3">
      <h2 className="text-xl font-bold">{connection.mode === 'test' ? 'Meta deneme bağlantısı' : connection.mode === 'live' ? 'Mağaza hattı bağlantısı' : 'Bağlantı kurulumu bekleniyor'}</h2>
      <p className="font-semibold">{connection.configured ? 'Gönderim bağlantısı hazır' : 'Otomatik mesaj gönderimi kapalı'}</p>
      {connection.missing.length > 0 && <p>Eksik bağlantı bilgileri: {connection.missing.join(', ')}.</p>}
      {connection.mode === 'test' ? <><p>Deneme alıcısı: <strong>{connection.recipient || 'Tanımlanmadı'}</strong>. Bütün ürünler hazır işaretlendiğinde yalnız bu numaraya Meta’nın standart İngilizce <strong>Hello World</strong> deneme mesajı gönderilir. Müşterilere mesaj gitmez; müşteri adı ve sipariş bilgileri Meta’ya aktarılmaz.</p><p>Bu adım bağlantıyı sınar. Kişiye özel Türkçe mesaj, mağaza hattı ve mesaj şablonu onayından sonra kullanılacak.</p>
        <button className={`${button} bg-[#754b2e] text-white`} disabled={busy || tested || !connection.configured} onClick={() => { requestId.current ||= crypto.randomUUID(); send(async () => { await api.post('/whatsapp/test', { request_id: requestId.current }); setTested(true); }, 'Deneme isteği sıraya alındı. Sonucu aşağıdaki listeden takip et.'); }}>{busy ? 'İşleniyor…' : tested ? 'Deneme isteği oluşturuldu' : 'Kendi numarama deneme mesajı gönder'}</button></>
      : connection.mode === 'live' ? <p>Müşteri bildirim izni kayıtlı siparişlerin bütün ürünleri hazır olduğunda teslim şekline uygun onaylı mesaj gönderilir.</p>
      : <p>Meta erişim anahtarı ve doğrulanmış deneme numarası sunucuya tanımlandıktan sonra burada kendi numarana gönderim deneyebilirsin.</p>}
      {!connection.delivery_tracking && connection.mode !== 'disabled' && <p className="text-sm">Teslim takibi henüz bağlı değil. “WhatsApp kabul etti” bilgisi mesajın telefona ulaştığı anlamına gelmez.</p>}
      <a className="inline-block underline font-semibold" href="/dashboard/production">Üretim ve tedarik takibini aç</a>
    </section>}
    <section className="rounded-2xl border border-[#d8c5ae] bg-[#fffcf6] p-5 space-y-3">
      <h2 className="text-xl font-bold">Mağaza hattında kullanılacak mesaj</h2>
      <p>Sayın [müşteri adı], ürünleriniz hazırdır. Mağazamızdan teslim alabilirsiniz. Bizi tercih ettiğiniz için teşekkür ederiz. Şahinsoy Perde · Sipariş no: [sipariş no]</p>
      <p className="text-sm text-[#78634f]">Montajlı işlerde teslim alma cümlesi yerine montaj randevusu için iletişime geçileceği belirtilir. Bu metin önizlemedir.</p>
    </section>
    <section className="space-y-3"><h2 className="text-2xl font-bold">Son bildirimler</h2>
      {data && !data.notifications.length && <p className="rounded-2xl border bg-[#fffcf6] p-5">Henüz gönderim isteği yok.</p>}
      {data?.notifications.map(n => <article key={n._id} className="rounded-2xl border border-[#d8c5ae] bg-[#fffcf6] p-5 space-y-2">
        <div className="flex flex-wrap justify-between gap-3"><h3 className="font-bold text-lg">{n.kind === 'connection_test' ? 'Bağlantı denemesi' : `Sipariş #${n.sale_id.slice(-8).toUpperCase()}`}</h3><strong>{n.status_label}</strong></div>
        <p>{n.mode === 'test' ? 'Deneme' : n.kind === 'ready_installation' ? 'Montaj randevusu' : 'Mağazadan teslim'} · {n.recipient}</p><p className="text-sm text-[#78634f]">Oluşturuldu: {date(n.created_at)} · Son durum: {date(n.updated_at)}</p>
        {n.detail && <p>{n.detail}</p>}
        {n.retry_allowed && <button className={button} disabled={busy || !connection?.configured} onClick={() => send(() => api.post(`/whatsapp/notifications/${n._id}/retry`, {}), 'Başarısız bildirim tekrar sıraya alındı.')}>Bağlantıyı düzelttim, tekrar gönder</button>}
      </article>)}
    </section>
  </main>;
}
