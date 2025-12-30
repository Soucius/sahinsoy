import { Toaster } from "react-hot-toast";
import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ScrollToTopButton from "./components/ScrollToTopButton";

function App() {
  return (
    <div className="h-screen w-full bg-gray-100">
      <Toaster position="top-center" reverseOrder={false} />

      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>

      <ScrollToTopButton />
    </div>
  );
}

export default App;
