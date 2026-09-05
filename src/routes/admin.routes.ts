import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as adminController from "../controllers/admin.controller";
import * as courseController from "../controllers/course.controller";
import * as settingsController from "../controllers/settings.controller";
import * as commentController from "../controllers/comment.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get("/orders", adminController.listOrders);
router.post("/orders/restaurar", adminController.restaurarEstados);
router.patch("/orders/:id/prueba", adminController.marcarPrueba);
router.delete("/orders/:id", adminController.eliminarOrden);

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

// El video de bienvenida (VSL) que ve quien acaba de comprar.
router.get("/vsl", settingsController.vslAdmin);
router.post("/vsl/video", settingsController.prepararVsl);
router.get("/vsl/estado", settingsController.refrescarVsl);
router.delete("/vsl", settingsController.borrarVsl);

// Moderación de comentarios.
router.get("/comments", commentController.listarAdmin);
router.put("/comments/:id/hidden", commentController.ocultar);
router.delete("/comments/:id", commentController.eliminar);

export default router;
