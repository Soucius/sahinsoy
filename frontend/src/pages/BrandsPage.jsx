import { useState, useEffect } from "react";
import { Tag, Plus, Trash2, Edit2, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const BrandsPage = () => {
  const [brands, setBrands] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    brand_name: "",
    brand_description: "",
  });

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    try {
      const response = await api.get("/brands");

      setBrands(response.data);
    } catch (error) {
      toast.error("Markalar yüklenirken bir hata oluştu.", error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      if (editingId) {
        const response = await api.put(`/brands/${editingId}`, formData);

        setBrands(
          brands.map((brand) =>
            brand._id === editingId ? response.data : brand,
          ),
        );

        toast.success("Marka başarıyla güncellendi!");

        handleCancelEdit();
      } else {
        const response = await api.post("/brands", formData);

        setBrands([response.data, ...brands]);
        setFormData({ brand_name: "", brand_description: "" });

        toast.success("Marka başarıyla eklendi!");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (brand) => {
    setEditingId(brand._id);
    setFormData({
      brand_name: brand.brand_name,
      brand_description: brand.brand_description || "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData({ brand_name: "", brand_description: "" });
  };

  const handleDeleteBrand = async (id) => {
    if (!window.confirm("Bu markayı silmek istediğinize emin misiniz?")) return;

    try {
      await api.delete(`/brands/${id}`);

      setBrands(brands.filter((brand) => brand._id !== id));

      if (editingId === id) handleCancelEdit();

      toast.success("Marka başarıyla silindi.");
    } catch (error) {
      toast.error("Marka silinirken bir hata oluştu.", error);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Marka Yönetimi</h1>

          <p className="text-sm text-gray-500 mt-1">
            Ürünlerinize ait markaları buradan ekleyebilir, güncelleyebilir ve
            silebilirsiniz.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              {editingId ? (
                <>
                  <Edit2 size={20} className="text-amber-500" /> Markayı
                  Güncelle
                </>
              ) : (
                <>
                  <Plus size={20} className="text-indigo-600" /> Yeni Marka Ekle
                </>
              )}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Marka Adı *
                </label>

                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                  placeholder="Örn: Taç, Brillant"
                  value={formData.brand_name}
                  onChange={(e) =>
                    setFormData({ ...formData, brand_name: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Açıklama
                </label>

                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors resize-none"
                  rows="3"
                  placeholder="İsteğe bağlı açıklama..."
                  value={formData.brand_description}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      brand_description: e.target.value,
                    })
                  }
                  disabled={isLoading}
                ></textarea>
              </div>

              <div className="flex gap-2 pt-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isLoading}
                    className="flex-1 py-2.5 px-4 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    İptal
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className={`flex-[2] flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white transition-colors disabled:opacity-70 ${editingId ? "bg-amber-500 hover:bg-amber-600" : "bg-indigo-600 hover:bg-indigo-700"}`}
                >
                  {isLoading ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : editingId ? (
                    <Edit2 size={18} />
                  ) : (
                    <Tag size={18} />
                  )}
                  {isLoading
                    ? "İşleniyor..."
                    : editingId
                      ? "Güncelle"
                      : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-800">
                Kayıtlı Markalar
              </h2>
            </div>

            {isFetching ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="animate-spin text-indigo-600" size={32} />
              </div>
            ) : brands.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Tag className="mx-auto h-12 w-12 text-gray-300 mb-3" />

                <p>Henüz hiçbir marka eklenmemiş.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm text-gray-500">
                      <th className="px-6 py-3 font-medium">Marka Adı</th>
                      <th className="px-6 py-3 font-medium">Açıklama</th>
                      <th className="px-6 py-3 font-medium text-right">
                        İşlemler
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {brands.map((brand) => (
                      <tr
                        key={brand._id}
                        className={`hover:bg-gray-50 transition-colors ${editingId === brand._id ? "bg-amber-50/30" : ""}`}
                      >
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {brand.brand_name}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-xs">
                          {brand.brand_description || "-"}
                        </td>

                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                          <button
                            onClick={() => handleEditClick(brand)}
                            className="text-amber-500 hover:text-amber-700 hover:bg-amber-50 p-2 rounded-lg transition-colors"
                            title="Düzenle"
                          >
                            <Edit2 size={18} />
                          </button>

                          <button
                            onClick={() => handleDeleteBrand(brand._id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
                            title="Sil"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandsPage;
