import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { getExchangeRates } from "../controllers/exchangeRate.controller.js";

const router = express.Router();

router.get("/", protect, getExchangeRates);

export default router;
