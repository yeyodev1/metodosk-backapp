import { Router, Request, Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { enviarTandaDeRecursos } from "../services/recursos.service";
import { sendResourcesEmail } from "../helpers/email.helper";

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
 * GET /api/cron/recursos — la tanda de la lista de implementos.
 *
 * Corre cada hora, no una vez al día, para que un envío pendiente empiece
 * dentro de la hora y no al día siguiente. No se desborda: quienes compran
 * ahora ya reciben la lista en su correo de acceso y nacen marcadas, así que
 * el grupo pendiente es finito —las que compraron antes— y se vacía en dos o
 * tres corridas. A partir de ahí no hace nada.
 *
 * Vercel Cron solo hace GET, de ahí el verbo para algo que escribe.
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

/**
 * Token de la ruta de prueba de abajo. Temporal y desechable.
 *
 * Va en el código y no en una variable de entorno a propósito: esta ruta se
 * borra en cuanto Scarlett y Diego den el visto bueno al correo, y lo único
 * que protege es que nadie más pueda mandarle un correo a una sola dirección
 * fija. No hay secreto real que filtrar.
 */
const TOKEN_PRUEBA = "sk-prueba-recursos-2026";

/** A quién se le manda la prueba. Fijo: la ruta no acepta destinatario. */
const DESTINO_PRUEBA = "dreyes@bakano.ec";

/**
 * GET /api/cron/recursos/prueba?token=… — un solo correo, para revisarlo.
 *
 * El correo de recursos se escribió sin poder probarlo: la API key de Resend
 * vive en producción y no sale de ahí. Esta ruta lo manda desde donde la key
 * ya está configurada, a una dirección fija, para poder verlo antes de que
 * salgan las ~50 de verdad.
 *
 * TEMPORAL: se borra en cuanto el correo esté aprobado.
 */
router.get("/recursos/prueba", async (req, res, next) => {
  try {
    if (req.query.token !== TOKEN_PRUEBA) {
      throw new CustomError("No autorizado", 401);
    }
    const ok = await sendResourcesEmail({ to: DESTINO_PRUEBA, name: "Diego" });
    res.status(200).json({ enviado: ok, a: DESTINO_PRUEBA });
  } catch (error) {
    next(error);
  }
});

export default router;
