import { Router } from "express";
import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.post("/confirm", paymentController.confirm);
router.get("/pricing", paymentController.pricing);

export default router;
