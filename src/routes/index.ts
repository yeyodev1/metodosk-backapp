import express, { Application } from "express";
import paymentRouter from "./payment.routes";
import authRouter from "./auth.routes";
import adminRouter from "./admin.routes";
import courseRouter from "./course.routes";
import settingsRouter from "./settings.routes";
import progressRouter from "./progress.routes";
import commentRouter from "./comment.routes";
import onboardingRouter from "./onboarding.routes";
import communityRouter from "./community.routes";
import metaRouter from "./meta.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/payments", paymentRouter);
  router.use("/auth", authRouter);
  router.use("/admin", adminRouter);
  router.use("/courses", courseRouter);
  router.use("/settings", settingsRouter);
  router.use("/progress", progressRouter);
  router.use("/comments", commentRouter);
  router.use("/onboarding", onboardingRouter);
  router.use("/comunidad", communityRouter);
  router.use("/meta", metaRouter);
}

export default routerApi;
