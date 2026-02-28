import React from "react";

const DashboardPage = () => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 min-h-[60vh]">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Genel Bakış</h1>
      <p className="text-gray-600 leading-relaxed">
        Şahinsoy Perde Yönetim Paneline hoş geldiniz! Sol menüyü kullanarak POS
        ekranına geçiş yapabilir, stoklarınızı yönetebilir ve satış geçmişinizi
        görüntüleyebilirsiniz.
      </p>
    </div>
  );
};

export default DashboardPage;
