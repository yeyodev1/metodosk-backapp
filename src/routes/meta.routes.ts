import { Router } from "express";
import * as metaController from "../controllers/meta.controller";

const router = Router();

/** Espejo servidor del pixel. Abierto: lo llama la landing sin sesión. */
router.post("/event", metaController.track);

export default router;
