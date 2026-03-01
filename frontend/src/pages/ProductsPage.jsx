import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Image as ImageIcon,
  Loader2,
  X,
  Barcode,
  Printer,
  Layers,
  Settings2,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const ProductsPage = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);

  const [isFetching, setIsFetching] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalProducts: 0,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const initialFormState = {
    product_name: "",
    product_barcode: "",
    product_category: "",
    product_brand: "",
    product_unit: "",
    calculation_type: "adet",
    min_m2: 0,
    rounding_step: 0,
    extra_options: [],
    stock_quantity: 0,
    product_color: "",
    purchase_price: 0,
    sale_price: 0,
    product_image: null,
  };
  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    fetchFilters();
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchProducts();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [pagination.currentPage, searchQuery, filterBrand, filterCategory]);

  const fetchFilters = async () => {
    try {
      const [catsRes, brandsRes, unitsRes] = await Promise.all([
        api.get("/categories"),
        api.get("/brands"),
        api.get("/units"),
      ]);
      setCategories(catsRes.data);
      setBrands(brandsRes.data);
      setUnits(unitsRes.data);
    } catch (error) {
      toast.error("Filtre verileri yüklenemedi.", error);
    }
  };

  const fetchProducts = async () => {
    setIsFetching(true);
    try {
      const response = await api.get("/products", {
        params: {
          page: pagination.currentPage,
          limit: 10,
          search: searchQuery,
          brand: filterBrand,
          category: filterCategory,
        },
      });
      setProducts(response.data.products);
      setPagination({
        currentPage: response.data.currentPage,
        totalPages: response.data.totalPages,
        totalProducts: response.data.totalProducts,
      });
    } catch (error) {
      toast.error("Ürünler yüklenirken hata oluştu.", error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, files } = e.target;
    if (type === "file") {
      setFormData({ ...formData, [name]: files[0] });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  // Dinamik Ekstra Seçenek (Pile vb.) Yönetimi
  const handleAddOption = () => {
    setFormData({
      ...formData,
      extra_options: [
        ...formData.extra_options,
        { option_name: "", price_impact: 0 },
      ],
    });
  };
  const handleOptionChange = (index, field, value) => {
    const newOptions = [...formData.extra_options];
    newOptions[index][field] = value;
    setFormData({ ...formData, extra_options: newOptions });
  };
  const handleRemoveOption = (index) => {
    const newOptions = formData.extra_options.filter((_, i) => i !== index);
    setFormData({ ...formData, extra_options: newOptions });
  };

  const generateRandomBarcode = () => {
    const randomBarcode = Math.floor(
      100000000000 + Math.random() * 900000000000,
    ).toString();
    setFormData({ ...formData, product_barcode: randomBarcode });
  };

  const handlePrintBarcode = (product) => {
    if (!product.product_barcode) {
      toast.error("Barkod tanımlı değil.");
      return;
    }
    const printWindow = window.open("", "", "width=600,height=400");
    printWindow.document.write(`
      <html>
        <head>
          <title>Barkod</title>
          <style>
            body { text-align: center; font-family: sans-serif; padding-top: 30px; }
            .ticket { display: inline-block; padding: 15px; border: 1px dashed #ccc; border-radius: 8px; }
            h3 { margin: 0 0 5px 0; font-size: 16px; }
            p { margin: 0 0 10px 0; font-size: 14px; font-weight: bold; }
            img { max-width: 100%; height: 60px; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <h3>${product.product_name}</h3>
            <p>₺${product.sale_price}</p>
            <img src="https://bwipjs-api.metafloor.com/?bcid=code128&text=${product.product_barcode}&scale=3&includetext" alt="Barkod" />
          </div>
          <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData(initialFormState);
    setIsModalOpen(true);
  };

  const openEditModal = (product) => {
    setEditingId(product._id);
    setFormData({
      product_name: product.product_name,
      product_barcode: product.product_barcode || "",
      product_category: product.product_category?._id || "",
      product_brand: product.product_brand?._id || "",
      product_unit: product.product_unit?._id || "",
      calculation_type: product.calculation_type || "adet",
      min_m2: product.min_m2 || 0,
      rounding_step: product.rounding_step || 0,
      extra_options: product.extra_options || [],
      stock_quantity: product.stock_quantity,
      product_color: product.product_color,
      purchase_price: product.purchase_price,
      sale_price: product.sale_price,
      product_image: null,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    const submitData = new FormData();
    Object.keys(formData).forEach((key) => {
      if (key === "extra_options") {
        submitData.append(key, JSON.stringify(formData[key])); // Array'i JSON string yapıyoruz
      } else if (formData[key] !== null && formData[key] !== "") {
        submitData.append(key, formData[key]);
      }
    });

    try {
      if (editingId) {
        await api.put(`/products/${editingId}`, submitData);
        toast.success("Ürün başarıyla güncellendi!");
      } else {
        await api.post("/products", submitData);
        toast.success("Ürün başarıyla eklendi!");
      }
      setIsModalOpen(false);
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.message || "İşlem başarısız oldu.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Bu ürünü silmek istediğinize emin misiniz?")) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success("Ürün silindi.");
      fetchProducts();
    } catch (error) {
      toast.error("Hata oluştu.", error);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Ürünler ve Stok</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sektörel hesaplamalara uygun ürünlerinizi yönetin.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow-sm font-medium transition-colors"
        >
          <Plus size={20} /> Yeni Ürün Ekle
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Ürün adı veya barkod..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPagination({ ...pagination, currentPage: 1 });
            }}
          />
        </div>
        <div className="w-full md:w-48 relative">
          <Layers
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <select
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
              setPagination({ ...pagination, currentPage: 1 });
            }}
          >
            <option value="">Tüm Kategoriler</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.category_name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:w-48 relative">
          <Filter
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <select
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
            value={filterBrand}
            onChange={(e) => {
              setFilterBrand(e.target.value);
              setPagination({ ...pagination, currentPage: 1 });
            }}
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100 text-sm text-gray-500">
                <th className="px-6 py-4 font-medium">Görsel</th>
                <th className="px-6 py-4 font-medium">Ürün Bilgisi</th>
                <th className="px-6 py-4 font-medium">Hesap Tipi & Stok</th>
                <th className="px-6 py-4 font-medium">Fiyat</th>
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
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-16">
                    <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">Ürün bulunamadı.</p>
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product._id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      {product.product_image ? (
                        <img
                          src={product.product_image}
                          alt="ürün"
                          className="w-12 h-12 object-cover rounded-lg border border-gray-200"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                          <ImageIcon size={20} className="text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-gray-900">
                        {product.product_name}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                          {product.product_category?.category_name}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                          {product.product_brand?.brand_name}
                        </span>
                        {product.product_barcode && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600">
                            <Barcode size={12} />
                            {product.product_barcode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-600 font-medium">
                          Tipi:{" "}
                          <span className="uppercase text-indigo-600 font-bold">
                            {product.calculation_type}
                          </span>
                        </span>
                        <span
                          className={
                            product.stock_quantity > 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          Stok: {product.stock_quantity}{" "}
                          {product.product_unit?.unit_code}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-bold text-gray-900">
                      ₺{product.sale_price}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handlePrintBarcode(product)}
                        className="text-blue-500 hover:bg-blue-50 p-2 rounded-lg mr-1"
                      >
                        <Printer size={18} />
                      </button>
                      <button
                        onClick={() => openEditModal(product)}
                        className="text-amber-500 hover:bg-amber-50 p-2 rounded-lg mr-1"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(product._id)}
                        className="text-red-500 hover:bg-red-50 p-2 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold text-gray-800">
                {editingId ? "Ürünü Güncelle" : "Yeni Ürün Ekle"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              {/* 1. Temel Bilgiler */}
              <h3 className="font-semibold text-gray-700 border-b pb-2 mb-4">
                1. Temel Bilgiler
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ürün Adı *
                  </label>
                  <input
                    type="text"
                    name="product_name"
                    required
                    value={formData.product_name}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Barkod Numarası
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      name="product_barcode"
                      value={formData.product_barcode}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={generateRandomBarcode}
                      className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm"
                    >
                      Üret
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Kategori *
                  </label>
                  <select
                    name="product_category"
                    required
                    value={formData.product_category}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Seçiniz</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Marka *
                  </label>
                  <select
                    name="product_brand"
                    required
                    value={formData.product_brand}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Seçiniz</option>
                    {brands.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.brand_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fiziksel Birim *
                  </label>
                  <select
                    name="product_unit"
                    required
                    value={formData.product_unit}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Seçiniz</option>
                    {units.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.unit_name} ({u.unit_code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 2. Sektörel Hesaplama Kuralları */}
              <h3 className="font-semibold text-gray-700 border-b pb-2 mb-4 flex items-center gap-2">
                <Settings2 size={18} /> 2. Satış ve Hesaplama Kuralları
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                <div>
                  <label className="block text-sm font-medium text-indigo-900 mb-1">
                    Hesaplama Tipi *
                  </label>
                  <select
                    name="calculation_type"
                    value={formData.calculation_type}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white"
                  >
                    <option value="adet">Adet (Standart)</option>
                    <option value="m2">Metrekare (m² - En x Boy)</option>
                    <option value="mt">Metretül (mt - Sadece En)</option>
                  </select>
                </div>

                {formData.calculation_type === "m2" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-indigo-900 mb-1">
                        Min. Kesim Miktarı (m²)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="min_m2"
                        value={formData.min_m2}
                        onChange={handleInputChange}
                        placeholder="Örn: 1.0"
                        className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-indigo-900 mb-1">
                        Yuvarlama Kuralı (Katsayı)
                      </label>
                      <select
                        name="rounding_step"
                        value={formData.rounding_step}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white"
                      >
                        <option value="0">Yuvarlama Yapma</option>
                        <option value="0.1">0.10'a Yuvarla</option>
                        <option value="0.5">Buçuğa (0.50) Yuvarla</option>
                        <option value="1">Tama (1.00) Yuvarla</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              {/* 3. Ekstra Seçenekler (Pile vb.) */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-gray-700">
                    Ekstra Seçenekler (Pile, İşçilik vb.)
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded-md hover:bg-indigo-200 font-medium"
                  >
                    + Seçenek Ekle
                  </button>
                </div>
                {formData.extra_options.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    Bu ürüne atanmış özel bir seçenek yok.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {formData.extra_options.map((opt, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Seçenek Adı (Örn: Amerikan Pile)"
                          value={opt.option_name}
                          onChange={(e) =>
                            handleOptionChange(
                              index,
                              "option_name",
                              e.target.value,
                            )
                          }
                          className="flex-[2] px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                            ₺
                          </span>
                          <input
                            type="number"
                            placeholder="Fiyat Etkisi"
                            value={opt.price_impact}
                            onChange={(e) =>
                              handleOptionChange(
                                index,
                                "price_impact",
                                e.target.value,
                              )
                            }
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(index)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Stok, Fiyat ve Görsel */}
              <h3 className="font-semibold text-gray-700 border-b pb-2 mb-4">
                3. Stok ve Fiyat
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mevcut Stok *
                  </label>
                  <input
                    type="number"
                    name="stock_quantity"
                    required
                    value={formData.stock_quantity}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Alış Fiyatı (₺) *
                  </label>
                  <input
                    type="number"
                    name="purchase_price"
                    step="0.01"
                    required
                    value={formData.purchase_price}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Satış Fiyatı (₺) *
                  </label>
                  <input
                    type="number"
                    name="sale_price"
                    step="0.01"
                    required
                    value={formData.sale_price}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-indigo-700 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Renk
                  </label>
                  <input
                    type="text"
                    name="product_color"
                    value={formData.product_color}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ürün Görseli
                </label>
                <input
                  type="file"
                  name="product_image"
                  accept="image/*"
                  onChange={handleInputChange}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>

              <div className="sticky bottom-0 bg-white pt-4 border-t border-gray-100 flex justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex items-center gap-2 px-5 py-2.5 border border-transparent rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70"
                >
                  {isLoading && <Loader2 className="animate-spin" size={18} />}
                  {editingId ? "Güncelle" : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsPage;
