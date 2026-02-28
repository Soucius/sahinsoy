import mongoose from "mongoose";

const brandSchema = new mongoose.Schema({
    brand_name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    brand_description: {
        type: String,
        default: ""
    }
}, { timestamps: true });

const Brand = mongoose.model("Brand", brandSchema);

export default Brand;