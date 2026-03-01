import { useState, useEffect, useRef } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Scissors,
  Loader2,
  X,
  CheckCircle,
  Package,
  Layers,
  Filter,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const PosPage = () => {
  // Veri State'leri
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);

  // Filtreleme State'leri
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Sepet ve Ödeme State'leri
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Nakit");
  const [isProcessing, setIsProcessing] = useState(false);

  // Modal ve Özelleştirme State'leri
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [customization, setCustomization] = useState({
    quantity: 1,
    width: "",
    height: "",
    selectedExtraIndex: -1, // -1 demek ekstra seçenek seçilmedi demek
  });

  const searchInputRef = useRef(null);

  // Başlangıç verilerini çek
  useEffect(() => {
    fetchFilters();
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);

  // Filtreler veya arama değiştiğinde ürünleri getir
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchProducts();
    }, 400); // Kullanıcı yazarken sürekli istek atmasını önler
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, filterCategory, filterBrand]);

  const fetchFilters = async () => {
    try {
      const [catsRes, brandsRes] = await Promise.all([
        api.get("/categories"),
        api.get("/brands"),
      ]);
      setCategories(catsRes.data);
      setBrands(brandsRes.data);
    } catch (error) {
      toast.error("Filtre verileri yüklenemedi.", error);
    }
  };

  const fetchProducts = async () => {
    setIsSearching(true);
    try {
      const response = await api.get("/products", {
        params: {
          search: searchQuery,
          category: filterCategory,
          brand: filterBrand,
          limit: 50,
        },
      });
      const foundProducts = response.data.products;
      setProducts(foundProducts);

      // Sadece barkod okutulduğunda ve tek sonuç bulunduğunda otomatik modal aç
      if (
        searchQuery.length > 5 &&
        foundProducts.length === 1 &&
        foundProducts[0].product_barcode === searchQuery
      ) {
        openCustomizationModal(foundProducts[0]);
        setSearchQuery("");
      }
    } catch (error) {
      toast.error("Ürünler yüklenirken hata oluştu.", error);
    } finally {
      setIsSearching(false);
    }
  };

  // Barkod Okuyucu Enter Yakalama
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && searchQuery.trim() !== "") {
      fetchProducts();
    }
  };

  const openCustomizationModal = (product) => {
    setSelectedProduct(product);
    setCustomization({
      quantity: 1,
      width: "",
      height: "",
      selectedExtraIndex: -1,
    });
  };

  // AKILLI HESAPLAMA MOTORU
  const calculateDetails = () => {
    if (!selectedProduct)
      return { finalQty: 0, unitPrice: 0, totalPrice: 0, appliedRule: "" };

    let finalQty = 1;
    let appliedRule = "";
    const calcType = selectedProduct.calculation_type || "adet";
    const w = Number(customization.width) || 0;
    const h = Number(customization.height) || 0;

    // 1. Miktar (Adet / m2 / mt) Hesaplaması
    if (calcType === "adet") {
      finalQty = Number(customization.quantity) || 1;
    } else if (calcType === "m2") {
      let m2 = (w * h) / 10000; // cm'yi metrekareye çevir

      if (m2 > 0) {
        // Minimum m2 Kuralı
        if (selectedProduct.min_m2 > 0 && m2 < selectedProduct.min_m2) {
          m2 = selectedProduct.min_m2;
          appliedRule = `Min. ${selectedProduct.min_m2} m² kuralı uygulandı.`;
        }
        // Yuvarlama Kuralı
        else if (selectedProduct.rounding_step > 0) {
          const step = selectedProduct.rounding_step;
          const rounded = Math.ceil(m2 / step) * step;
          if (rounded !== m2) {
            appliedRule = `${m2.toFixed(2)} m², ${rounded.toFixed(2)} m²'ye yuvarlandı.`;
            m2 = rounded;
          }
        }
      }
      finalQty = m2 * (Number(customization.quantity) || 1);
    } else if (calcType === "mt") {
      let mt = w / 100; // cm'yi metreye çevir
      finalQty = mt * (Number(customization.quantity) || 1);
    }

    // 2. Fiyat Hesaplaması (Ekstra seçenekler birim fiyata eklenir)
    let extraPrice = 0;
    let extraOptionName = "";
    if (
      customization.selectedExtraIndex >= 0 &&
      selectedProduct.extra_options[customization.selectedExtraIndex]
    ) {
      extraPrice =
        selectedProduct.extra_options[customization.selectedExtraIndex]
          .price_impact;
      extraOptionName =
        selectedProduct.extra_options[customization.selectedExtraIndex]
          .option_name;
    }

    const unitPrice = selectedProduct.sale_price + extraPrice;
    const totalPrice = finalQty * unitPrice;

    return { finalQty, unitPrice, totalPrice, appliedRule, extraOptionName };
  };

  const addToCart = () => {
    const { finalQty, unitPrice, totalPrice, extraOptionName } =
      calculateDetails();

    if (finalQty <= 0) {
      toast.error("Lütfen geçerli ölçüler giriniz.");
      return;
    }

    if (selectedProduct.stock_quantity < finalQty) {
      toast.error(
        `Yetersiz stok! Sadece ${selectedProduct.stock_quantity} ${selectedProduct.product_unit?.unit_code} mevcut.`,
      );
      return;
    }

    const cartItem = {
      ...selectedProduct,
      cartItemId: Date.now(),
      sale_quantity: finalQty, // Hesaplanmış son miktar (Örn: 3.5 m2)
      sale_width: Number(customization.width) || 0,
      sale_height: Number(customization.height) || 0,
      unit_price: unitPrice, // Ekstralar dahil fiyat
      item_total: totalPrice,
      extra_option_name: extraOptionName, // Fişte göstermek için
      calc_type: selectedProduct.calculation_type || "adet",
    };

    setCart([...cart, cartItem]);
    setSelectedProduct(null);
    toast.success(`${selectedProduct.product_name} sepete eklendi.`);

    if (searchInputRef.current) searchInputRef.current.focus();
  };

  const removeFromCart = (cartItemId) => {
    setCart(cart.filter((item) => item.cartItemId !== cartItemId));
  };

  const grandTotal = cart.reduce((total, item) => total + item.item_total, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setIsProcessing(true);
    try {
      const sale_items = cart.map((item) => ({
        product: item._id,
        quantity: item.sale_quantity,
        width: item.sale_width,
        height: item.sale_height,
        unit_price: item.unit_price,
        total_price: item.item_total,
      }));

      await api.post("/sales", {
        sale_items,
        grand_total: grandTotal,
        payment_method: paymentMethod,
      });

      toast.success("Satış başarıyla tamamlandı!");
      setCart([]);
      setPaymentMethod("Nakit");
      fetchProducts(); // Stokları güncellemek için listeyi yenile
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Satış işlemi başarısız oldu.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Dinamik Hesaplanan Verileri Al
  const calcData = selectedProduct ? calculateDetails() : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-[1400px] mx-auto h-[calc(100vh-8rem)]">
      {/* SOL TARAF: ÜRÜN VİTRİNİ VE FİLTRELER */}
      <div className="flex-1 flex flex-col gap-6 overflow-hidden">
        {/* Arama ve Filtreleme Barı */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              ref={searchInputRef}
              type="text"
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-colors font-mono text-sm"
              placeholder="Barkod okutun veya isim yazın..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="w-full sm:w-40 relative">
            <Layers
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={16}
            />
            <select
              className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 hover:bg-white transition-colors appearance-none"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">Tüm Ktg.</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.category_name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-40 relative">
            <Filter
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={16}
            />
            <select
              className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 hover:bg-white transition-colors appearance-none"
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
            >
              <option value="">Tüm Markalar</option>
              {brands.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.brand_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Ürün Grid (Kartlar) */}
        <div className="flex-1 overflow-y-auto pr-2">
          {isSearching ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="animate-spin text-indigo-500" size={40} />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col justify-center items-center h-full text-gray-400">
              <Package size={64} className="mb-4 opacity-50" />
              <p className="text-lg">Ürün bulunamadı.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
              {products.map((product) => (
                <div
                  key={product._id}
                  onClick={() => openCustomizationModal(product)}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-400 hover:shadow-md cursor-pointer transition-all overflow-hidden flex flex-col group"
                >
                  <div className="aspect-square bg-gray-50 flex items-center justify-center relative overflow-hidden">
                    {product.product_image ? (
                      <img
                        src={product.product_image}
                        alt={product.product_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <Package className="text-gray-300" size={40} />
                    )}
                    <span className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm text-xs font-bold px-2 py-1 rounded-md text-gray-700 shadow-sm uppercase">
                      {product.calculation_type}
                    </span>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <span className="text-xs text-indigo-600 font-semibold mb-1 truncate">
                      {product.product_brand?.brand_name}
                    </span>
                    <h3 className="font-bold text-gray-900 text-sm leading-tight line-clamp-2 mb-2">
                      {product.product_name}
                    </h3>
                    <div className="mt-auto flex items-end justify-between">
                      <div className="text-xs text-gray-500">
                        Stok:{" "}
                        <span
                          className={
                            product.stock_quantity > 0
                              ? "text-green-600 font-bold"
                              : "text-red-600 font-bold"
                          }
                        >
                          {product.stock_quantity}
                        </span>
                      </div>
                      <div className="font-black text-indigo-700">
                        ₺{product.sale_price}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SAĞ TARAF: SEPET VE SATIŞ BİTİRME */}
      <div className="w-full lg:w-[450px] bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full flex-shrink-0">
        <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="text-indigo-600" />
            Müşteri Sepeti
          </h2>
          <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {cart.length} Ürün
          </span>
        </div>

        {/* Sepet İçeriği */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <ShoppingCart size={48} className="mb-4 text-gray-200" />
              <p>Sepetiniz şu an boş.</p>
              <p className="text-sm mt-1">Sol taraftan ürün seçin.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.cartItemId}
                className="flex gap-3 p-3 bg-white rounded-xl border border-gray-200 shadow-sm relative group"
              >
                <div className="flex-1">
                  <h4 className="font-bold text-gray-900 text-sm leading-tight pr-6">
                    {item.product_name}
                  </h4>
                  <div className="text-xs text-gray-500 mt-1.5 space-y-1">
                    {/* Ölçü Detayları */}
                    {(item.calc_type === "m2" || item.calc_type === "mt") && (
                      <p className="text-indigo-600 font-medium bg-indigo-50 inline-block px-1.5 py-0.5 rounded">
                        Ölçü: {item.sale_width}cm{" "}
                        {item.sale_height > 0 ? `x ${item.sale_height}cm` : ""}
                      </p>
                    )}

                    {/* Ekstra Seçenek Detayı */}
                    {item.extra_option_name && (
                      <p className="text-amber-600 font-medium">
                        Seçenek: {item.extra_option_name}
                      </p>
                    )}

                    <div className="flex justify-between items-center mt-1">
                      <p>
                        Miktar:{" "}
                        <span className="font-bold text-gray-700">
                          {item.sale_quantity.toFixed(2)}{" "}
                          {item.product_unit?.unit_code}
                        </span>
                      </p>
                      <p>Br: ₺{item.unit_price}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button
                    onClick={() => removeFromCart(item.cartItemId)}
                    className="text-red-400 hover:text-red-600 p-1 bg-gray-50 rounded-md hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                  <p className="font-black text-gray-900 text-base">
                    ₺{item.item_total.toFixed(2)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Ödeme Alanı (Alt Kısım) */}
        <div className="p-5 border-t border-gray-100 bg-gray-50/50 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
              Ödeme Yöntemi
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPaymentMethod("Nakit")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all ${paymentMethod === "Nakit" ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
              >
                <Banknote size={18} /> Nakit
              </button>
              <button
                onClick={() => setPaymentMethod("Kredi Kartı")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all ${paymentMethod === "Kredi Kartı" ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
              >
                <CreditCard size={18} /> Kredi Kartı
              </button>
            </div>
          </div>

          <div className="flex items-end justify-between pt-3 border-t border-gray-200">
            <span className="text-gray-500 font-medium text-lg">Toplam</span>
            <span className="text-4xl font-black text-indigo-600">
              ₺{grandTotal.toFixed(2)}
            </span>
          </div>

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isProcessing}
            className="w-full py-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-xl font-black text-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200 mt-2"
          >
            {isProcessing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CheckCircle />
            )}
            {isProcessing ? "İŞLENİYOR..." : "SATIŞI ONAYLA"}
          </button>
        </div>
      </div>

      {/* ÜRÜN ÖZELLEŞTİRME MODALI (AKILLI HESAPLAMA) */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-indigo-600 px-6 py-5 flex justify-between items-center text-white">
              <div>
                <h3 className="font-bold text-xl flex items-center gap-2">
                  <Scissors size={20} /> Ölçü ve Detaylar
                </h3>
                <p className="text-indigo-200 text-sm mt-0.5">
                  {selectedProduct.product_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="text-indigo-200 hover:text-white bg-indigo-700/50 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Hesaplama Moduna Göre Inputlar */}
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-4">
                {/* m2 veya mt ise En/Boy göster */}
                {(selectedProduct.calculation_type === "m2" ||
                  selectedProduct.calculation_type === "mt") && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">
                        En (Genişlik) cm *
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="w-full py-3 px-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold text-lg text-center"
                        value={customization.width}
                        onChange={(e) =>
                          setCustomization({
                            ...customization,
                            width: e.target.value,
                          })
                        }
                      />
                    </div>
                    {selectedProduct.calculation_type === "m2" && (
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">
                          Boy (Yükseklik) cm *
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="w-full py-3 px-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold text-lg text-center"
                          value={customization.height}
                          onChange={(e) =>
                            setCustomization({
                              ...customization,
                              height: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Adet veya Çarpan Miktarı */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    {selectedProduct.calculation_type === "adet"
                      ? "Satış Adedi *"
                      : "Bu Ölçüden Kaç Adet? *"}
                  </label>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() =>
                        setCustomization({
                          ...customization,
                          quantity: Math.max(1, customization.quantity - 1),
                        })
                      }
                      className="p-4 bg-gray-200 hover:bg-gray-300 rounded-l-xl transition-colors"
                    >
                      <Minus size={18} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      className="w-full text-center py-3 border-y border-gray-300 font-black text-xl bg-white"
                      value={customization.quantity}
                      onChange={(e) =>
                        setCustomization({
                          ...customization,
                          quantity: e.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setCustomization({
                          ...customization,
                          quantity: Number(customization.quantity) + 1,
                        })
                      }
                      className="p-4 bg-gray-200 hover:bg-gray-300 rounded-r-xl transition-colors"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Ekstra Seçenekler (Pile vb.) */}
              {selectedProduct.extra_options &&
                selectedProduct.extra_options.length > 0 && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Pile / Ekstra İşçilik Seçimi
                    </label>
                    <select
                      className="w-full py-3 px-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white font-medium"
                      value={customization.selectedExtraIndex}
                      onChange={(e) =>
                        setCustomization({
                          ...customization,
                          selectedExtraIndex: Number(e.target.value),
                        })
                      }
                    >
                      <option value={-1}>
                        Düz Dikim / Ekstrasız (Standart Fiyat)
                      </option>
                      {selectedProduct.extra_options.map((opt, index) => (
                        <option key={index} value={index}>
                          {opt.option_name} (+₺{opt.price_impact} / br)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {/* Canlı Hesaplama Sonuç Ekranı */}
              <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Hesaplanan Miktar:</span>
                  <span className="font-bold text-gray-900">
                    {calcData.finalQty.toFixed(2)}{" "}
                    {selectedProduct.product_unit?.unit_code}
                  </span>
                </div>
                {calcData.appliedRule && (
                  <div className="text-xs text-amber-600 font-medium bg-amber-50 p-2 rounded-lg border border-amber-100">
                    ⚠️ {calcData.appliedRule}
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Uygulanan Birim Fiyat:</span>
                  <span className="font-bold text-gray-900">
                    ₺{calcData.unitPrice.toFixed(2)}
                  </span>
                </div>
                <div className="border-t border-indigo-200 pt-2 mt-1 flex justify-between items-center">
                  <span className="text-indigo-900 font-bold">
                    TOPLAM TUTAR:
                  </span>
                  <span className="text-2xl font-black text-indigo-700">
                    ₺{calcData.totalPrice.toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                onClick={addToCart}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-indigo-200"
              >
                <ShoppingCart size={22} />
                SEPETE EKLE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosPage;
