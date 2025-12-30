import express from "express";
import { createUser, deleteUser, getAllUsers, getUserById, loginUser, updateUser } from "../controllers/user.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getAllUsers);
router.post("/", createUser);
router.get("/:id", protect, getUserById);
router.put("/:id", protect, updateUser);
router.delete("/:id", protect, deleteUser);
router.post("/login", loginUser);

export default router;