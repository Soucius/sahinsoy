import Sale from "../models/Sale.js";
import Product from "../models/Product.js";

export async function getDashboardStats(_, res) {
    try {
        const sales = await Sale.find({ status: "tamamlandi" });
        const totalRevenue = sales.reduce((acc, sale) => acc + sale.grand_total, 0);
        const totalSalesCount = sales.length;
        const totalProducts = await Product.countDocuments();

        const lowStockProducts = await Product.find({ stock_tracking: { $ne: false }, stock_quantity: { $lt: 10 } })
            .select("product_name stock_quantity")
            .populate("product_unit", "unit_code")
            .limit(5)
            .sort({ stock_quantity: 1 });

        const recentSales = await Sale.find({ status: "tamamlandi" })
            .populate("sold_by", "user_username")
            .sort({ createdAt: -1 })
            .limit(5);

        res.status(200).json({
            totalRevenue,
            totalSalesCount,
            totalProducts,
            lowStockProducts,
            recentSales
        });
    } catch (error) {
        console.error("Dashboard istatistikleri getirilirken hata: ", error);

        res.status(500).json({ message: "İstatistikler yüklenirken sunucu hatası oluştu." });
    }
}
