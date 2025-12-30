import express from "express";
import { createPermission, deletePermission, getAllPermissions, getPermissionById, updatePermission } from "../controllers/permission.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllPermissions);
router.post("/", protect, createPermission);
router.put("/:id", protect, updatePermission);
router.get("/:id", protect, getPermissionById);
router.delete("/:id", protect, deletePermission);

export default router;