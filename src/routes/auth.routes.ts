import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as authController from "../controllers/auth.controller";

const router = Router();

router.post("/login", authController.login);
router.post("/check-email", authController.checkEmail);
router.post("/register", authController.register);
// Olvidé mi contraseña: pedir el enlace, y usarlo.
router.post("/recuperar", authController.recuperar);
router.post("/restablecer", authController.restablecer);
router.get("/me", authMiddleware, authController.me);
router.put("/password", authMiddleware, authController.changePassword);

export default router;
