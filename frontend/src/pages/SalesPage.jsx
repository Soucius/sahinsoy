import { useState, useEffect } from "react";
import {
  FileText,
  Printer,
  Eye,
  Calendar,
  CreditCard,
  Banknote,
  User,
  Loader2,
  Search,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const SalesPage = () => {
  const [sales, setSales] = useState([]);
  const [isFetching, setIsFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Detay Modalı için State
  const [selectedSale, setSelectedSale] = useState(null);

  useEffect(() => {
    fetchSales();
  }, []);

  const fetchSales = async () => {
    try {
      const response = await api.get("/sales");
      setSales(response.data);
    } catch (error) {
      toast.error("Satış geçmişi yüklenirken hata oluştu.", error);
    } finally {
      setIsFetching(false);
    }
  };

  // Tarih formatlayıcı yardımcı fonksiyon
  const formatDate = (dateString) => {
    const options = {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return new Date(dateString).toLocaleDateString("tr-TR", options);
  };

  // Fiş / PDF Yazdırma Fonksiyonu
  const handlePrintReceipt = (sale) => {
    const printWindow = window.open("", "", "width=800,height=900");

    // Satılan ürünlerin HTML tablosu
    const itemsHtml = sale.sale_items
      .map((item) => {
        const productName = item.product?.product_name || "Silinmiş Ürün";
        const dimensions =
          item.width > 0 || item.height > 0
            ? `<br><small style="color:#666;">Ölçü: ${item.width}x${item.height} cm</small>`
            : "";
        return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            <strong>${productName}</strong>
            ${dimensions}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₺${item.unit_price.toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;"><strong>₺${item.total_price.toFixed(2)}</strong></td>
        </tr>
      `;
      })
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Satış Fişi - ${sale._id}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.6; padding: 40px; }
            .receipt-container { max-width: 700px; margin: 0 auto; border: 1px solid #ddd; padding: 30px; border-radius: 8px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; color: #111; text-transform: uppercase; letter-spacing: 2px; }
            .header p { margin: 5px 0 0; color: #666; font-size: 14px; }
            .info-section { display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 14px; }
            table { w-full; border-collapse: collapse; margin-bottom: 30px; width: 100%; }
            th { background-color: #f8f9fa; padding: 10px; text-align: left; border-bottom: 2px solid #ddd; font-weight: bold; }
            th.right, td.right { text-align: right; }
            th.center, td.center { text-align: center; }
            .totals { width: 300px; float: right; border-top: 2px solid #333; padding-top: 15px; }
            .total-line { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 16px; }
            .grand-total { font-size: 20px; font-weight: bold; color: #000; border-top: 1px solid #ddd; padding-top: 10px; }
            .footer { clear: both; text-align: center; margin-top: 50px; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h1>Şahinsoy Perde</h1>
              <p>Müşteri Satış Fişi / Bilgilendirme Makbuzu</p>
            </div>
            
            <div class="info-section">
              <div>
                <strong>İşlem No:</strong> #${sale._id.slice(-8).toUpperCase()}<br>
                <strong>Kasiyer:</strong> ${sale.sold_by?.user_username || "Bilinmiyor"}
              </div>
              <div style="text-align: right;">
                <strong>Tarih:</strong> ${formatDate(sale.createdAt)}<br>
                <strong>Ödeme Tipi:</strong> ${sale.payment_method}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Ürün Açıklaması</th>
                  <th class="center">Miktar</th>
                  <th class="right">Birim Fiyat</th>
                  <th class="right">Toplam</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="totals">
              <div class="total-line grand-total">
                <span>Genel Toplam:</span>
                <span>₺${sale.grand_total.toFixed(2)}</span>
              </div>
            </div>

            <div class="footer">
              <p>Bizi tercih ettiğiniz için teşekkür ederiz!</p>
              <p>Bu belge mali değer taşımaz, bilgilendirme amaçlıdır.</p>
            </div>
          </div>
          <script>
            setTimeout(() => {
              window.print();
              window.close();
            }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Arama filtresi (Kasiyer adı, İşlem ID veya Ödeme tipine göre)
  const filteredSales = sales.filter(
    (sale) =>
      sale._id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sale.sold_by?.user_username
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      sale.payment_method.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Satış Geçmişi</h1>
          <p className="text-sm text-gray-500 mt-1">
            Geçmiş tüm satışları inceleyin ve makbuz çıktılarını alın.
          </p>
        </div>
      </div>

      {/* Arama Barı */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="relative max-w-md">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="İşlem No, Kasiyer veya Ödeme Tipi ara..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-indigo-500 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Satışlar Tablosu */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100 text-sm text-gray-500">
                <th className="px-6 py-4 font-medium">İşlem No & Tarih</th>
                <th className="px-6 py-4 font-medium">Kasiyer</th>
                <th className="px-6 py-4 font-medium">Ödeme & İçerik</th>
                <th className="px-6 py-4 font-medium">Toplam Tutar</th>
                <th className="px-6 py-4 font-medium text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isFetching ? (
                <tr>
                  <td colSpan="5" className="text-center py-16">
                    <Loader2
                      className="animate-spin text-indigo-600 mx-auto"
                      size={32}
                    />
                    <p className="text-gray-500 mt-2">Satışlar yükleniyor...</p>
                  </td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-gray-500">
                    <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p>Satış kaydı bulunamadı.</p>
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr
                    key={sale._id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-sm font-semibold text-indigo-600">
                          #{sale._id.slice(-8).toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar size={14} /> {formatDate(sale.createdAt)}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                          <User size={16} />
                        </div>
                        {sale.sold_by?.user_username || "Bilinmiyor"}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold w-fit ${sale.payment_method === "Nakit" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}
                        >
                          {sale.payment_method === "Nakit" ? (
                            <Banknote size={14} />
                          ) : (
                            <CreditCard size={14} />
                          )}
                          {sale.payment_method}
                        </span>
                        <span className="text-xs text-gray-500">
                          {sale.sale_items.length} Çeşit Ürün
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="text-lg font-black text-gray-900">
                        ₺{sale.grand_total.toFixed(2)}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors mr-2 border border-transparent hover:border-indigo-100"
                        title="İçeriği Gör"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => handlePrintReceipt(sale)}
                        className="text-gray-700 hover:bg-gray-100 p-2 rounded-lg transition-colors border border-gray-200 hover:border-gray-300 shadow-sm"
                        title="Fiş / PDF Çıktısı Al"
                      >
                        <Printer size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSale && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col animate-in zoom-in-95">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FileText className="text-indigo-600" />
                İşlem Detayı: #{selectedSale._id.slice(-8).toUpperCase()}
              </h2>

              <button
                onClick={() => setSelectedSale(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Tarih</p>

                  <p className="font-semibold text-gray-900 text-sm">
                    {formatDate(selectedSale.createdAt)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">Kasiyer</p>

                  <p className="font-semibold text-gray-900 text-sm">
                    {selectedSale.sold_by?.user_username}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">Ödeme Yöntemi</p>

                  <p className="font-semibold text-gray-900 text-sm">
                    {selectedSale.payment_method}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">Genel Toplam</p>

                  <p className="font-bold text-indigo-700 text-lg">
                    ₺{selectedSale.grand_total.toFixed(2)}
                  </p>
                </div>
              </div>

              <h3 className="font-bold text-gray-800 mb-3">
                Satın Alınan Ürünler
              </h3>

              <div className="space-y-3">
                {selectedSale.sale_items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center p-3 border border-gray-100 rounded-lg hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-bold text-gray-900 text-sm">
                        {item.product?.product_name || "Silinmiş Ürün"}
                      </p>

                      <div className="text-xs text-gray-500 mt-1 flex gap-3">
                        <span>Miktar: {item.quantity}</span>

                        {(item.width > 0 || item.height > 0) && (
                          <span className="text-indigo-600 font-medium">
                            Ölçü: {item.width}x{item.height}
                          </span>
                        )}

                        <span>Birim: ₺{item.unit_price}</span>
                      </div>
                    </div>

                    <div className="font-black text-gray-900">
                      ₺{item.total_price.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => handlePrintReceipt(selectedSale)}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                >
                  <Printer size={18} />
                  Fiş Yazdır / PDF İndir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPage;
