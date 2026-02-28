import nodemailer from "nodemailer";
import { ENV } from "./env.js";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: ENV.SMTP_USER,
        pass: ENV.SMTP_PASS
    }
});

export const sendEmail = async ({ to, subject, text }) => {
    try {
        const mailOptions = {
            from: `"Şahinsoy Perde" <${ENV.SMTP_USER}>`,
            to,
            subject,
            text
        };

        const info = await transporter.sendMail(mailOptions);

        console.log("Email gönderildi: ", info.response);

        return info;
    } catch (error) {
        console.error("Email gönderme hatası: ", error);

        throw error;
    }
};