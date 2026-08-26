import express, { Application } from "express";
import paymentRouter from "./payment.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/payments", paymentRouter);
}

export default routerApi;
