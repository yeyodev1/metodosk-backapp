import { Router, Request, Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { enviarTandaDeRecursos } from "../services/recursos.service";

const router = Router();

/**
 * Solo Vercel Cron puede disparar esto.
 *
 * Vercel manda `Authorization: Bearer $CRON_SECRET` en cada corrida. Sin el
 * secreto configurado la ruta queda cerrada: es preferible que el envío no
 * ocurra a que cualquiera desde internet pueda gastar la cuota de correos.
 */
function soloCron(req: Request, _res: Response, next: NextFunction) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return next(new CustomError("CRON_SECRET no está configurado", 503));
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return next(new CustomError("No autorizado", 401));
  }
  next();
}

/**
 * GET /api/cron/recursos — la tanda diaria de la lista de implementos.
 *
 * Vercel Cron solo hace GET, de ahí el verbo para algo que escribe. Cuando ya
 * no queda nadie pendiente no hace nada, así que puede seguir corriendo cada
 * día sin molestar a nadie.
 */
router.get("/recursos", soloCron, async (_req, res, next) => {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError("Sin base de datos", 503);
    }
    const resultado = await enviarTandaDeRecursos();
    console.log(
      `[cron] recursos: ${resultado.enviados} enviados, ${resultado.fallidos} fallidos, ${resultado.pendientes} pendientes`,
    );
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
});

export default router;
