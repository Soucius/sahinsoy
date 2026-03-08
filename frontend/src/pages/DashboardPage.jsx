import { useState, useEffect } from "react";
import {
  TrendingUp,
  ShoppingCart,
  Package,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Calendar,
} from "lucide-react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios";

const DashboardPage = () => {
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalSalesCount: 0,
    totalProducts: 0,
    lowStockProducts: [],
    recentSales: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get("/dashboard/stats");
      setStats(response.data);
    } catch (error) {
      toast.error("İstatistikler yüklenirken hata oluştu.", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const options = {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    };
    return new Date(dateString).toLocaleDateString("tr-TR", options);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          Sisteme Hoş Geldiniz
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          İşletmenizin güncel durumunu buradan takip edebilirsiniz.
        </p>
      </div>

      {/* İSTATİSTİK KARTLARI */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Ciro Kartı */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:-translate-y-1">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <TrendingUp size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Toplam Ciro</p>
            <h3 className="text-2xl font-black text-gray-900">
              ₺
              {stats.totalRevenue.toLocaleString("tr-TR", {
                minimumFractionDigits: 2,
              })}
            </h3>
          </div>
        </div>

        {/* Satış Sayısı Kartı */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:-translate-y-1">
          <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShoppingCart size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Tamamlanan İşlem
            </p>
            <h3 className="text-2xl font-black text-gray-900">
              {stats.totalSalesCount} Adet
            </h3>
          </div>
        </div>

        {/* Ürün Çeşidi Kartı */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:-translate-y-1">
          <div className="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Package size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Kayıtlı Ürün Çeşidi
            </p>
            <h3 className="text-2xl font-black text-gray-900">
              {stats.totalProducts} Çeşit
            </h3>
          </div>
        </div>

        {/* Kritik Stok Kartı */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:-translate-y-1">
          <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={28} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">
              Kritik Stok Uyarısı
            </p>
            <h3 className="text-2xl font-black text-gray-900">
              {stats.lowStockProducts.length} Ürün
            </h3>
          </div>
        </div>
      </div>

      {/* ALT BÖLÜM: TABLOLAR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Son Satışlar (Sol Taraf - Geniş) */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">
              Son Satış İşlemleri
            </h2>
            <Link
              to="/dashboard/sales"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              Tümünü Gör <ArrowRight size={16} />
            </Link>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">İşlem No & Tarih</th>
                  <th className="px-6 py-3 font-medium">Kasiyer</th>
                  <th className="px-6 py-3 font-medium text-right">Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.recentSales.length === 0 ? (
                  <tr>
                    <td
                      colSpan="3"
                      className="px-6 py-8 text-center text-gray-500"
                    >
                      Henüz satış yapılmamış.
                    </td>
                  </tr>
                ) : (
                  stats.recentSales.map((sale) => (
                    <tr
                      key={sale._id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-sm font-bold text-gray-900">
                            #{sale._id.slice(-8).toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Calendar size={12} /> {formatDate(sale.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {sale.sold_by?.user_username || "Bilinmiyor"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-bold text-indigo-700">
                          ₺{sale.grand_total.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kritik Stoklar (Sağ Taraf - Dar) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="text-rose-500" size={20} /> Kritik
              Stoklar
            </h2>
          </div>

          <div className="flex-1 p-4">
            {stats.lowStockProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 py-8">
                <Package
                  size={40}
                  className="mb-2 opacity-50 text-emerald-500"
                />
                <p className="text-sm text-center">
                  Tüm stoklarınız yeterli seviyede.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.lowStockProducts.map((product) => (
                  <div
                    key={product._id}
                    className="flex justify-between items-center p-3 border border-rose-100 bg-rose-50/50 rounded-xl"
                  >
                    <div className="truncate pr-4">
                      <p
                        className="text-sm font-bold text-gray-900 truncate"
                        title={product.product_name}
                      >
                        {product.product_name}
                      </p>
                      <p className="text-xs text-rose-600 mt-0.5 font-medium">
                        Stok tükenmek üzere!
                      </p>
                    </div>
                    <div className="bg-white border border-rose-200 text-rose-700 font-bold px-3 py-1.5 rounded-lg text-sm whitespace-nowrap">
                      {product.stock_quantity} {product.product_unit?.unit_code}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
