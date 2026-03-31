import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Loader2,
  X,
  CheckCircle,
  Package,
  MapPin,
  Home,
  ArrowRight,
  ArrowLeft,
  AlignLeft,
  User,
  Phone,
  Calendar,
  PauseCircle,
  Clock,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios.js";

const PRESET_ROOMS = [
  "Salon",
  "Yatak Odası",
  "Oturma Odası",
  "Çocuk Odası",
  "Mutfak",
  "Balkon",
  "Misafir Odası",
];
const PRESET_FACADES = [
  "Kuzey Cephe",
  "Güney Cephe",
  "Doğu Cephe",
  "Batı Cephe",
];
const PRESET_WINDOWS = [
  "Fransız Cam",
  "Standart Pencere",
  "Sürgülü Cam",
  "Kemerli Cam",
  "Boydan Cam",
];

const PosPage = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Nakit");
  const [discount, setDiscount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const [existingSaleId, setExistingSaleId] = useState(null);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [customization, setCustomization] = useState({
    quantity: 1,
    width: "",
    height: "",
    selectedExtraIndex: -1,
    room_name: "",
    facade: "",
    window_name: "",
    item_note: "",
  });

  const [checkoutModalType, setCheckoutModalType] = useState(null);
  const [customerInfo, setCustomerInfo] = useState({
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    delivery_date: "",
    sale_note: "",
  });

  const searchInputRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

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

  const fetchProducts = useCallback(async () => {
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

      if (
        searchQuery.length > 5 &&
        foundProducts.length === 1 &&
        foundProducts[0].product_barcode === searchQuery
      ) {
        openWizard(foundProducts[0]);
        setSearchQuery("");
      }
    } catch (error) {
      toast.error("Hata oluştu.", error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, filterCategory, filterBrand]);

  useEffect(() => {
    fetchFilters();
    if (searchInputRef.current) searchInputRef.current.focus();

    if (location.state?.pendingSale) {
      const sale = location.state.pendingSale;
      setExistingSaleId(sale._id);

      setCustomerInfo({
        customer_name: sale.customer_name || "",
        customer_phone: sale.customer_phone || "",
        customer_address: sale.customer_address || "",
        delivery_date: sale.delivery_date
          ? sale.delivery_date.split("T")[0]
          : "",
        sale_note: sale.sale_note || "",
      });
      setDiscount(sale.discount_amount || 0);
      setPaymentMethod(sale.payment_method || "Nakit");

      const mappedCart = sale.sale_items.map((item, index) => ({
        _id: item.product._id,
        product_name: item.product.product_name,
        product_unit: item.product.product_unit,
        calculation_type: item.product.calculation_type,
        stock_quantity: item.product.stock_quantity,
        sale_price: item.product.sale_price,

        cartItemId: Date.now() + index,
        sale_quantity: item.quantity,
        sale_width: item.width,
        sale_height: item.height,
        unit_price: item.unit_price,
        item_total: item.total_price,
        room_name: item.room_name || "",
        facade: item.facade || "",
        window_name: item.window_name || "",
        item_note: item.item_note || "",
        calc_type: item.product.calculation_type || "adet",
      }));

      setCart(mappedCart);
      toast.success("Bekleyen sipariş başarıyla POS ekranına aktarıldı.");

      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchProducts();
    }, 400);
    return () => clearTimeout(delayDebounceFn);
  }, [fetchProducts]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && searchQuery.trim() !== "") fetchProducts();
  };

  const openWizard = (product) => {
    setSelectedProduct(product);
    setWizardStep(1);
    setCustomization({
      quantity: 1,
      width: "",
      height: "",
      selectedExtraIndex: -1,
      room_name: "",
      facade: "",
      window_name: "",
      item_note: "",
    });
  };

  const calculateDetails = () => {
    if (!selectedProduct)
      return { finalQty: 0, unitPrice: 0, totalPrice: 0, appliedRule: "" };

    let finalQty = 1;
    let appliedRule = "";
    const calcType = selectedProduct.calculation_type || "adet";
    const w = Number(customization.width) || 0;
    const h = Number(customization.height) || 0;

    if (calcType === "adet") {
      finalQty = Number(customization.quantity) || 1;
    } else if (calcType === "m2") {
      let m2 = (w * h) / 10000;
      if (m2 > 0) {
        if (selectedProduct.min_m2 > 0 && m2 < selectedProduct.min_m2) {
          m2 = selectedProduct.min_m2;
          appliedRule = `Min. ${selectedProduct.min_m2} m² kuralı.`;
        } else if (selectedProduct.rounding_step > 0) {
          const step = selectedProduct.rounding_step;
          const rounded = Math.ceil(m2 / step) * step;
          if (rounded !== m2) {
            appliedRule = `${m2.toFixed(2)}m² -> ${rounded.toFixed(2)}m² yuvarlandı.`;
            m2 = rounded;
          }
        }
      }
      finalQty = m2 * (Number(customization.quantity) || 1);
    } else if (calcType === "mt") {
      let mt = w / 100;
      finalQty = mt * (Number(customization.quantity) || 1);
    }

    let extraPrice = 0,
      extraOptionName = "";
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
      toast.error("Geçerli ölçüler giriniz.");
      return;
    }
    if (selectedProduct.stock_quantity < finalQty) {
      toast.error(`Yetersiz stok! Mevcut: ${selectedProduct.stock_quantity}`);
      return;
    }

    const cartItem = {
      ...selectedProduct,
      cartItemId: Date.now(),
      sale_quantity: finalQty,
      sale_width: Number(customization.width) || 0,
      sale_height: Number(customization.height) || 0,
      unit_price: unitPrice,
      item_total: totalPrice,
      extra_option_name: extraOptionName,
      room_name: customization.room_name || "Belirtilmedi",
      facade: customization.facade,
      window_name: customization.window_name,
      item_note: customization.item_note,
      calc_type: selectedProduct.calculation_type || "adet",
    };

    setCart([...cart, cartItem]);
    setSelectedProduct(null);
    toast.success("Sepete eklendi.");
    if (searchInputRef.current) searchInputRef.current.focus();
  };

  const removeFromCart = (id) =>
    setCart(cart.filter((item) => item.cartItemId !== id));

  const subTotal = cart.reduce((total, item) => total + item.item_total, 0);
  const discountAmount = Number(discount) || 0;
  const afterDiscount = Math.max(0, subTotal - discountAmount);
  const creditCardFee =
    paymentMethod === "Kredi Kartı" ? afterDiscount * 0.1 : 0;
  const grandTotal = afterDiscount + creditCardFee;

  const openCheckoutModal = (type) => {
    if (cart.length === 0) return;
    setCheckoutModalType(type);
  };

  const finalizeSale = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const sale_items = cart.map((item) => ({
        product: item._id,
        quantity: item.sale_quantity,
        width: item.sale_width,
        height: item.sale_height,
        unit_price: item.unit_price,
        total_price: item.item_total,
        room_name: item.room_name,
        facade: item.facade,
        window_name: item.window_name,
        item_note: item.item_note,
      }));

      const payload = {
        sale_items,
        sub_total: subTotal,
        discount_amount: discountAmount,
        credit_card_fee: creditCardFee,
        grand_total: grandTotal,
        payment_method: paymentMethod,
        status: checkoutModalType,
        ...customerInfo,
      };

      if (existingSaleId) {
        await api.put(`/sales/${existingSaleId}`, payload);
      } else {
        await api.post("/sales", payload);
      }

      toast.success(
        checkoutModalType === "beklemede"
          ? "Sipariş başarıyla güncellendi/beklemeye alındı!"
          : "Satış başarıyla tamamlandı!",
      );

      setCart([]);
      setPaymentMethod("Nakit");
      setDiscount(0);
      setCheckoutModalType(null);
      setExistingSaleId(null);
      setCustomerInfo({
        customer_name: "",
        customer_phone: "",
        customer_address: "",
        delivery_date: "",
        sale_note: "",
      });
      fetchProducts();

      if (existingSaleId && checkoutModalType === "tamamlandi") {
        navigate("/dashboard/sales");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "İşlem başarısız.");
    } finally {
      setIsProcessing(false);
    }
  };

  const calcData = selectedProduct ? calculateDetails() : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-[1500px] mx-auto h-[calc(100vh-8rem)]">
      {/* SOL TARAF: VİTRİN */}
      <div className="flex-1 flex flex-col gap-5 overflow-hidden">
        {/* AKTARILMIŞ SİPARİŞ UYARISI */}
        {existingSaleId && (
          <div className="bg-amber-100 border border-amber-300 text-amber-800 px-4 py-3 rounded-xl flex justify-between items-center shadow-sm">
            <span className="font-bold flex items-center gap-2">
              <Clock size={18} /> Bekleyen Siparişi Düzenliyorsunuz
            </span>
            <button
              onClick={() => {
                setExistingSaleId(null);
                setCart([]);
              }}
              className="text-sm underline hover:text-amber-900"
            >
              İptal Et & Yeni Satışa Geç
            </button>
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              ref={searchInputRef}
              type="text"
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
              placeholder="Barkod okutun veya isim yazın..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <select
            className="w-full sm:w-40 px-3 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">Tüm Kategoriler</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.category_name}
              </option>
            ))}
          </select>
          <select
            className="w-full sm:w-40 px-3 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50"
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

        <div className="flex-1 overflow-y-auto pr-2 pb-10">
          {isSearching ? (
            <div className="flex justify-center mt-10">
              <Loader2 className="animate-spin text-indigo-500" size={40} />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center mt-10 text-gray-400">
              <Package size={64} className="mb-4 opacity-50" />
              <p>Ürün bulunamadı.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {products.map((product) => (
                <div
                  key={product._id}
                  onClick={() => openWizard(product)}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-400 hover:shadow-md cursor-pointer overflow-hidden flex flex-col group"
                >
                  <div className="aspect-square bg-gray-50 flex items-center justify-center relative">
                    {product.product_image ? (
                      <img
                        src={product.product_image}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <Package className="text-gray-300" size={40} />
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <span className="text-xs text-indigo-600 font-semibold mb-1">
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

      {/* SAĞ TARAF: SEPET */}
      <div className="w-full lg:w-[450px] bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full flex-shrink-0">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="text-indigo-600" /> Sepet
          </h2>
          <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {cart.length} Ürün
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/30">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <ShoppingCart size={40} className="mb-2 opacity-50" />
              <p className="text-sm">Sepetiniz boş.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.cartItemId}
                className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm relative"
              >
                <button
                  onClick={() => removeFromCart(item.cartItemId)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
                <h4 className="font-bold text-gray-900 text-sm pr-6">
                  {item.product_name}
                </h4>

                <div className="flex flex-wrap gap-1 mt-2">
                  {item.room_name && (
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                      <Home size={10} className="inline mr-0.5" />
                      {item.room_name}
                    </span>
                  )}
                  {item.facade && (
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">
                      {item.facade}
                    </span>
                  )}
                  {item.window_name && (
                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">
                      {item.window_name}
                    </span>
                  )}
                </div>

                {(item.calc_type === "m2" || item.calc_type === "mt") && (
                  <p className="text-xs text-indigo-600 font-medium mt-1.5">
                    Ölçü: {item.sale_width}x{item.sale_height} cm
                  </p>
                )}
                {item.extra_option_name && (
                  <p className="text-xs text-amber-600 font-medium mt-0.5">
                    Seçenek: {item.extra_option_name}
                  </p>
                )}
                {item.item_note && (
                  <p className="text-[11px] text-gray-500 italic mt-1 bg-gray-50 p-1 rounded">
                    Not: {item.item_note}
                  </p>
                )}

                <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-600 font-medium">
                    Miktar: {item.sale_quantity.toFixed(2)}{" "}
                    {item.product_unit?.unit_code}
                  </p>
                  <p className="font-black text-gray-900">
                    ₺{item.item_total.toFixed(2)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* FİNANS VE BUTONLAR */}
        <div className="p-4 border-t border-gray-200 bg-white space-y-3">
          <div className="flex items-center justify-between gap-3 bg-gray-50 p-2 rounded-lg border border-gray-200">
            <span className="text-sm font-semibold text-gray-600">
              İskonto (₺):
            </span>
            <input
              type="number"
              min="0"
              className="w-24 px-2 py-1 text-right border border-gray-300 rounded focus:ring-indigo-500 text-sm font-bold"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod("Nakit")}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-bold transition-all ${paymentMethod === "Nakit" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-gray-50 text-gray-600"}`}
            >
              <Banknote size={16} /> Nakit
            </button>
            <button
              onClick={() => setPaymentMethod("Kredi Kartı")}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-bold transition-all ${paymentMethod === "Kredi Kartı" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-gray-50 text-gray-600"}`}
            >
              <CreditCard size={16} /> Kredi Kartı
            </button>
          </div>

          <div className="pt-2 space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Ara Toplam:</span>
              <span>₺{subTotal.toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-red-500 font-medium">
                <span>İskonto:</span>
                <span>- ₺{discountAmount.toFixed(2)}</span>
              </div>
            )}
            {creditCardFee > 0 && (
              <div className="flex justify-between text-xs text-amber-600 font-medium">
                <span>Kredi Kartı Farkı (%10):</span>
                <span>+ ₺{creditCardFee.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-200 items-end">
              <span className="text-sm font-bold text-gray-700">
                Genel Toplam:
              </span>
              <span className="text-3xl font-black text-indigo-700">
                ₺{grandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={() => openCheckoutModal("beklemede")}
              disabled={cart.length === 0}
              className="py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 shadow-sm"
            >
              <PauseCircle size={18} /> {existingSaleId ? "GÜNCELLE" : "BEKLET"}
            </button>
            <button
              onClick={() => openCheckoutModal("tamamlandi")}
              disabled={cart.length === 0}
              className="py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 shadow-sm"
            >
              <CheckCircle size={18} /> ONAYLA
            </button>
          </div>
        </div>
      </div>

      {/* SİPARİŞ SİHİRBAZI MODALI (Oda -> Cephe -> Ölçü) */}
      {selectedProduct && wizardStep && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div className="bg-indigo-600 px-6 py-4 flex justify-between items-center text-white">
              <div>
                <h3 className="font-bold text-lg">
                  Adım {wizardStep}/3:{" "}
                  {wizardStep === 1
                    ? "Oda Seçimi"
                    : wizardStep === 2
                      ? "Cephe & Pencere"
                      : "Ölçü ve Detaylar"}
                </h3>
                <p className="text-indigo-200 text-sm mt-0.5">
                  {selectedProduct.product_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="text-indigo-200 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              {wizardStep === 1 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  <h4 className="font-bold text-gray-700">
                    Bu ürün hangi odaya takılacak?
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_ROOMS.map((room) => (
                      <button
                        key={room}
                        onClick={() =>
                          setCustomization({
                            ...customization,
                            room_name: room,
                          })
                        }
                        className={`px-4 py-2 rounded-xl text-sm font-bold border ${customization.room_name === room ? "bg-indigo-100 border-indigo-500 text-indigo-700" : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-white"}`}
                      >
                        {room}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">
                      Veya Özel Oda Adı Yazın:
                    </label>
                    <input
                      type="text"
                      className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={customization.room_name}
                      onChange={(e) =>
                        setCustomization({
                          ...customization,
                          room_name: e.target.value,
                        })
                      }
                      placeholder="Örn: Ebeveyn Banyosu"
                    />
                  </div>
                  <div className="flex justify-end pt-4">
                    <button
                      onClick={() => setWizardStep(2)}
                      disabled={!customization.room_name}
                      className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl flex items-center gap-2 disabled:opacity-50"
                    >
                      İleri <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-5 animate-in slide-in-from-right-4">
                  <div>
                    <h4 className="font-bold text-gray-700 mb-2">
                      Hangi Cephe?{" "}
                      <span className="text-gray-400 text-xs font-normal">
                        (Opsiyonel)
                      </span>
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_FACADES.map((f) => (
                        <button
                          key={f}
                          onClick={() =>
                            setCustomization({ ...customization, facade: f })
                          }
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${customization.facade === f ? "bg-amber-50 border-amber-400 text-amber-700" : "bg-gray-50 border-gray-200 text-gray-600"}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-700 mb-2">
                      Hangi Pencere Tipi?{" "}
                      <span className="text-gray-400 text-xs font-normal">
                        (Opsiyonel)
                      </span>
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_WINDOWS.map((w) => (
                        <button
                          key={w}
                          onClick={() =>
                            setCustomization({
                              ...customization,
                              window_name: w,
                            })
                          }
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${customization.window_name === w ? "bg-emerald-50 border-emerald-400 text-emerald-700" : "bg-gray-50 border-gray-200 text-gray-600"}`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-between pt-4">
                    <button
                      onClick={() => setWizardStep(1)}
                      className="px-5 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl flex items-center gap-2"
                    >
                      <ArrowLeft size={18} /> Geri
                    </button>
                    <button
                      onClick={() => setWizardStep(3)}
                      className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl flex items-center gap-2"
                    >
                      İleri <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  {(selectedProduct.calculation_type === "m2" ||
                    selectedProduct.calculation_type === "mt") && (
                    <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div>
                        <label className="text-xs font-bold text-gray-700">
                          En (cm) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="w-full py-2 px-3 border border-gray-300 rounded-lg font-bold text-center"
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
                          <label className="text-xs font-bold text-gray-700">
                            Boy (cm) *
                          </label>
                          <input
                            type="number"
                            min="0"
                            className="w-full py-2 px-3 border border-gray-300 rounded-lg font-bold text-center"
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

                  <div className="flex gap-4 items-center">
                    <div className="flex-1">
                      <label className="text-xs font-bold text-gray-700 mb-1 block">
                        Adet / Çarpan
                      </label>
                      <div className="flex items-center">
                        <button
                          onClick={() =>
                            setCustomization({
                              ...customization,
                              quantity: Math.max(1, customization.quantity - 1),
                            })
                          }
                          className="px-3 py-2 bg-gray-200 rounded-l-lg"
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          className="w-full text-center py-2 border-y border-gray-300 font-bold bg-white"
                          value={customization.quantity}
                          onChange={(e) =>
                            setCustomization({
                              ...customization,
                              quantity: e.target.value,
                            })
                          }
                        />
                        <button
                          onClick={() =>
                            setCustomization({
                              ...customization,
                              quantity: Number(customization.quantity) + 1,
                            })
                          }
                          className="px-3 py-2 bg-gray-200 rounded-r-lg"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    {selectedProduct.extra_options?.length > 0 && (
                      <div className="flex-[2]">
                        <label className="text-xs font-bold text-gray-700 mb-1 block">
                          Pile / Ekstra
                        </label>
                        <select
                          className="w-full py-2 px-3 border border-gray-300 rounded-lg text-sm font-medium bg-white"
                          value={customization.selectedExtraIndex}
                          onChange={(e) =>
                            setCustomization({
                              ...customization,
                              selectedExtraIndex: Number(e.target.value),
                            })
                          }
                        >
                          <option value={-1}>Düz Dikim (Standart)</option>
                          {selectedProduct.extra_options.map((opt, i) => (
                            <option key={i} value={i}>
                              {opt.option_name} (+₺{opt.price_impact})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
                      <AlignLeft size={14} /> Bu Cama Özel Not
                    </label>
                    <input
                      type="text"
                      placeholder="Örn: Korniş payı kısa bırakılacak..."
                      className="w-full mt-1 py-2 px-3 border border-gray-300 rounded-lg text-sm"
                      value={customization.item_note}
                      onChange={(e) =>
                        setCustomization({
                          ...customization,
                          item_note: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-500">
                        Miktar: <b>{calcData.finalQty.toFixed(2)}</b> br
                      </p>
                      {calcData.appliedRule && (
                        <p className="text-[10px] text-amber-600 font-bold">
                          ⚠️ {calcData.appliedRule}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-500">Ara Toplam</p>
                      <p className="text-xl font-black text-indigo-700">
                        ₺{calcData.totalPrice.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={() => setWizardStep(2)}
                      className="px-5 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl flex items-center gap-2"
                    >
                      <ArrowLeft size={18} /> Geri
                    </button>
                    <button
                      onClick={addToCart}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-md"
                    >
                      <ShoppingCart size={20} /> Sepete At
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MÜŞTERİ BİLGİ MODALI */}
      {checkoutModalType && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div
              className={`px-6 py-4 flex justify-between items-center text-white ${checkoutModalType === "beklemede" ? "bg-amber-500" : "bg-green-600"}`}
            >
              <h3 className="font-bold text-lg flex items-center gap-2">
                {checkoutModalType === "beklemede" ? (
                  <PauseCircle size={20} />
                ) : (
                  <CheckCircle size={20} />
                )}
                {checkoutModalType === "beklemede"
                  ? existingSaleId
                    ? "Siparişi Güncelle"
                    : "Siparişi Beklemeye Al"
                  : "Satışı Tamamla"}
              </h3>
              <button
                onClick={() => setCheckoutModalType(null)}
                className="text-white/80 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={finalizeSale} className="p-6 space-y-4">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mb-4 flex justify-between items-center">
                <span className="text-sm text-gray-600 font-bold">
                  Ödenecek Tutar:
                </span>
                <span className="text-2xl font-black text-gray-900">
                  ₺{grandTotal.toFixed(2)}
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <User size={14} /> Müşteri Adı Soyadı
                </label>
                <input
                  type="text"
                  required={checkoutModalType === "beklemede"}
                  className="w-full py-2.5 px-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  value={customerInfo.customer_name}
                  onChange={(e) =>
                    setCustomerInfo({
                      ...customerInfo,
                      customer_name: e.target.value,
                    })
                  }
                  placeholder="Örn: Ahmet Yılmaz"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <Phone size={14} /> Telefon
                  </label>
                  <input
                    type="text"
                    className="w-full py-2.5 px-3 border border-gray-300 rounded-lg text-sm"
                    value={customerInfo.customer_phone}
                    onChange={(e) =>
                      setCustomerInfo({
                        ...customerInfo,
                        customer_phone: e.target.value,
                      })
                    }
                    placeholder="05XX XXX XX XX"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <Calendar size={14} /> Teslim/Montaj Tarihi
                  </label>
                  <input
                    type="date"
                    className="w-full py-2.5 px-3 border border-gray-300 rounded-lg text-sm"
                    value={customerInfo.delivery_date}
                    onChange={(e) =>
                      setCustomerInfo({
                        ...customerInfo,
                        delivery_date: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <MapPin size={14} /> Teslimat Adresi
                </label>
                <textarea
                  rows="2"
                  className="w-full py-2 px-3 border border-gray-300 rounded-lg text-sm resize-none"
                  value={customerInfo.customer_address}
                  onChange={(e) =>
                    setCustomerInfo({
                      ...customerInfo,
                      customer_address: e.target.value,
                    })
                  }
                  placeholder="Açık adres..."
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <AlignLeft size={14} /> Genel Sipariş Notu
                </label>
                <input
                  type="text"
                  className="w-full py-2.5 px-3 border border-gray-300 rounded-lg text-sm"
                  value={customerInfo.sale_note}
                  onChange={(e) =>
                    setCustomerInfo({
                      ...customerInfo,
                      sale_note: e.target.value,
                    })
                  }
                  placeholder="Örn: Ölçüye gidilecek, kapora alındı vb."
                />
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setCheckoutModalType(null)}
                  disabled={isProcessing}
                  className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 font-bold rounded-xl text-sm"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className={`px-6 py-2.5 text-white font-bold rounded-xl text-sm flex items-center gap-2 ${checkoutModalType === "beklemede" ? "bg-amber-500 hover:bg-amber-600" : "bg-green-600 hover:bg-green-700"}`}
                >
                  {isProcessing && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  {checkoutModalType === "beklemede"
                    ? existingSaleId
                      ? "Siparişi Güncelle"
                      : "Siparişi Beklemeye Al"
                    : "Satışı Onayla"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosPage;
