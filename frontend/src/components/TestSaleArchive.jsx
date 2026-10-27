import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../libs/axios';

const button = 'rounded-lg border border-[#c9b49b] px-4 py-2 font-semibold disabled:opacity-50';
const labels = { beklemede: 'Beklemede', tamamlandi: 'Sipariş onaylandı', teslim_edildi: 'Teslim edildi', iptal: 'İptal edildi', kaybedildi: 'Kaybedilen teklif' };
export default function TestSaleArchive({ target, onClose, onChanged, onAvailability }) {
  const [result, setResult] = useState(null), [preview, setPreview] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const locked = useRef(false), generation = useRef(0);
  const load = useCallback(async () => {
    try { const response = await api.get('/sales/test-archive'); setResult(response.data); onAvailability(true); }
    catch (e) { if ([403, 404].includes(e.response?.status)) { setResult(null); onAvailability(false); } else setError(e.response?.data?.message || 'Deneme arşivi yüklenemedi.'); }
  }, [onAvailability]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const current = generation, id = ++current.current; setPreview(null); setError('');
    if (!target) return;
    api.get('/sales/test-archive', { params: { sale_id: target._id } }).then(response => { if (id === generation.current) setPreview({ ...response.data.preview, request_id: crypto.randomUUID() }); }).catch(e => { if (id === generation.current) setError(e.response?.data?.message || 'Sipariş bilgisi yüklenemedi.'); });
    return () => { current.current++; };
  }, [target]);
  async function mutate(restoring, record) {
    if (locked.current || (!restoring && !preview)) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (restoring) await api.post('/sales/test-archive/restore', { request_id: record.id });
      else await api.post('/sales/test-archive', { request_id: preview.request_id, sale_id: preview.sale_id, fingerprint: preview.fingerprint });
      setNotice(restoring ? 'Sipariş eski durumuyla geri alındı.' : 'Deneme siparişi listelerden kaldırıldı. Mail order ve cari kayıtları aynen korundu.');
      onClose(); await load(); await onChanged();
    } catch (e) { setError(e.response?.data?.message || 'Sonuç doğrulanamadı. Arşivi ve sipariş listesini yenileyip kontrol edin.'); await load(); await onChanged(); }
    finally { locked.current = false; setBusy(false); }
  }
  if (!result && !target) return null;
  const records = result?.records || [], active = records.filter(record => !record.restored_at);
  return <section className="rounded-xl border border-[#d8c5ae] bg-[#fffaf3] p-4 space-y-3" aria-label="TEST deneme siparişi arşivi">
    <details><summary className="cursor-pointer font-semibold">Deneme arşivi ({active.length})</summary>
      <p className="my-3 text-sm">Deneme siparişindeki “Deneme kaydını kaldır” düğmesi kaydı satış, üretim ve günlük plan listelerinden çıkarır. Mail order, tahsilat, cari, fatura ve stok kayıtlarını değiştirmez. Bu işlem gerçek siparişi iptal etmek için kullanılmaz.</p>
      {result?.truncated && <p role="alert">Son 500 arşiv işlemi gösteriliyor.</p>}
      {!active.length && <p>Arşivde deneme siparişi yok.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{active.map(record => <article key={record.id} className="rounded-lg border bg-white p-3"><strong>{record.customer_name}</strong><p>#{record.sale_id.slice(-8).toUpperCase()} · {labels[record.previous_status] || record.previous_status}</p><p className="text-sm">Kaldırılma: {new Date(record.archived_at).toLocaleString('tr-TR')}</p><button className={`${button} mt-2`} disabled={busy} onClick={() => mutate(true, record)}>Siparişi geri al</button></article>)}</div>
    </details>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-red-800">{error}</p>}
    {target && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="test-archive-title" className="max-w-lg w-full rounded-2xl bg-white p-6 shadow-xl">
      <h2 id="test-archive-title" className="text-xl font-bold">Deneme kaydını kaldır</h2><p className="mt-3 font-semibold">{preview?.customer_name || target.customer_name} · #{target._id.slice(-8).toUpperCase()}</p>
      <p className="mt-3">Bu deneme siparişi satış, üretim ve günlük plan ekranlarından kaldırılacak. Gerekirse “Deneme arşivi” bölümünden eski durumuyla geri alabilirsin.</p>
      <p className="mt-3 font-semibold">Mail order, tahsilat ve cari bakiyeleri aynen kalacak. Faturalara ve stoklara dokunulmayacak.</p>
      {!preview && !error && <p className="mt-3">Güncel kayıt kontrol ediliyor…</p>}{error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
      <div className="mt-5 flex gap-3"><button autoFocus className={button} disabled={busy} onClick={onClose}>Vazgeç</button><button className={`${button} bg-red-700 text-white`} disabled={busy || !preview} onClick={() => mutate(false)}>{busy ? 'Kaldırılıyor…' : 'Deneme kaydını arşive kaldır'}</button></div>
    </section></div>}
  </section>;
}
