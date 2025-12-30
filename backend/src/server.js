import { ENV } from "./libs/env.js";
import express from "express";
import cors from "cors";
import { connectDB } from "./libs/db.js";
import userRoutes from "./routes/user.route.js";
import permissionRoutes from "./routes/permission.route.js";
import roleRoutes from "./routes/role.route.js";

const app = express();
const PORT = ENV.PORT || 3000;

app.use(express.json());
app.use(cors({
    origin: "http://localhost:5173/",
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use("/api/users", userRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/roles", roleRoutes);

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server started on: http://localhost:${PORT}`);
    });
});