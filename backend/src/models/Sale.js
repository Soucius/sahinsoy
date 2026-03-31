import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    unit_price: { type: Number, required: true },
    total_price: { type: Number, required: true },
    room_name: { type: String, default: "" },      
    facade: { type: String, default: "" },         
    window_name: { type: String, default: "" },    
    item_note: { type: String, default: "" },      
    is_ordered: { type: Boolean, default: false }  
});


const saleSchema = new mongoose.Schema({
    sale_items: [saleItemSchema],
    sub_total: { type: Number, required: true },       
    discount_amount: { type: Number, default: 0 },     
    credit_card_fee: { type: Number, default: 0 },     
    grand_total: { type: Number, required: true },     
    payment_method: { type: String, default: "Nakit" },
    status: { 
        type: String, 
        enum: ["beklemede", "tamamlandi"], 
        default: "tamamlandi" 
    },
    customer_name: { type: String, default: "" },
    customer_phone: { type: String, default: "" },
    customer_address: { type: String, default: "" },
    delivery_date: { type: Date, default: null },
    sale_note: { type: String, default: "" },          
    sold_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

const Sale = mongoose.model("Sale", saleSchema);

export default Sale;