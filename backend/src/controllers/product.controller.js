import Product from "../models/Product.js";
import cloudinary from "../libs/cloudinary.js";

export async function createProduct(req, res) {
    try {
        const { product_name, product_brand, product_unit, stock_quantity, product_color, purchase_price, sale_price } = req.body;

        let imageUrl = null;

        if (req.file) {
            const b64 = Buffer.from(req.file.buffer).toString("base64");
            let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
            const result = await cloudinary.uploader.upload(dataURI, {
                folder: "sahinsoy_products"
            });

            imageUrl = result.secure_url;
        }

        const newProduct = new Product({
            product_name,
            product_brand,
            product_unit,
            stock_quantity,
            product_color,
            purchase_price,
            sale_price,
            product_image: imageUrl
        });

        const savedProduct = await newProduct.save();

        res.status(201).json(savedProduct);
    } catch (error) {
        console.error("Ürün oluşturulurken hata: ", error);

        res.status(500).json({ message: "Ürün eklenirken sunucu hatası oluştu." });
    }
}

export async function getAllProducts(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || "";
        const brandId = req.query.brand || "";
        const skip = (page - 1) * limit;
        let query = {};
        
        if (search) {
            query.product_name = { $regex: search, $options: "i" };
        }

        if (brandId) {
            query.product_brand = brandId;
        }

        const products = await Product.find(query)
            .populate("product_brand", "brand_name")
            .populate("product_unit", "unit_name unit_code")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Product.countDocuments(query);

        res.status(200).json({
            products,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalProducts: total
        });

    } catch (error) {
        console.error("Ürünler getirilirken hata: ", error);

        res.status(500).json({ message: "Ürünler listelenirken sunucu hatası oluştu." });
    }
}

export async function deleteProduct(req, res) {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({ message: "Ürün bulunamadı." });
        }

        res.status(200).json({ message: "Ürün başarıyla silindi." });
    } catch (error) {
        console.error("Ürün silinirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}