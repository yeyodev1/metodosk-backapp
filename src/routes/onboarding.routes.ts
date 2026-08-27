import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as onboardingController from "../controllers/onboarding.controller";

const router = Router();

// Todo el recorrido es de quien tiene la sesión: nunca se recibe un id ajeno.
router.use(authMiddleware);
router.get("/", onboardingController.estado);
router.post("/video-visto", onboardingController.videoVisto);
router.post("/foto/firma", onboardingController.firmarFoto);
router.post("/foto", onboardingController.guardarFoto);
router.delete("/foto/:angulo", onboardingController.quitarFoto);
router.post("/saltar", onboardingController.saltar);
router.post("/reabrir", onboardingController.reabrir);

export default router;
