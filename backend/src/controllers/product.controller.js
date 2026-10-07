import Product from "../models/Product.js";
import cloudinary from "../libs/cloudinary.js";

function productExtras(body){
    const out={};
    if(body.stock_tracking!==undefined)out.stock_tracking=body.stock_tracking===true||body.stock_tracking==="true";
    if(body.currency!==undefined){if(!["TRY","USD","EUR"].includes(body.currency))throw new Error("INVALID_PRODUCT");out.currency=body.currency;}
    if(body.variants!==undefined){
        const variants=typeof body.variants==="string"?JSON.parse(body.variants):body.variants;
        if(!Array.isArray(variants)||variants.length>500)throw new Error("INVALID_PRODUCT");
        const keys=new Set();out.variants=variants.map(v=>{
            const vr=String(v.vr||"").trim(),color=String(v.color||"").trim(),stock=Number(v.stock_quantity??0),key=vr+'|'+color;
            if((!vr&&!color)||vr.length>100||color.length>100||!Number.isFinite(stock)||stock<0||keys.has(key))throw new Error("INVALID_PRODUCT");
            keys.add(key);return{vr,color,stock_quantity:stock};
        });
    }
    return out;
}

export async function createProduct(req, res) {
    try {
        const { 
            product_name, product_barcode, product_category, product_brand, product_unit, 
            calculation_type, min_m2, rounding_step, extra_options,
            stock_quantity, product_color, purchase_price, sale_price 
        } = req.body;

        let imageUrl = null;
        
        if (req.file) {
            const b64 = Buffer.from(req.file.buffer).toString("base64");
            let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
            const result = await cloudinary.uploader.upload(dataURI, { folder: "sahinsoy_products" });
            imageUrl = result.secure_url;
        }

        let parsedOptions = [];

        if (extra_options) {
            try { parsedOptions = JSON.parse(extra_options); } 
            catch (e) { console.error("Extra options ayrıştırma hatası", e); }
        }

        const newProduct = new Product({
            ...productExtras(req.body),
            product_name,
            product_barcode,
            product_category,
            product_brand,
            product_unit,
            calculation_type: calculation_type || "adet",
            min_m2: min_m2 ? Number(min_m2) : 0,
            rounding_step: rounding_step ? Number(rounding_step) : 0,
            extra_options: parsedOptions,
            stock_quantity: Number(stock_quantity),
            product_color,
            purchase_price: Number(purchase_price),
            sale_price: Number(sale_price),
            product_image: imageUrl 
        });

        const savedProduct = await newProduct.save();

        res.status(201).json(savedProduct);
    } catch (error) {
        console.error("Ürün oluşturulurken hata: ", error);

        if (error.code === 11000) return res.status(400).json({ message: "Bu barkod numarası başka bir üründe kullanılıyor." });

        res.status(500).json({ message: "Ürün eklenirken sunucu hatası oluştu." });
    }
}

export async function getAllProducts(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(3000,Math.max(1,parseInt(req.query.limit) || 10));
        const search = req.query.search || "";
        const brandId = req.query.brand || "";
        const categoryId = req.query.category || "";
        const skip = (page - 1) * limit;
        let query = {};
        
        if (search) {
            const literal=search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
            query.$or = [
                { product_name: { $regex: literal, $options: "i" } },
                { product_barcode: { $regex: literal, $options: "i" } },
                { "variants.vr": { $regex: literal, $options: "i" } },
                { "variants.color": { $regex: literal, $options: "i" } }
            ];
        }

        if (brandId) query.product_brand = brandId;
        if (categoryId) query.product_category = categoryId;

        const products = await Product.find(query)
            .populate("product_category", "category_name")
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

export async function updateProduct(req, res) {
    try {
        const productId = req.params.id;
        let updateData = { ...req.body };
        Object.assign(updateData,productExtras(req.body));

        if (req.file) {
            const b64 = Buffer.from(req.file.buffer).toString("base64");
            let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
            const result = await cloudinary.uploader.upload(dataURI, { folder: "sahinsoy_products" });
            updateData.product_image = result.secure_url; 
        }

        if (updateData.extra_options) {
            try { updateData.extra_options = JSON.parse(updateData.extra_options); } 
            catch (e) { delete updateData.extra_options; }
        }

        const updatedProduct = await Product.findByIdAndUpdate(
            productId, 
            updateData, 
            { new: true, runValidators: true }
        ).populate("product_category", "category_name").populate("product_brand", "brand_name").populate("product_unit", "unit_name unit_code");

        if (!updatedProduct) return res.status(404).json({ message: "Ürün bulunamadı." });

        res.status(200).json(updatedProduct);
    } catch (error) {
        console.error("Ürün güncellenirken hata: ", error);

        if (error.code === 11000) return res.status(400).json({ message: "Bu barkod numarası başka bir üründe kullanılıyor." });

        res.status(500).json({ message: "Ürün güncellenirken sunucu hatası oluştu." });
    }
}

export async function deleteProduct(req, res) {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) return res.status(404).json({ message: "Ürün bulunamadı." });

        res.status(200).json({ message: "Ürün başarıyla silindi." });
    } catch (error) {
        console.error("Ürün silinirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}
