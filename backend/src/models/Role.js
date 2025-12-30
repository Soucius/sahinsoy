import mongoose from "mongoose";

const roleSchema = new mongoose.Schema({
    role_name: {
        type: String,
        required: true,
        unique: true
    },
    role_permissions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Permission"
    }]
}, { timestamps: true });

const Role = mongoose.model("Role", roleSchema);

export default Role;