import { Toaster } from "react-hot-toast";
import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ScrollToTopButton from "./components/ScrollToTopButton";
import SigninPage from "./pages/SigninPage";
import SignupPage from "./pages/SignupPage";
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

function App() {
  return (
    <div className="min-h-screen w-full bg-gray-100">
      <Toaster position="top-center" reverseOrder={false} />

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signin" element={<SigninPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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
          </Route>
        </Route>
      </Routes>

      <ScrollToTopButton />
    </div>
  );
}

export default App;
