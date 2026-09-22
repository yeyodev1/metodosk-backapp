import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as onboardingController from "../controllers/onboarding.controller";
import * as avancesController from "../controllers/avances.controller";

const router = Router();

// Todo el recorrido es de quien tiene la sesión: nunca se recibe un id ajeno.
router.use(authMiddleware);
router.get("/", onboardingController.estado);
router.post("/video-visto", onboardingController.videoVisto);
router.post("/foto/firma", onboardingController.firmarFoto);
router.post("/foto", onboardingController.guardarFoto);
router.delete("/foto/:angulo", onboardingController.quitarFoto);
router.post("/medidas", onboardingController.guardarMedidas);
router.delete("/medidas/:fecha", onboardingController.quitarMedidas);
// Lo que el equipo le comentó sobre su avance, y sus respuestas.
router.get("/notas", avancesController.misNotas);
router.post("/notas", avancesController.responder);
router.post("/notas/leidas", avancesController.marcarLeidas);
router.post("/saltar", onboardingController.saltar);
router.post("/reabrir", onboardingController.reabrir);

export default router;
