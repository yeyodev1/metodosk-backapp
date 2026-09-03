import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.post("/confirm", paymentController.confirm);
router.post("/resend", paymentController.resend);
router.get("/pricing", paymentController.pricing);
router.get("/mine", authMiddleware, paymentController.misPagos);
router.get("/beneficios", authMiddleware, paymentController.beneficios);

export default router;
