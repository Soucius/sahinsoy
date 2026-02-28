import { useState, useEffect } from "react";
import { User, Mail, Phone, Lock, Loader2, Save } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../libs/axios";

const AccountPage = () => {
  const { currentUser, setCurrentUser } = useOutletContext();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    user_username: "",
    user_email: "",
    user_phone: "",
    user_password: "",
  });

  useEffect(() => {
    if (currentUser) {
      setFormData({
        user_username: currentUser.user_username || "",
        user_email: currentUser.user_email || "",
        user_phone: currentUser.user_phone || "",
        user_password: "",
      });
    }
  }, [currentUser]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      const response = await api.put(`/users/${currentUser._id}`, formData);

      setCurrentUser(response.data);

      toast.success("Hesap bilgileriniz başarıyla güncellendi!");

      setFormData((prev) => ({ ...prev, user_password: "" }));
    } catch (error) {
      console.error("Güncelleme hatası:", error);

      toast.error(
        error.response?.data?.message ||
          "Bilgiler güncellenirken bir hata oluştu.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="border-b border-gray-100 px-8 py-6 bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-800">Hesap Ayarları</h2>

          <p className="text-sm text-gray-500 mt-1">
            Kişisel bilgilerinizi ve şifrenizi buradan güncelleyebilirsiniz.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Kullanıcı Adı
              </label>

              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>

                <input
                  type="text"
                  required
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100"
                  value={formData.user_username}
                  onChange={(e) =>
                    setFormData({ ...formData, user_username: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                E-posta Adresi
              </label>

              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>

                <input
                  type="email"
                  required
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100"
                  value={formData.user_email}
                  onChange={(e) =>
                    setFormData({ ...formData, user_email: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Telefon Numarası
              </label>

              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>

                <input
                  type="text"
                  required
                  maxLength={11}
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100"
                  value={formData.user_phone}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      user_phone: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Yeni Şifre{" "}
                <span className="text-gray-400 text-xs font-normal">
                  (Değiştirmek istemiyorsanız boş bırakın)
                </span>
              </label>

              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>

                <input
                  type="password"
                  minLength={6}
                  className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100"
                  placeholder="Değiştirmek için yazın..."
                  value={formData.user_password}
                  onChange={(e) =>
                    setFormData({ ...formData, user_password: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 py-2.5 px-6 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Save size={18} />
              )}
              {isLoading ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountPage;
