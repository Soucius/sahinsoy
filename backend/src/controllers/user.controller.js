import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ENV } from "../libs/env.js";
import Role from "../models/Role.js";
import { sendEmail } from "../libs/mailer.js";

const generateToken = (id) => {
    return jwt.sign({ id }, ENV.JWT_SECRET, {
        expiresIn: "7d"
    });
};

export async function getAllUsers(_, res) {
    try {
        const users = await User.find().select("-user_password").sort({ createdAt: -1 });

        res.status(200).json(users);
    } catch (error) {
        console.error("Error fetching users: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function getUserById(req, res) {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching user: ", error);

        res.status(500).json({ message: "Internal server error" });
    }
}

export async function createUser(req, res) {
    try {
        const { user_username, user_email, user_phone, user_password } = req.body;

        const defaultRole = await Role.findOne({ role_name: "Satış Temsilcisi" });

        if (!defaultRole) {
            return res.status(500).json({ message: "Default role not found" });
        }

        const newUser = new User({
            user_username,
            user_email,
            user_phone,
            user_password,
            user_role: defaultRole._id
        });

        const savedUser = await newUser.save();
        const token = generateToken(savedUser._id);

        res.status(201).json({ token, user: savedUser });
    } catch (error) {
        console.error("Error creating user: ", error);
        
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: error.message });
        }

        if (error.code === 11000) {
            return res.status(400).json({ message: "Bu e-posta veya telefon numarası zaten kayıtlı." });
        }

        res.status(500).json({ message: "Internal server error" });
    }
}

export async function updateUser(req, res) {
    try {
        const userId = req.params.id;
        const updateData = req.body;

        if (updateData.user_password && updateData.user_password !== "") {
            const salt = await bcrypt.genSalt(10);

            updateData.user_password = await bcrypt.hash(updateData.user_password, salt);
        } else {
            delete updateData.user_password;
        }

        const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true }).select("-user_password");

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(updatedUser);
    } catch (error) {
        console.error("Error updating user: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function deleteUser(req, res) {
    try {
        const deletedUser = await User.findByIdAndDelete(req.params.id);

        if (!deletedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
        console.error("Error deleting user: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function loginUser(req, res) {
    try {
        const { user_email, user_password } = req.body;

        const user = await User.findOne({ user_email });

        if (!user) {
            return res.status(404).json({ message: "Kullanıcı bulunamadı." });
        }

        const isMatch = await bcrypt.compare(user_password, user.user_password);

        if (!isMatch) {
            return res.status(400).json({ message: "Geçersiz şifre." });
        }

        const token = generateToken(user._id);

        res.status(200).json({ token, user: { _id: user._id, user_username: user.user_username, user_email: user.user_email } });
    } catch (error) {
        console.error("Error logging in user: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function forgotPassword(req, res) {
    try {
        const { user_email } = req.body;
        const user = await User.findOne({ user_email });

        if (!user) {
            return res.status(404).json({ message: "Bu e-posta adresine ait kullanıcı bulunamadı." });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        user.resetPasswordOTP = otp;
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
        await user.save();

        const emailText = `Merhaba ${user.user_username},\n\nŞifre sıfırlama kodunuz: ${otp}\n\nBu kod 10 dakika boyunca geçerlidir. Lütfen kimseyle paylaşmayın.`;
        await sendEmail({
            to: user.user_email,
            subject: "Şahinsoy Perde - Şifre Sıfırlama Kodu",
            text: emailText
        });

        res.status(200).json({ message: "Şifre sıfırlama kodu (OTP) e-posta adresinize gönderildi." });
    } catch (error) {
        console.error("Error in forgotPassword: ", error);

        res.status(500).json({ message: "Kod gönderilirken bir hata oluştu." });
    }
}

export async function resetPassword(req, res) {
    try {
        const { user_email, otp, new_password } = req.body;

        const user = await User.findOne({ 
            user_email, 
            resetPasswordOTP: otp,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: "Geçersiz veya süresi dolmuş kod girdiniz." });
        }

        user.user_password = new_password;
        user.resetPasswordOTP = null;
        user.resetPasswordExpires = null;
        
        await user.save();

        res.status(200).json({ message: "Şifreniz başarıyla güncellendi." });
    } catch (error) {
        console.error("Error in resetPassword: ", error);

        res.status(500).json({ message: "Şifre sıfırlanırken bir hata oluştu." });
    }
}