import mongoose from "mongoose";
import { ENV } from "../libs/env.js";

export const connectDB = async () => {
    try {
        await mongoose.connect(ENV.MONGO_URI);

        console.log("Successfully connected to the MongoDB");
    } catch (error) {
        console.error("Error connecting to the MongoDB: ", error);
        
        process.exit(1);
    }
};