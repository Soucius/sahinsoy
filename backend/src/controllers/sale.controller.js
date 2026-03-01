import Sale from "../models/Sale.js";
import Product from "../models/Product.js";

export async function createSale(req, res) {
    try {
        const { sale_items, grand_total, payment_method } = req.body;

        for (let item of sale_items) {
            const product = await Product.findById(item.product);
            
            if (!product) {
                return res.status(404).json({ message: "Sepetteki ürünlerden biri bulunamadı." });
            }

            if (product.stock_quantity < item.quantity) {
                return res.status(400).json({ message: `${product.product_name} için yeterli stok yok. Mevcut: ${product.stock_quantity}` });
            }

            product.stock_quantity -= item.quantity;

            await product.save();
        }

        const newSale = new Sale({
            sale_items,
            grand_total,
            payment_method,
            sold_by: req.user._id
        });

        const savedSale = await newSale.save();

        res.status(201).json(savedSale);
    } catch (error) {
        console.error("Satış işlemi sırasında hata: ", error);

        res.status(500).json({ message: "Satış tamamlanırken sunucu hatası oluştu." });
    }
}

export async function getAllSales(req, res) {
    try {
        const sales = await Sale.find()
            .populate("sale_items.product", "product_name product_barcode")
            .populate("sold_by", "user_username")
            .sort({ createdAt: -1 });
            
        res.status(200).json(sales);
    } catch (error) {
        console.error("Satışlar getirilirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}