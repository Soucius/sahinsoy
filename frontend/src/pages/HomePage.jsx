import { Link } from "react-router-dom";
import { Store, MonitorPlay, FileText, ArrowRight } from "lucide-react";

const HomePage = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <nav className="w-full px-8 py-6 flex justify-between items-center bg-white shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xl">Ş</span>
          </div>

          <span className="text-xl font-bold text-gray-800 tracking-tight">
            Şahinsoy Perde
          </span>
        </div>

        <div className="flex gap-4">
          <Link
            to="/signin"
            className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
          >
            Giriş Yap
          </Link>

          <Link
            to="/signup"
            className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Kayıt Ol
          </Link>
        </div>
      </nav>

      <main className="flex-grow flex flex-col items-center justify-center px-4 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 tracking-tight">
          Perde Yönetiminde <br className="hidden md:block" />
          <span className="text-indigo-600">Yeni Nesil Çözüm</span>
        </h1>

        <p className="text-lg text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
          Tüm ürünlerinizi tek bir noktadan yönetin, el terminali entegrasyonlu
          gelişmiş POS ekranı ile satışlarınızı hızlandırın ve saniyeler içinde
          PDF faturalar/raporlar oluşturun.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            to="/signin"
            className="flex items-center justify-center gap-2 px-8 py-3.5 text-base font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg"
          >
            Sisteme Giriş Yap
            <ArrowRight size={18} />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24 max-w-5xl mx-auto">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow text-left">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-6">
              <Store className="text-indigo-600" size={24} />
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-3">
              Gelişmiş Stok Takibi
            </h3>

            <p className="text-gray-600 leading-relaxed text-sm">
              Kumaş türü, en, boy gibi tüm varyasyonlarıyla ürünlerinizi sisteme
              ekleyin ve stok durumlarını anlık olarak izleyin.
            </p>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow text-left">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-6">
              <MonitorPlay className="text-indigo-600" size={24} />
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-3">
              Akıllı POS Ekranı
            </h3>

            <p className="text-gray-600 leading-relaxed text-sm">
              El terminali ile okutulan ürünleri ekranda özelleştirin, müşteri
              özel siparişlerini saniyeler içinde satışa dönüştürün.
            </p>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow text-left">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-6">
              <FileText className="text-indigo-600" size={24} />
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-3">
              PDF Çıktı ve Raporlama
            </h3>

            <p className="text-gray-600 leading-relaxed text-sm">
              Tamamlanan satışların tüm detaylarını görüntüleyin,
              müşterilerinize özel veya arşiviniz için anında PDF raporlar
              oluşturun.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
