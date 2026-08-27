import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as progressController from "../controllers/progress.controller";

const router = Router();

// El avance es de quien tiene la sesión: nunca se recibe un id de usuario.
router.use(authMiddleware);
router.get("/", progressController.mio);
router.put("/", progressController.guardar);
router.post("/vista", progressController.marcarVista);

export default router;
