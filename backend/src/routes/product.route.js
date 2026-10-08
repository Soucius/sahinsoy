import express from "express";
import { createProduct, getAllProducts, deleteProduct, updateProduct } from "../controllers/product.controller.js";
import protect from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
import { importCatalog } from "../controllers/catalog.controller.js";
import { appendCatalogVariants } from "../controllers/catalogVariants.controller.js";

const router = express.Router();

router.get("/", protect, getAllProducts);
router.post("/import-catalog", protect, importCatalog);
router.post("/import-variants", protect, appendCatalogVariants);
router.post("/", protect, upload.single("product_image"), createProduct);
router.put("/:id", protect, upload.single("product_image"), updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;
