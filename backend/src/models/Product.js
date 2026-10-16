import mongoose from "mongoose";

export const technicalLimitFields = Object.freeze([
    "min_width_cm", "min_height_cm", "max_width_cm", "max_height_cm",
    "max_m2", "max_load_kg", "tube_diameter_mm", "slat_width_mm"
]);

const fixedDimensionsSchema = new mongoose.Schema({
    width_cm: { type: Number, default: 0, validate: value => Number.isFinite(value) && value >= 0 },
    height_cm: { type: Number, default: 0, validate: value => Number.isFinite(value) && value >= 0 }
}, { _id: false, strict: "throw" });

const technicalLimitsSchema = new mongoose.Schema(Object.fromEntries(technicalLimitFields.map(field => [field, {
    type: Number, validate: value => Number.isFinite(value) && value > 0
}])), { _id: false, strict: "throw" });

const extraOptionSchema = new mongoose.Schema({
    pricing_basis: { type: String, enum: ["birim", "adet", "mt", "m2", "yuzde"], default: "birim" },
    pricing_scope: { type: String, enum: ["parca", "kasa"], default: "parca" },
    currency: { type: String, enum: ["TRY", "USD", "EUR"], default: "TRY" },
    option_name: { type: String, required: true },
    price_impact: { type: Number, required: true, default: 0, min: 0 }
});

const productSchema = new mongoose.Schema({
    catalog_id: { type: String, unique: true, sparse: true },
    stock_tracking: { type: Boolean, default: true },
    currency: { type: String, enum: ["TRY", "USD", "EUR"], default: "TRY" },
    fabric_width_cm: { type: Number, default: 0 },
    grammage_gr: { type: Number, default: 0 },
    supplier_unit: { type: String, trim: true, maxlength: 199, validate: value => typeof value === "string" && value.length > 0 },
    fixed_dimensions: {
        type: fixedDimensionsSchema,
        default: undefined,
        validate: value => value != null && (value.width_cm > 0 || value.height_cm > 0)
    },
    technical_limits: {
        type: technicalLimitsSchema,
        default: undefined,
        validate: value => value != null
            && technicalLimitFields.some(field => value[field] !== undefined)
            && (value.min_width_cm === undefined || value.max_width_cm === undefined || value.min_width_cm <= value.max_width_cm)
            && (value.min_height_cm === undefined || value.max_height_cm === undefined || value.min_height_cm <= value.max_height_cm)
    },
    variants: [{ vr: { type: String, trim: true }, color: { type: String, trim: true }, stock_quantity: { type: Number, default: 0, min: 0 } }],
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
        default: 0,
        min: 0
    },
    rounding_step: {
        type: Number,
        default: 0,
        min: 0
    },
    min_width_cm: { type: Number, default: 0, min: 0 },
    min_height_cm: { type: Number, default: 0, min: 0 },
    dimension_rounding_cm: { type: Number, default: 0, min: 0 },
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
