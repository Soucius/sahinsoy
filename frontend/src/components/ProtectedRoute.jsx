import { Navigate, Outlet } from "react-router-dom";

const ProtectedRoute = () => {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/signin" replace />;
  }

  let destination;
  try {
    const payload = JSON.parse(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.scope === 'production') destination = '/uretim';
  } catch { destination = '/signin'; }
  if (destination) return <Navigate to={destination} replace />;

  return <Outlet />;
};

export default ProtectedRoute;
