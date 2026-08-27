import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as courseController from "../controllers/course.controller";

const router = Router();

// La ruta de la alumna. Requiere sesión: el material es lo que se vendió.
router.use(authMiddleware);
router.get("/", courseController.misCursos);

export default router;
