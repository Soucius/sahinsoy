import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { productionApi } from '../libs/productionApi';
export default function ProductionSigninPage() {
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const { data } = await productionApi().post('/staff/login', { name: name.trim(), password });
      localStorage.setItem('production_token', data.token); setPassword(''); navigate('/uretim', { replace: true });
    } catch (error) { toast.error(error.response?.data?.message || 'Giriş yapılamadı. Bağlantınızı kontrol edin.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center p-5">
    <section className="w-full max-w-md rounded-3xl border border-[#d8c5ae] bg-[#fffcf6] p-7 shadow-sm">
      <strong className="brand-name text-center">ŞAHİNSOY</strong>
      <h1 className="text-3xl font-bold text-center mt-4">Üretim paneli</h1>
      <p className="text-center mt-3 mb-7 text-[#78634f]">Size atanan kesim, dikim ve montaj işleri.</p>
      <form onSubmit={submit} className="space-y-5">
        <label className="block font-semibold">Ad soyad<input className="block w-full border rounded-xl px-4 mt-2" autoComplete="username" autoCapitalize="words" required maxLength={80} placeholder="Örn. Nevzat Bilen" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block font-semibold">Parola<input className="block w-full border rounded-xl px-4 mt-2" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="w-full rounded-xl bg-[#754b2e] text-white font-bold px-5" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Üretim paneline gir'}</button>
      </form>
      <p className="text-sm text-[#78634f] mt-5">Hesabınızı mağaza yöneticiniz açar. Giriş sorunu yaşarsanız yöneticinize bildirin.</p>
    </section>
  </main>;
}
