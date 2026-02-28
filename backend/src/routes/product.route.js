import express from "express";
import { createProduct, getAllProducts, deleteProduct } from "../controllers/product.controller.js";
import protect from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.get("/", protect, getAllProducts);
router.post("/", protect, upload.single("product_image"), createProduct);
router.delete("/:id", protect, deleteProduct);

export default router;