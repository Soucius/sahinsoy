import { useState, useEffect } from "react";
import {
  FileText,
  Printer,
  Eye,
  Calendar,
  Loader2,
  Search,
  X,
  Clock,
  CheckCircle,
  ArrowRightLeft,
  Check,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios.js";

const SalesPage = () => {
  const [sales, setSales] = useState([]);
  const [isFetching, setIsFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("tamamlandi");
  const [selectedSale, setSelectedSale] = useState(null);
  const navigate = useNavigate();

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

  const toggleOrderStatus = async (sale, itemIndex) => {
    const updatedItems = [...sale.sale_items];
    updatedItems[itemIndex].is_ordered = !updatedItems[itemIndex].is_ordered;

    try {
      const response = await api.put(`/sales/${sale._id}`, {
        sale_items: updatedItems,
      });
      setSelectedSale(response.data);
      setSales(sales.map((s) => (s._id === sale._id ? response.data : s)));
      toast.success(
        updatedItems[itemIndex].is_ordered
          ? "Sipariş verildi olarak işaretlendi."
          : "Sipariş durumu geri alındı.",
      );
    } catch (error) {
      toast.error("Durum güncellenirken bir hata oluştu.", error);
    }
  };

  const handleTransferToPos = (sale) => {
    navigate("/dashboard/pos", { state: { pendingSale: sale } });
  };

  const handlePrintReceipt = (sale) => {
    const printWindow = window.open("", "", "width=800,height=900");

    const itemsHtml = sale.sale_items
      .map((item) => {
        const productName = item.product?.product_name || "Silinmiş Ürün";
        const dimensions =
          item.width > 0 || item.height > 0
            ? `${item.width}x${item.height} cm`
            : "";
        const roomDetails = [item.room_name, item.facade, item.window_name]
          .filter(Boolean)
          .join(" - ");

        return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            <strong>${productName}</strong>
            ${roomDetails ? `<br><small style="color:#0066cc; font-weight:bold;">📍 ${roomDetails}</small>` : ""}
            ${dimensions ? `<br><small style="color:#666;">Ölçü: ${dimensions}</small>` : ""}
            ${item.item_note ? `<br><small style="color:#888; font-style:italic;">Not: ${item.item_note}</small>` : ""}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity.toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₺${item.unit_price.toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;"><strong>₺${item.total_price.toFixed(2)}</strong></td>
        </tr>
      `;
      })
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Sipariş Makbuzu - ${sale._id}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; color: #333; line-height: 1.6; padding: 40px; }
            .receipt-container { max-width: 700px; margin: 0 auto; border: 1px solid #ddd; padding: 30px; border-radius: 8px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; }
            .info-section { display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 14px; background: #f9f9f9; padding: 15px; border-radius: 8px;}
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th { background-color: #f8f9fa; padding: 10px; text-align: left; border-bottom: 2px solid #333; }
            th.right, td.right { text-align: right; } th.center, td.center { text-align: center; }
            .totals { width: 300px; float: right; }
            .total-line { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
            .grand-total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; margin-top: 10px;}
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h1>Şahinsoy Perde</h1>
              <p>${sale.status === "beklemede" ? "BEKLEYEN SİPARİŞ FORMU" : "SATIŞ FİŞİ"}</p>
            </div>
            
            <div class="info-section">
              <div>
                <strong>İşlem No:</strong> #${sale._id.slice(-8).toUpperCase()}<br>
                <strong>Müşteri:</strong> ${sale.customer_name || "Belirtilmedi"}<br>
                <strong>Telefon:</strong> ${sale.customer_phone || "-"}<br>
                <strong>Adres:</strong> ${sale.customer_address || "-"}
              </div>
              <div style="text-align: right;">
                <strong>Tarih:</strong> ${formatDate(sale.createdAt)}<br>
                <strong>Kasiyer:</strong> ${sale.sold_by?.user_username}<br>
                <strong>Ödeme Tipi:</strong> ${sale.payment_method}
              </div>
            </div>

            <table>
              <thead><tr><th>Ürün ve Detaylar</th><th class="center">Miktar</th><th class="right">Birim Fiyat</th><th class="right">Toplam</th></tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>

            <div class="totals">
              <div class="total-line"><span>Ara Toplam:</span><span>₺${sale.sub_total?.toFixed(2) || sale.grand_total.toFixed(2)}</span></div>
              ${sale.discount_amount > 0 ? `<div class="total-line" style="color:red;"><span>İskonto:</span><span>- ₺${sale.discount_amount.toFixed(2)}</span></div>` : ""}
              ${sale.credit_card_fee > 0 ? `<div class="total-line"><span>Kredi Kartı Farkı:</span><span>+ ₺${sale.credit_card_fee.toFixed(2)}</span></div>` : ""}
              <div class="total-line grand-total"><span>Genel Toplam:</span><span>₺${sale.grand_total.toFixed(2)}</span></div>
            </div>
            <div style="clear: both;"></div>
          </div>
          <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const filteredSales = sales.filter(
    (sale) =>
      sale.status === activeTab &&
      (sale._id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.sold_by?.user_username
          .toLowerCase()
          .includes(searchTerm.toLowerCase())),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            Sipariş ve Satış Yönetimi
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Bekleyen siparişlerinizi yönetin veya geçmiş satışları inceleyin.
          </p>
        </div>
      </div>

      <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex bg-gray-100 p-1 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setActiveTab("tamamlandi")}
            className={`flex-1 sm:px-6 py-2 text-sm font-bold rounded-md transition-colors ${activeTab === "tamamlandi" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <CheckCircle size={16} className="inline mr-2" /> Tamamlananlar
          </button>
          <button
            onClick={() => setActiveTab("beklemede")}
            className={`flex-1 sm:px-6 py-2 text-sm font-bold rounded-md transition-colors ${activeTab === "beklemede" ? "bg-white text-amber-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Clock size={16} className="inline mr-2" /> Bekleyen Siparişler
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <input
            type="text"
            placeholder="İşlem No veya Müşteri ara..."
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-indigo-500 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100 text-sm text-gray-500">
                <th className="px-6 py-4 font-medium">İşlem No & Tarih</th>
                <th className="px-6 py-4 font-medium">Müşteri Bilgisi</th>
                <th className="px-6 py-4 font-medium">Ödeme & Tutar</th>
                <th className="px-6 py-4 font-medium text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isFetching ? (
                <tr>
                  <td colSpan="4" className="text-center py-16">
                    <Loader2
                      className="animate-spin text-indigo-600 mx-auto"
                      size={32}
                    />
                  </td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center py-16 text-gray-500">
                    <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p>Kayıt bulunamadı.</p>
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
                        <span className="font-mono text-sm font-bold text-gray-900">
                          #{sale._id.slice(-8).toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500">
                          <Calendar size={12} className="inline mr-1" />{" "}
                          {formatDate(sale.createdAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-indigo-700 text-sm">
                          {sale.customer_name || "İsimsiz Müşteri"}
                        </span>
                        <span className="text-xs text-gray-500">
                          {sale.customer_phone || "Telefon Yok"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-black text-gray-900">
                          ₺{sale.grand_total.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-500">
                          {sale.payment_method}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                      {sale.status === "beklemede" && (
                        <button
                          onClick={() => handleTransferToPos(sale)}
                          className="text-white bg-amber-500 hover:bg-amber-600 px-3 py-2 rounded-lg transition-colors font-bold text-xs flex items-center gap-1 shadow-sm"
                        >
                          <ArrowRightLeft size={16} /> POS'A AKTAR
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors border border-gray-200 shadow-sm"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => handlePrintReceipt(sale)}
                        className="text-gray-700 hover:bg-gray-100 p-2 rounded-lg transition-colors border border-gray-200 shadow-sm"
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

      {/* DETAY MODALI */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col animate-in zoom-in-95">
            <div
              className={`sticky top-0 px-6 py-4 flex items-center justify-between z-10 text-white ${selectedSale.status === "beklemede" ? "bg-amber-500" : "bg-indigo-600"}`}
            >
              <h2 className="text-lg font-bold flex items-center gap-2">
                {selectedSale.status === "beklemede" ? (
                  <Clock size={20} />
                ) : (
                  <CheckCircle size={20} />
                )}
                İşlem Detayı: #{selectedSale._id.slice(-8).toUpperCase()}
              </h2>
              <button
                onClick={() => setSelectedSale(null)}
                className="text-white/80 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <p className="text-xs text-gray-500">Tarih</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {formatDate(selectedSale.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Müşteri</p>
                  <p className="font-bold text-indigo-700 text-sm">
                    {selectedSale.customer_name || "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Ödeme</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {selectedSale.payment_method}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Genel Toplam</p>
                  <p className="font-black text-indigo-700 text-lg">
                    ₺{selectedSale.grand_total.toFixed(2)}
                  </p>
                </div>
              </div>

              <h3 className="font-bold text-gray-800 mb-3 border-b pb-2">
                Ürünler ve Üretim Durumu
              </h3>
              <div className="space-y-3">
                {selectedSale.sale_items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-gray-100 rounded-lg hover:bg-gray-50 gap-4"
                  >
                    <div className="flex-1">
                      <p className="font-bold text-gray-900 text-sm">
                        {item.product?.product_name || "Silinmiş Ürün"}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1 mb-1">
                        {item.room_name && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                            {item.room_name}
                          </span>
                        )}
                        {item.facade && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                            {item.facade}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        <span>Miktar: {item.quantity.toFixed(2)}</span> |
                        {(item.width > 0 || item.height > 0) && (
                          <span className="text-indigo-600 font-medium ml-1">
                            Ölçü: {item.width}x{item.height}
                          </span>
                        )}
                      </div>
                      {item.item_note && (
                        <p className="text-[11px] text-gray-500 italic mt-0.5">
                          Not: {item.item_note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="font-black text-gray-900">
                        ₺{item.total_price.toFixed(2)}
                      </div>

                      <button
                        onClick={() => toggleOrderStatus(selectedSale, idx)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${item.is_ordered ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"}`}
                      >
                        {item.is_ordered ? (
                          <Check size={14} />
                        ) : (
                          <X size={14} />
                        )}
                        {item.is_ordered ? "Sipariş Verildi" : "Beklemede"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPage;
