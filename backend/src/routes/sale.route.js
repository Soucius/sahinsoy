import express from "express";
import { createSale, getAllSales, updateSale, cancelSale, deliverSale, planSaleMeasurement, reviseSaleMeasurements } from "../controllers/sale.controller.js";
import { addSalePayment, voidSalePayment } from "../controllers/salePayment.controller.js";
import protect from "../middlewares/auth.middleware.js";
import { testSaleArchiveHandlers } from '../libs/testSaleArchive.js';

const router = express.Router();
router.get('/test-archive', protect, testSaleArchiveHandlers.list);
router.post('/test-archive', protect, testSaleArchiveHandlers.archive);
router.post('/test-archive/restore', protect, testSaleArchiveHandlers.restore);

router.get("/", protect, getAllSales);
router.post("/", protect, createSale);
router.post("/:id/cancel", protect, cancelSale);
router.post("/:id/deliver", protect, deliverSale);
router.post("/:id/measurement-plan", protect, planSaleMeasurement);
router.post("/:id/measurements", protect, reviseSaleMeasurements);
router.post("/:id/payments", protect, addSalePayment);
router.post("/:id/payments/:paymentId/void", protect, voidSalePayment);
router.put("/:id", protect, updateSale);

export default router;
