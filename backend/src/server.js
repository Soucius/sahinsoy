import { ENV } from "./libs/env.js";
import express from "express";
import cors from "cors";
import { connectDB } from "./libs/db.js";
import userRoutes from "./routes/user.route.js";
import permissionRoutes from "./routes/permission.route.js";
import roleRoutes from "./routes/role.route.js";
import brandRoutes from "./routes/brand.route.js";
import unitRoutes from "./routes/unit.route.js";
import productRoutes from "./routes/product.route.js";
import saleRoutes from "./routes/sale.route.js";
import categoryRoutes from "./routes/category.route.js";
import dashboardRoutes from "./routes/dashboard.route.js";

const app = express();
const PORT = ENV.PORT || 3000;

app.use(express.json());
app.use(cors({
    origin: ENV.CLIENT_URL || "http://localhost:5173",
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use("/api/users", userRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/units", unitRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/dashboard", dashboardRoutes);

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server started on: http://localhost:${PORT}`);
    });
});