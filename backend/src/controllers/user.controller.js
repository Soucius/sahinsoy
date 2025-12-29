import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ENV } from "../libs/env.js";

const generateToken = (id) => {
    return jwt.sign({ id }, ENV.JWT_SECRET, {
        expiresIn: "7d"
    });
};

export async function getAllUsers(req, res) {
    try {
        const users = await User.find().select("-user_password").sort({ createdAt: -1 });

        res.status(200).json(users);
    } catch (error) {
        console.error("Error fetching users: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}