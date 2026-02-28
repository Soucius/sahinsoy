import mongoose from "mongoose";

const unitSchema = new mongoose.Schema({
    unit_name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    unit_code: {
        type: String,
        required: true,
        unique: true,
        trim: true
    }
}, { timestamps: true });

const Unit = mongoose.model("Unit", unitSchema);

export default Unit;