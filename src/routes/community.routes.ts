import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as communityController from "../controllers/community.controller";

const router = Router();

// El muro es de las alumnas con sesión: es su comunidad, no un foro abierto.
router.use(authMiddleware);
// Las de avatar van antes que "/:id": si no, borrar el avatar entraría por
// la ruta de borrar un mensaje llamado "avatar".
router.get("/avatar", communityController.miAvatar);
router.post("/avatar/firma", communityController.firmarAvatar);
router.post("/avatar", communityController.guardarAvatar);
router.delete("/avatar", communityController.quitarAvatar);

router.get("/", communityController.listar);
router.post("/", communityController.publicar);
router.delete("/:id", communityController.borrar);

export default router;
