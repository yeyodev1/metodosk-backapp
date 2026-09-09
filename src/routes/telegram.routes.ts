import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as telegramController from "../controllers/telegram.controller";

const router = Router();

// Telegram no tiene sesión: el webhook se protege con su propio secreto.
router.post("/webhook", telegramController.webhook);

// Lo demás es de quien tiene la sesión.
router.get("/grupos", authMiddleware, telegramController.grupos);

export default router;
