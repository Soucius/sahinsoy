import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
    user_username: {
        type: String,
        required: true,
        unique: true
    },
    user_password: {
        type: String,
        required: true
    },
    user_email: {
        type: String,
        required: true,
        unique: true
    },
    user_phone: {
        type: String,
        required: true,
        unique: true
    },
    user_role: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
        default: "6953f6857c119f679816bea5"
    }
}, { timestamps: true });

userSchema.pre("save", async function() {
    if (!this.isModified("user_password")) {
        return;
    }

    const salt = await bcrypt.genSalt(10);

    this.user_password = await bcrypt.hash(this.user_password, salt);
});

const User = mongoose.model("User", userSchema);

export default User;