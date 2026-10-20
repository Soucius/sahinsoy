import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { getCompanyLinks, saveCompanyLink } from "../controllers/mailOrderCompany.controller.js";
const router = express.Router();
router.get("/", protect, getCompanyLinks);
router.put("/", protect, saveCompanyLink);
export default router;
