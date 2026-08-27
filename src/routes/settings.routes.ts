import { Router } from "express";
import * as settingsController from "../controllers/settings.controller";

const router = Router();

// Sin sesión a propósito: el VSL se reproduce justo después de pagar, cuando
// todavía no hay cuenta con la que iniciar sesión.
router.get("/vsl", settingsController.vsl);

export default router;
