import mongoose from "mongoose";

const extraOptionSchema = new mongoose.Schema({
    option_name: { type: String, required: true },
    price_impact: { type: Number, required: true, default: 0 }
});

const productSchema = new mongoose.Schema({
    product_name: {
        type: String,
        required: true,
        trim: true
    },
    product_barcode: {
        type: String,
        trim: true,
        unique: true,
        sparse: true
    },
    product_category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: true
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
    calculation_type: {
        type: String,
        enum: ["adet", "m2", "mt"],
        default: "adet"
    },
    min_m2: {
        type: Number,
        default: 0
    },
    rounding_step: {
        type: Number,
        default: 0
    },
    extra_options: [extraOptionSchema],

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