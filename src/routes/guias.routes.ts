import { Router, Response, NextFunction } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { AuthRequest } from "../types/AuthRequest";
import { guiasDeAlumna } from "../services/guias.service";

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/guias — su guía de nutrición, como contenido.
 *
 * Va detrás de la sesión a propósito: es el material que se compró, y en el
 * bundle del navegador lo podría leer cualquiera.
 */
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ guias: await guiasDeAlumna(req.user!.userId) });
  } catch (error) {
    next(error);
  }
});

export default router;
