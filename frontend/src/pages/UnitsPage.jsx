import { useState, useEffect } from "react";
import { Ruler, Plus, Trash2, Edit2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const UnitsPage = () => {
  const [units, setUnits] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ unit_name: "", unit_code: "" });

  useEffect(() => {
    fetchUnits();
  }, []);

  const fetchUnits = async () => {
    try {
      const response = await api.get("/units");

      setUnits(response.data);
    } catch (error) {
      toast.error("Birimler yüklenirken bir hata oluştu.", error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      if (editingId) {
        const response = await api.put(`/units/${editingId}`, formData);

        setUnits(
          units.map((unit) => (unit._id === editingId ? response.data : unit)),
        );

        toast.success("Birim başarıyla güncellendi!");

        handleCancelEdit();
      } else {
        const response = await api.post("/units", formData);

        setUnits([response.data, ...units]);
        setFormData({ unit_name: "", unit_code: "" });

        toast.success("Birim başarıyla eklendi!");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (unit) => {
    setEditingId(unit._id);
    setFormData({ unit_name: unit.unit_name, unit_code: unit.unit_code });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData({ unit_name: "", unit_code: "" });
  };

  const handleDeleteUnit = async (id) => {
    if (!window.confirm("Bu birimi silmek istediğinize emin misiniz?")) return;

    try {
      await api.delete(`/units/${id}`);

      setUnits(units.filter((unit) => unit._id !== id));

      if (editingId === id) handleCancelEdit();

      toast.success("Birim başarıyla silindi.");
    } catch (error) {
      toast.error("Birim silinirken bir hata oluştu.", error);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            Birim (Stok Cinsi) Yönetimi
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            Ürünlerinizin stok cinslerini (Adet, Metre, Kg vb.) buradan
            yönetebilirsiniz.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              {editingId ? (
                <>
                  <Edit2 size={20} className="text-amber-500" /> Birimi Güncelle
                </>
              ) : (
                <>
                  <Plus size={20} className="text-indigo-600" /> Yeni Birim Ekle
                </>
              )}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Birim Adı *
                </label>

                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                  placeholder="Örn: Metre, Adet"
                  value={formData.unit_name}
                  onChange={(e) =>
                    setFormData({ ...formData, unit_name: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kısa Kodu *
                </label>

                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                  placeholder="Örn: m, ad, kg"
                  value={formData.unit_code}
                  onChange={(e) =>
                    setFormData({ ...formData, unit_code: e.target.value })
                  }
                  disabled={isLoading}
                />
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
                    <Ruler size={18} />
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
                Kayıtlı Birimler
              </h2>
            </div>

            {isFetching ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="animate-spin text-indigo-600" size={32} />
              </div>
            ) : units.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Ruler className="mx-auto h-12 w-12 text-gray-300 mb-3" />

                <p>Henüz hiçbir birim eklenmemiş.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm text-gray-500">
                      <th className="px-6 py-3 font-medium">Birim Adı</th>
                      <th className="px-6 py-3 font-medium">Kısa Kodu</th>
                      <th className="px-6 py-3 font-medium text-right">
                        İşlemler
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {units.map((unit) => (
                      <tr
                        key={unit._id}
                        className={`hover:bg-gray-50 transition-colors ${editingId === unit._id ? "bg-amber-50/30" : ""}`}
                      >
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {unit.unit_name}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-500">
                          <span className="px-2 py-1 bg-gray-100 rounded-md font-mono text-xs">
                            {unit.unit_code}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                          <button
                            onClick={() => handleEditClick(unit)}
                            className="text-amber-500 hover:text-amber-700 hover:bg-amber-50 p-2 rounded-lg transition-colors"
                            title="Düzenle"
                          >
                            <Edit2 size={18} />
                          </button>

                          <button
                            onClick={() => handleDeleteUnit(unit._id)}
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

export default UnitsPage;
