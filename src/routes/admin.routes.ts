import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as adminController from "../controllers/admin.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get("/orders", adminController.listOrders);

export default router;
