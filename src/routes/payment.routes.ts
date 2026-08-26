import { Router } from "express";
import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.post("/confirm", paymentController.confirm);
router.post("/resend", paymentController.resend);
router.get("/pricing", paymentController.pricing);

export default router;
