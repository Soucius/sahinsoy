import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema({
    product: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Product", 
        required: true 
    },
    quantity: { 
        type: Number, 
        required: true 
    },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    unit_price: { type: Number, required: true },
    total_price: { type: Number, required: true }
});

const saleSchema = new mongoose.Schema({
    sale_items: [saleItemSchema],
    grand_total: { 
        type: Number, 
        required: true 
    },
    payment_method: { 
        type: String, 
        default: "Nakit"
    },
    sold_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
    }
}, { timestamps: true });

const Sale = mongoose.model("Sale", saleSchema);

export default Sale;