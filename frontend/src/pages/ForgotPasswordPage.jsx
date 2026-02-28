import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, KeyRound, Lock, ArrowLeft, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleRequestOTP = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      const response = await api.post("/users/forgot-password", {
        user_email: email,
      });

      toast.success(
        response.data.message ||
          "Şifre sıfırlama kodu (OTP) e-posta adresinize gönderildi.",
      );
      setStep(2);
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Kod gönderilirken hata oluştu.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    try {
      const response = await api.post("/users/reset-password", {
        user_email: email,
        otp: otpCode,
        new_password: newPassword,
      });

      toast.success(
        response.data.message ||
          "Şifreniz başarıyla güncellendi! Giriş yapabilirsiniz.",
      );

      navigate("/signin");
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          "Şifre sıfırlanırken hata oluştu. Kod yanlış veya süresi geçmiş olabilir.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/signin"
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 transition-colors justify-center mb-6"
        >
          <ArrowLeft size={20} />

          <span className="font-medium text-sm">Giriş Sayfasına Dön</span>
        </Link>

        <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900">
          Şifre Sıfırlama
        </h2>

        <p className="mt-2 text-center text-sm text-gray-600">
          {step === 1
            ? "Hesabınıza kayıtlı e-posta adresini girin."
            : "E-postanıza gelen 6 haneli kodu ve yeni şifrenizi girin."}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100">
          {step === 1 && (
            <form className="space-y-6" onSubmit={handleRequestOTP}>
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
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading && <Loader2 className="animate-spin" size={18} />}
                {isLoading
                  ? "Kod Gönderiliyor..."
                  : "Şifre Sıfırlama Kodu Gönder"}
              </button>
            </form>
          )}

          {step === 2 && (
            <form className="space-y-6" onSubmit={handleResetPassword}>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Doğrulama Kodu (OTP)
                </label>

                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-gray-400" />
                  </div>

                  <input
                    type="text"
                    required
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-center tracking-widest text-lg font-bold disabled:bg-gray-100"
                    placeholder="123456"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) =>
                      setOtpCode(e.target.value.replace(/\D/g, ""))
                    }
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Yeni Şifre
                </label>

                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>

                  <input
                    type="password"
                    required
                    minLength={6}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors disabled:bg-gray-100"
                    placeholder="En az 6 karakter"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading && <Loader2 className="animate-spin" size={18} />}
                {isLoading ? "Güncelleniyor..." : "Şifremi Güncelle"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
