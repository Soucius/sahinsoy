import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

const ScrollToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener("scroll", toggleVisibility);

    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <button
      onClick={scrollToTop}
      className={`
                fixed bottom-5 right-5 z-50
                p-3 rounded-full bg-red-600 text-white
                shadow-lg hover:bg-red-700
                focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50
                transition-opacity duration-300
                ${isVisible ? "opacity-100" : "opacity-0 pointer-events-none"}
            `}
      aria-label="Go to top"
    >
      <ArrowUp size={24} />
    </button>
  );
};

export default ScrollToTopButton;
