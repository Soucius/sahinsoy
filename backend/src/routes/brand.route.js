import express from "express";
import { getAllBrands, createBrand, deleteBrand, updateBrand } from "../controllers/brand.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllBrands);
router.post("/", protect, createBrand);
router.put("/:id", protect, updateBrand);
router.delete("/:id", protect, deleteBrand);

export default router;