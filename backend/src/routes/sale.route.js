import express from "express";
import { createSale, getAllSales, updateSale, cancelSale, deliverSale, planSaleMeasurement, reviseSaleMeasurements } from "../controllers/sale.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllSales);
router.post("/", protect, createSale);
router.post("/:id/cancel", protect, cancelSale);
router.post("/:id/deliver", protect, deliverSale);
router.post("/:id/measurement-plan", protect, planSaleMeasurement);
router.post("/:id/measurements", protect, reviseSaleMeasurements);
router.put("/:id", protect, updateSale);

export default router;
