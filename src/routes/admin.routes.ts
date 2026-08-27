import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as adminController from "../controllers/admin.controller";
import * as courseController from "../controllers/course.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get("/orders", adminController.listOrders);

// Cursos: la ruta del método y sus videos.
router.get("/courses", courseController.listar);
router.post("/courses", courseController.crear);
router.put("/courses/orden", courseController.reordenar);
router.put("/courses/:id", courseController.actualizar);
router.delete("/courses/:id", courseController.eliminar);
router.post("/courses/:id/video", courseController.prepararVideo);
router.get("/courses/:id/video", courseController.refrescarVideo);
router.post("/courses/:id/lessons", courseController.agregarClase);
router.delete("/courses/:id/lessons/:lessonId", courseController.eliminarClase);

export default router;
