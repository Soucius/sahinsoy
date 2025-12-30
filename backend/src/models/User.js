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