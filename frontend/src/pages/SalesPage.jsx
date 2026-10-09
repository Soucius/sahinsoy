import {useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import api from '../libs/axios';
import toast from 'react-hot-toast';
import {openCurtainPrint} from '../libs/curtainPrint';
const money=x=>Number(x||0).toLocaleString('tr-TR',{style:'currency',currency:'TRY'});
const statuses={beklemede:'Beklemede',tamamlandi:'Sipariş onaylandı',teslim_edildi:'Teslim Edilen İşler',kaybedildi:'Kaybedilen teklifler',iptal:'İptal Edilenler'};
const isApprovedWork=sale=>sale.status==='tamamlandi'||sale.status==='teslim_edildi';
const approvalMonth=sale=>new Date(sale.approved_at||(sale.status==='teslim_edildi'?sale.createdAt:sale.updatedAt||sale.createdAt)).toLocaleDateString('sv-SE').slice(0,7);
const measurementLabel=sale=>sale.measurement_status==='confirmed'?'Ölçü teyit edildi':sale.measurement_status==='scheduled'?'Ölçü planlandı':'Ön ölçü';
export default function SalesPage(){
  const [sales,setSales]=useState([]),[loading,setLoading]=useState(true),[tab,setTab]=useState('beklemede'),[search,setSearch]=useState(''),[month,setMonth]=useState(new Date().toLocaleDateString('sv-SE').slice(0,7)),[busy,setBusy]=useState(null);
  const [cancelTarget,setCancelTarget]=useState(null);
  const [deliverTarget,setDeliverTarget]=useState(null);
  const busyRef=useRef(null);
  const navigate=useNavigate();
  const load=async()=>{try{const r=await api.get('/sales');setSales(r.data);}catch{toast.error('Teklif ve siparişler yüklenemedi.');}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const monthly=sales.filter(x=>x.status!=='iptal'&&new Date(x.createdAt).toLocaleDateString('sv-SE').slice(0,7)===month);
  const total=monthly.reduce((s,x)=>s+Number(x.grand_total||0),0),approved=monthly.filter(isApprovedWork),won=sales.filter(x=>isApprovedWork(x)&&approvalMonth(x)===month).reduce((s,x)=>s+Number(x.grand_total||0),0);
  const matches=sales.filter(x=>x.status===tab&&(!search||`${x.customer_name} ${x.customer_phone} ${x._id}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR'))));
  const lose=async(sale)=>{if(busyRef.current)return;busyRef.current=sale._id;setBusy(sale._id);try{await api.put(`/sales/${sale._id}`,{status:'kaybedildi'});await load();toast.success('Teklif kaybedildi olarak kaydedildi.');}catch(error){toast.error(error.response?.data?.message||'Durum kaydedilemedi.');}finally{busyRef.current=null;setBusy(null);}};
  const finishCancellation=async(record)=>{
    setSales(previous=>previous.map(sale=>sale._id===record._id?record:sale));
    setCancelTarget(null);setTab('iptal');
    toast.success(record.stock_restoration_pending?'Sipariş iptal edildi. Stok miktarlarını kontrol edin.':record.stock_deductions?.length?'Sipariş iptal edildi. Stoktan düşülen miktarlar geri eklendi.':'Sipariş iptal edildi. Kayıt İptal Edilenler sekmesinde saklanıyor.');
    await load();
  };
  const cancelOrder=async()=>{
    const sale=cancelTarget;
    if(!sale||sale.status!=='tamamlandi'||busyRef.current)return;
    busyRef.current=sale._id;setBusy(sale._id);
    try{
      const response=await api.post(`/sales/${sale._id}/cancel`);
      if(response.data?._id!==sale._id||response.data.status!=='iptal')throw new Error('İptal kaydı doğrulanamadı.');
      await finishCancellation(response.data);
    }catch(error){
      let confirmed=false;
      try{
        const response=await api.get('/sales');
        const record=response.data.find(item=>item._id===sale._id&&item.status==='iptal');
        if(record){await finishCancellation(record);confirmed=true;}
      }catch{/* Keep the confirmation open. The server treats another cancellation request as the same operation. */}
      if(!confirmed)toast.error(error.response?.data?.message||'İptal sonucu doğrulanamadı. Sipariş takibini yenileyip kontrol edin.');
    }finally{busyRef.current=null;setBusy(null);}
  };
  const printOrder=(sale,kind)=>{
    if(!isApprovedWork(sale))return;
    try{openCurtainPrint(sale,kind);}catch(error){toast.error(error.message||'Sipariş çıktısı açılamadı.');}
  };
  const finishDelivery=async(record)=>{
    setSales(previous=>previous.map(sale=>sale._id===record._id?record:sale));
    setDeliverTarget(null);setTab('teslim_edildi');
    toast.success('İş teslim edildi olarak kaydedildi.');
    await load();
  };
  const deliverOrder=async()=>{
    const sale=deliverTarget;
    if(!sale||sale.status!=='tamamlandi'||busyRef.current)return;
    busyRef.current=sale._id;setBusy(sale._id);
    try{
      const response=await api.post(`/sales/${sale._id}/deliver`);
      if(response.data?._id!==sale._id||response.data.status!=='teslim_edildi')throw new Error('Teslim kaydı doğrulanamadı.');
      await finishDelivery(response.data);
    }catch(error){
      let confirmed=false;
      try{
        const response=await api.get('/sales');
        const record=response.data.find(item=>item._id===sale._id&&item.status==='teslim_edildi');
        if(record){await finishDelivery(record);confirmed=true;}
      }catch{/* Keep the confirmation open so an idempotent request can be retried. */}
      if(!confirmed)toast.error(error.response?.data?.message||'Teslim sonucu doğrulanamadı. Sipariş takibini yenileyip kontrol edin.');
    }finally{busyRef.current=null;setBusy(null);}
  };
  return <div className="space-y-5">
    <div><h1 className="text-3xl font-bold">Teklif ve sipariş takibi</h1><p className="mt-2 text-gray-600">Teklifleri, onaylanan siparişleri ve teslim edilen işleri ayrı sekmelerden izleyin.</p></div>
    <section className="bg-white rounded-2xl p-5 border"><label className="flex gap-3 items-center mb-4">Rapor ayı<input aria-label="Rapor ayı" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="border rounded-lg px-3"/></label><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[['Teklif / sipariş toplamı',money(total)],['Onaylanan iş tutarı',money(won)],['Dönüş oranı',`${monthly.length?Math.round(approved.length/monthly.length*100):0}%`],['Teklif / sipariş sayısı',String(monthly.length)]].map(([label,value])=><div key={label}><p className="text-sm text-gray-600">{label}</p><strong className="text-xl">{value}</strong></div>)}</div></section>
    <div className="flex flex-wrap gap-3">{Object.entries(statuses).map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`px-5 rounded-xl border font-semibold ${tab===id?'bg-indigo-600 text-white':'bg-white'}`}>{label} ({sales.filter(x=>x.status===id).length})</button>)}</div>
    <input aria-label="Müşteri veya sipariş ara" placeholder="Müşteri adı, telefon veya sipariş numarası…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full border rounded-xl px-4"/>
    <p className="text-sm text-gray-600">Teslim edilen işler onaylanan iş tutarına dahildir. İptal edilen siparişler aktif toplam ve dönüş hesaplarına dahil edilmez.</p>
    {loading?<p>Yükleniyor…</p>:!matches.length?<div className="bg-white rounded-xl p-8 border">Bu bölümde kayıt bulunmuyor.</div>:<div className="space-y-4">{matches.map(sale=><article key={sale._id} className="bg-white rounded-2xl p-5 border">
      <div className="flex flex-wrap justify-between gap-4">
        <div><h2 className="font-bold text-lg">{sale.customer_name||'Müşteri adı girilmedi'}</h2><p>#{sale._id.slice(-8).toUpperCase()} · {new Date(sale.createdAt).toLocaleDateString('tr-TR')}</p><p>Telefon: {sale.customer_phone||'—'} · Teslim: {sale.delivery_date?new Date(sale.delivery_date).toLocaleDateString('tr-TR'):'—'}</p><p>{sale.delivery_method==='montaj'||sale.delivery_method==='installation'?'Montaj':'Mağaza teslimi'} · {sale.sale_items.length} ürün kalemi</p></div>
        <div className="text-right"><strong className="text-2xl">{money(sale.grand_total)}</strong><p>İskonto %{Number(sale.discount_percent||0).toLocaleString('tr-TR')} · {money(sale.discount_amount)}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#593d29]"><span className="rounded-full border border-[#d8c6ae] bg-[#f4ecdf] px-3 py-2 font-semibold">{measurementLabel(sale)}</span>{sale.measurement_date&&<span>Ölçü tarihi: {new Date(sale.measurement_date).toLocaleDateString('tr-TR')}</span>}{sale.measurement_master&&<span>Usta: {sale.measurement_master}</span>}{Number(sale.measurement_revision)>0&&<span>Revizyon {sale.measurement_revision}</span>}</div>
      {sale.status==='iptal'&&<p className="mt-4 text-gray-600"><strong>Sipariş iptal edildi.</strong>{sale.cancelled_at?` İptal tarihi: ${new Date(sale.cancelled_at).toLocaleString('tr-TR')}.`:''} Kayıt geçmişte korunur.</p>}
      {sale.status==='iptal'&&sale.stock_restoration_pending&&<p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3">Stok iadesi otomatik tamamlanamadı. Ürünlerin stok miktarlarını kontrol edin.</p>}
      {sale.status==='teslim_edildi'&&<p className="mt-4 text-gray-600"><strong>İş teslim edildi.</strong>{sale.delivered_at?` Teslim kaydı: ${new Date(sale.delivered_at).toLocaleString('tr-TR')}.`:''}{sale.delivered_by?.user_username?` Kaydı yapan: ${sale.delivered_by.user_username}.`:''}</p>}
      <div className="flex flex-wrap gap-3 mt-4">
        {(sale.status==='beklemede'||sale.status==='tamamlandi')&&<button disabled={busy!==null} onClick={()=>navigate(`/dashboard/sales/${sale._id}/measurements`)} className="bg-[#80512f] text-[#fffaf3] px-5 rounded-lg font-semibold">Ölçü / Teyit</button>}
        {(sale.status==='beklemede'||sale.status==='kaybedildi')&&<><button disabled={busy!==null} onClick={()=>navigate('/dashboard/pos',{state:{pendingSale:sale}})} className="bg-indigo-600 text-white px-5 rounded-lg">Teklifi aç / Düzenle</button>{sale.status==='beklemede'&&<button disabled={busy!==null} onClick={()=>lose(sale)} className="border px-4 rounded-lg">Kaybedildi olarak işaretle</button>}</>}
        {isApprovedWork(sale)&&<><button disabled={busy!==null} onClick={()=>printOrder(sale,'customer')} className="border px-4 rounded-lg">Müşteri sipariş kağıdı / PDF</button><button disabled={busy!==null} onClick={()=>printOrder(sale,'manufacturing')} className="border px-4 rounded-lg">İmalat planı / PDF</button></>}
        {sale.status==='tamamlandi'&&<><button disabled={busy!==null} onClick={()=>setDeliverTarget(sale)} className="bg-indigo-600 text-white px-5 rounded-lg">Teslim edildi</button><button disabled={busy!==null} onClick={()=>setCancelTarget(sale)} className="border border-red-200 text-red-700 px-4 rounded-lg">Siparişi iptal et</button></>}
      </div>
    </article>)}</div>}
    {cancelTarget&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={event=>{if(event.target===event.currentTarget&&!busyRef.current)setCancelTarget(null);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="cancel-order-heading" aria-describedby="cancel-order-description" className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl" onKeyDown={event=>{if(event.key==='Escape'&&!busyRef.current)setCancelTarget(null);}}>
        <h2 id="cancel-order-heading" className="text-xl font-bold">Siparişi iptal et</h2>
        <p className="mt-3"><strong>{cancelTarget.customer_name||'Müşteri'}</strong> · #{cancelTarget._id.slice(-8).toUpperCase()} · {money(cancelTarget.grand_total)}</p>
        <p id="cancel-order-description" className="mt-3 text-gray-600">Sipariş aktif listeden çıkarılıp İptal Edilenler sekmesinde saklanacak. {Array.isArray(cancelTarget.stock_deductions)?cancelTarget.stock_deductions.length?'Stoktan düşülen miktarlar bir kez geri eklenecek.':'Bu siparişte kayıtlı bir stok düşümü yok.':'Bu eski kayıtta stok düşümü bilgisi yok; iptalden sonra stok kontrolü gerekir.'}</p>
        <div className="flex flex-wrap gap-3 mt-6"><button autoFocus disabled={busy!==null} onClick={()=>setCancelTarget(null)} className="border rounded-lg px-5">Vazgeç</button><button disabled={busy!==null} onClick={cancelOrder} className="bg-red-700 text-white rounded-lg px-5">{busy===cancelTarget._id?'İptal ediliyor…':'Evet, siparişi iptal et'}</button></div>
      </section>
    </div>}
    {deliverTarget&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={event=>{if(event.target===event.currentTarget&&!busyRef.current)setDeliverTarget(null);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="deliver-order-heading" aria-describedby="deliver-order-description" className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl" onKeyDown={event=>{if(event.key==='Escape'&&!busyRef.current)setDeliverTarget(null);}}>
        <h2 id="deliver-order-heading" className="text-xl font-bold">İşi teslim edildi olarak kaydet</h2>
        <p className="mt-3"><strong>{deliverTarget.customer_name||'Müşteri'}</strong> · #{deliverTarget._id.slice(-8).toUpperCase()} · {money(deliverTarget.grand_total)}</p>
        <p id="deliver-order-description" className="mt-3 text-gray-600">İş müşteriye teslim edildi mi? Onayladığınızda Teslim Edilen İşler sekmesine taşınacak; sipariş tutarı, stok ve PDF kayıtları korunacak.</p>
        <div className="flex flex-wrap gap-3 mt-6"><button autoFocus disabled={busy!==null} onClick={()=>setDeliverTarget(null)} className="border rounded-lg px-5">Vazgeç</button><button disabled={busy!==null} onClick={deliverOrder} className="bg-indigo-600 text-white rounded-lg px-5">{busy===deliverTarget._id?'Kaydediliyor…':'Evet, teslim edildi'}</button></div>
      </section>
    </div>}
  </div>;
}
