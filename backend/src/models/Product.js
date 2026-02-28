import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
    product_name: {
        type: String,
        required: true,
        trim: true
    },
    product_brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Brand",
        required: true
    },
    product_unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Unit",
        required: true
    },
    stock_quantity: {
        type: Number,
        required: true,
        default: 0
    },
    product_color: {
        type: String,
        trim: true,
        default: "Belirtilmedi"
    },
    purchase_price: {
        type: Number,
        required: true,
        min: 0
    },
    sale_price: {
        type: Number,
        required: true,
        min: 0
    },
    product_image: {
        type: String,
        default: null
    }
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);

export default Product;