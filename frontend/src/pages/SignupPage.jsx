import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  User,
  Phone,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const SignupPage = () => {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    user_username: "",
    user_email: "",
    user_phone: "",
    user_password: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      await api.post("/users", formData);

      toast.success("Kayıt başarıyla oluşturuldu! Lütfen giriş yapın.");

      navigate("/signin");
    } catch (error) {
      console.error("Kayıt hatası:", error);

      toast.error(
        error.response?.data?.message || "Kayıt olurken bir hata oluştu.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/"
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 transition-colors justify-center mb-6"
        >
          <ArrowLeft size={20} />

          <span className="font-medium text-sm">Ana Sayfaya Dön</span>
        </Link>

        <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900">
          Yeni Hesap Oluşturun
        </h2>

        <p className="mt-2 text-center text-sm text-gray-600">
          Zaten hesabınız var mı?{" "}
          <Link
            to="/signin"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Giriş yapın
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100">
          <form className="space-y-6" onSubmit={handleSubmit}>
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
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors disabled:bg-gray-100"
                  placeholder="Kullanıcı adınızı belirleyin"
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
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors disabled:bg-gray-100"
                  placeholder="ornek@sahinsoy.com"
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
                  type="tel"
                  required
                  maxLength={11}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors disabled:bg-gray-100"
                  placeholder="05XX XXX XX XX"
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
                Şifre
              </label>

              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>

                <input
                  type={showPassword ? "text" : "password"}
                  required
                  className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors disabled:bg-gray-100"
                  placeholder="••••••••"
                  value={formData.user_password}
                  onChange={(e) =>
                    setFormData({ ...formData, user_password: e.target.value })
                  }
                  disabled={isLoading}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-indigo-600 focus:outline-none transition-colors"
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading && <Loader2 className="animate-spin" size={18} />}
              {isLoading ? "Hesap Oluşturuluyor..." : "Kayıt Ol"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
