import Sale from "../models/Sale.js";
import Product from "../models/Product.js";

export async function createSale(req, res) {
    try {
        const { 
            sale_items, sub_total, discount_amount, credit_card_fee, grand_total, 
            payment_method, status, 
            customer_name, customer_phone, customer_address, delivery_date, sale_note 
        } = req.body;
        
        if (status === "tamamlandi") {
            for (let item of sale_items) {
                const product = await Product.findById(item.product);

                if (!product) return res.status(404).json({ message: "Sepetteki ürünlerden biri bulunamadı." });

                if (product.stock_quantity < item.quantity) {
                    return res.status(400).json({ message: `${product.product_name} için yeterli stok yok. Mevcut: ${product.stock_quantity}` });
                }

                product.stock_quantity -= item.quantity;
                await product.save();
            }
        }

        const newSale = new Sale({
            sale_items, sub_total, discount_amount, credit_card_fee, grand_total,
            payment_method, status: status || "tamamlandi",
            customer_name, customer_phone, customer_address, delivery_date, sale_note,
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
        const filter = req.query.status ? { status: req.query.status } : {};

        const sales = await Sale.find(filter)
            .populate("sale_items.product", "product_name product_barcode product_image")
            .populate("sold_by", "user_username")
            .sort({ createdAt: -1 });
            
        res.status(200).json(sales);
    } catch (error) {
        console.error("Satışlar getirilirken hata: ", error);
        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function updateSale(req, res) {
    try {
        const saleId = req.params.id;
        const updateData = req.body;
        const existingSale = await Sale.findById(saleId);

        if (!existingSale) return res.status(404).json({ message: "Satış bulunamadı." });

        if (existingSale.status === "beklemede" && updateData.status === "tamamlandi") {
            for (let item of existingSale.sale_items) {
                const product = await Product.findById(item.product);
                if (product) {
                    if (product.stock_quantity < item.quantity) {
                        return res.status(400).json({ message: `Stok yetersiz: ${product.product_name}` });
                    }
                    product.stock_quantity -= item.quantity;
                    await product.save();
                }
            }
        }

        const updatedSale = await Sale.findByIdAndUpdate(saleId, updateData, { new: true })
            .populate("sale_items.product", "product_name product_barcode")
            .populate("sold_by", "user_username");

        res.status(200).json(updatedSale);
    } catch (error) {
        console.error("Satış güncellenirken hata: ", error);
        
        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}