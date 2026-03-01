import express from "express";
import { getAllUnits, createUnit, deleteUnit, updateUnit } from "../controllers/unit.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllUnits);
router.post("/", protect, createUnit);
router.put("/:id", protect, updateUnit);
router.delete("/:id", protect, deleteUnit);

export default router;