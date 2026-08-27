import express, { Application } from "express";
import paymentRouter from "./payment.routes";
import authRouter from "./auth.routes";
import adminRouter from "./admin.routes";
import courseRouter from "./course.routes";
import settingsRouter from "./settings.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/payments", paymentRouter);
  router.use("/auth", authRouter);
  router.use("/admin", adminRouter);
  router.use("/courses", courseRouter);
  router.use("/settings", settingsRouter);
}

export default routerApi;
