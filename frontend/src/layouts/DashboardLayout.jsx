import { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MonitorPlay,
  Package,
  FileText,
  LogOut,
  Menu,
  X,
  User,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../libs/axios";

const DashboardLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const menuItems = [
    {
      title: "Genel Bakış",
      path: "/dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    {
      title: "POS Ekranı",
      path: "/dashboard/pos",
      icon: <MonitorPlay size={20} />,
    },
    {
      title: "Ürünler & Stok",
      path: "/dashboard/products",
      icon: <Package size={20} />,
    },
    {
      title: "Satış Geçmişi",
      path: "/dashboard/sales",
      icon: <FileText size={20} />,
    },
  ];

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const token = localStorage.getItem("token");

        if (token) {
          const base64Url = token.split(".")[1];
          const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
          const payload = JSON.parse(window.atob(base64));
          const response = await api.get(`/users/${payload.id}`);

          setCurrentUser(response.data);
        }
      } catch (error) {
        console.error("Kullanıcı bilgileri alınamadı:", error);
      }
    };

    fetchUserData();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");

    toast.success("Başarıyla çıkış yapıldı.");

    navigate("/signin");
  };

  return (
    <div className="h-screen w-full bg-gray-50 flex overflow-hidden font-sans">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`
        fixed lg:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out flex flex-col
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      >
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-lg">Ş</span>
            </div>

            <span className="text-lg font-bold text-gray-800 tracking-tight">
              Şahinsoy
            </span>
          </div>

          <button
            className="ml-auto lg:hidden text-gray-500 hover:text-gray-800"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== "/dashboard" &&
                location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }
                `}
              >
                <span
                  className={isActive ? "text-indigo-600" : "text-gray-400"}
                >
                  {item.icon}
                </span>

                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut size={20} />
            Sistemden Çıkış Yap
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden text-gray-500 hover:text-gray-800 focus:outline-none"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>

            <h2 className="text-lg font-semibold text-gray-800 hidden sm:block">
              Yönetim Paneli
            </h2>
          </div>

          <Link
            to="/dashboard/account"
            className="flex items-center gap-3 hover:bg-gray-50 p-2 rounded-lg transition-colors"
            title="Hesap Ayarları"
          >
            <div className="flex-col items-end hidden sm:flex">
              <span className="text-sm font-medium text-gray-900">
                {currentUser ? currentUser.user_username : "Yükleniyor..."}
              </span>

              <span className="text-xs text-gray-500">Satış Temsilcisi</span>
            </div>

            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
              <User size={20} />
            </div>
          </Link>
        </header>

        <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-gray-50">
          <Outlet context={{ currentUser, setCurrentUser }} />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
