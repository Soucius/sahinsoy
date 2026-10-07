import {Link} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
export default function HomePage(){
  const signedIn=Boolean(localStorage.getItem('token'));
  return <div className="home-shell"><main className="home-card">
    <img src="/sahinsoy-logo.svg" className="home-brand" alt="Şahinsoy Perde ve Döşemelik · 1987"/>
    <p className="uppercase tracking-widest text-sm mb-4">Mağazanızın sıcaklığı, işinizin düzeni</p>
    <h1 className="home-title">Şahinsoy POS</h1>
    <p className="text-xl mt-5">Satış ve sipariş ekranı</p>
    <Link className="home-button gap-3" to={signedIn?'/dashboard/pos':'/signin'}>{signedIn?'Satış ekranını aç':'Giriş yap'}<ArrowRight size={21}/></Link>
    <div className="home-features">
      <section className="home-feature"><h2>Ürünleriniz bir arada</h2><p>Marka, kategori, renk ve VR bilgileriyle aradığınız ürüne kolayca ulaşın.</p></section>
      <section className="home-feature"><h2>Her ölçü, yerli yerinde</h2><p>Oda ve cepheye göre ölçü girin; pile, dikiş payı ve işçilik hesabını siparişinizde görün.</p></section>
      <section className="home-feature"><h2>Siparişten atölyeye</h2><p>Tekliflerinizi takip edin; onaylanan siparişin müşteri kağıdını ve imalat planını hazırlayın.</p></section>
    </div>
  </main></div>;
}
