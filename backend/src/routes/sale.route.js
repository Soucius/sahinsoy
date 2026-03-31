import express from "express";
import { createSale, getAllSales, updateSale } from "../controllers/sale.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllSales);
router.post("/", protect, createSale);
router.put("/:id", protect, updateSale);

export default router;