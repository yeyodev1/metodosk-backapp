import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as commentController from "../controllers/comment.controller";

const router = Router();

// Comentar es de alumnas con sesión: es la comunidad del reto, no un muro abierto.
router.use(authMiddleware);
router.get("/", commentController.listar);
router.post("/", commentController.crear);
router.delete("/:id", commentController.borrar);

export default router;
