import express from "express";
import { createSale, getAllSales } from "../controllers/sale.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllSales);
router.post("/", protect, createSale);

export default router;