import express from "express";
import { createRole, deleteRole, getAllRoles, getRoleById, updateRole } from "../controllers/role.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllRoles);
router.post("/", protect, createRole);
router.get("/:id", protect, getRoleById);
router.put("/:id", protect, updateRole);
router.delete("/:id", protect, deleteRole);

export default router;