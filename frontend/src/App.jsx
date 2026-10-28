import { Toaster } from "react-hot-toast";
import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ScrollToTopButton from "./components/ScrollToTopButton";
import SigninPage from "./pages/SigninPage";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import AccountPage from "./pages/AccountPage";
import BrandsPage from "./pages/BrandsPage";
import UnitsPage from "./pages/UnitsPage";
import ProductsPage from "./pages/ProductsPage";
import PosPage from "./pages/PosPage";
import CategoriesPage from "./pages/CategoriesPage";
import SalesPage from "./pages/SalesPage";
import SalePaymentsPage from "./pages/SalePaymentsPage.jsx";
import SaleMeasurementPage from "./pages/SaleMeasurementPage";
import ProductionPage from "./pages/ProductionPage";
import ProductionSigninPage from "./pages/ProductionSigninPage";
import WhatsAppTestPage from "./pages/WhatsAppTestPage";
import AccountingPage from "./pages/AccountingPage";
import CashPersonnelPage from './pages/CashPersonnelPage';

function App() {
  return (
    <div className="min-h-screen w-full bg-gray-100">
      <Toaster position="top-center" reverseOrder={false} />

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signin" element={<SigninPage />} />
        <Route path="/signup" element={<Navigate to="/signin" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/uretim/giris" element={<ProductionSigninPage />} />
        <Route path="/uretim" element={<ProductionPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="brands" element={<BrandsPage />} />
            <Route path="units" element={<UnitsPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="production" element={<ProductionPage admin />} />
            <Route path="whatsapp" element={<WhatsAppTestPage />} />
            <Route path="accounting" element={<AccountingPage />} />
            <Route path="cash-office" element={<CashPersonnelPage />} />
            <Route path="sales/:id/payments" element={<SalePaymentsPage />} />
            <Route path="sales/:id/measurements" element={<SaleMeasurementPage />} />
          </Route>
        </Route>
      </Routes>

      <ScrollToTopButton />
    </div>
  );
}

export default App;
