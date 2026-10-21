import express from "express";
import { createRole, deleteRole, getAllRoles, getRoleById, updateRole } from "../controllers/role.controller.js";
import protect from "../middlewares/auth.middleware.js";
import { requireProductionAdmin } from "../middlewares/production.middleware.js";

const router = express.Router();

router.get("/", protect, getAllRoles);
router.post("/", protect, requireProductionAdmin, createRole);
router.get("/:id", protect, getRoleById);
router.put("/:id", protect, requireProductionAdmin, updateRole);
router.delete("/:id", protect, requireProductionAdmin, deleteRole);

export default router;
