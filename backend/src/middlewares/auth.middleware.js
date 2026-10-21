import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { ENV } from "../libs/env.js";

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        try {
            token = req.headers.authorization.split(" ")[1];

            const decoded = jwt.verify(token, ENV.JWT_SECRET);

            if (decoded.scope || decoded.aud) return res.status(403).json({ message: "Üretim personeli POS alanına erişemez." });

            req.user = await User.findById(decoded.id).select("-user_password -resetPasswordOTP -resetPasswordExpires").populate("user_role", "role_name");
            if (!req.user) return res.status(401).json({ message: "Kullanıcı bulunamadı. Yeniden giriş yapın." });

            next();
        } catch (error) {
            res.status(401).json({ message: "Yetkiniz yok, token geçersiz." });
        }
    }

    if (!token) {
        res.status(401).json({ message: "Yetkiniz yok, token bulunamadı." });
    }
};

export default protect;
