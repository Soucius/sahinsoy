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
    client_request_id: { type: String, unique: true, sparse: true },
    measurement_status: { type: String, enum: ["preliminary", "scheduled", "confirmed"], default: "preliminary" },
    measurement_date: { type: Date, default: null },
    measurement_master: { type: String, default: "", maxlength: 120 },
    measurement_note: { type: String, default: "", maxlength: 2000 },
    measurement_revision: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    measurement_history: {
        type: [new mongoose.Schema({
            kind: { type: String, enum: ["plan", "measurement"], required: true },
            revision: { type: Number, required: true, min: 1 },
            request_id: { type: String, default: "" },
            changed_at: { type: Date, required: true },
            changed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
            before: { type: mongoose.Schema.Types.Mixed, required: true },
            after: { type: mongoose.Schema.Types.Mixed, required: true }
        }, { _id: false })],
        default: []
    },
    approved_at: { type: Date, default: null },
    lost_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    delivered_at: { type: Date, default: null },
    delivered_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    stock_deductions: {
        type: [new mongoose.Schema({
            product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
            quantity: { type: Number, required: true, min: 0.000001 }
        }, { _id: false })],
        default: null
    },
    stock_restoration_pending: { type: Boolean, default: false },
    pos_details: { type: mongoose.Schema.Types.Mixed, default: null },
    discount_percent: { type: Number, default: 0, min: 0, max: 100 },
    delivery_method: { type: String, enum: ["store", "installation", "magaza", "montaj", ""], default: "" },
    sale_items: [saleItemSchema],
    sub_total: { type: Number, required: true },       
    discount_amount: { type: Number, default: 0 },     
    credit_card_fee: { type: Number, default: 0 },     
    grand_total: { type: Number, required: true },     
    payment_method: { type: String, default: "Nakit" },
    payment_revision: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    payments: { type: [new mongoose.Schema({
        request_id: { type: String, required: true, maxlength: 100 },
        amount: { type: Number, required: true, min: 0.01 },
        method: { type: String, enum: ["Nakit", "Havale / EFT", "Kredi Kartı", "Mail Order"], required: true },
        kind: { type: String, enum: ["Kapora", "Ara ödeme", "Teslimat ödemesi", "Tam ödeme"], required: true },
        paid_date: { type: String, required: true },
        note: { type: String, default: "", maxlength: 500 },
        recorded_at: { type: Date, required: true },
        recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        voided_at: { type: Date, default: null },
        voided_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        void_reason: { type: String, default: "", maxlength: 500 }
    }, { _id: false })], default: [] },
    status: { 
        type: String, 
        enum: ["beklemede", "tamamlandi", "kaybedildi", "iptal", "teslim_edildi"],
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
