import { Router, Request, Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { enviarTandaDeRecursos } from "../services/recursos.service";
import { sendResourcesEmail } from "../helpers/email.helper";
import { restaurarDesdeRespuestaOriginal } from "../services/restauracion.service";
import { CheckoutIntent } from "../models/CheckoutIntent";

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

/**
 * GET /api/cron/restaurar?token=… — repara los estados desde acá.
 *
 * El botón equivalente ya existe en el panel, pero esto lo arregló quien lo
 * rompió sin pedirle a nadie que apriete nada. Es idempotente: reconstruye
 * desde `payphoneResponse`, así que correrlo de más no hace daño.
 *
 * TEMPORAL: se borra junto con la ruta de prueba de arriba.
 */
router.get("/restaurar", async (req, res, next) => {
  try {
    if (req.query.token !== TOKEN_PRUEBA) {
      throw new CustomError("No autorizado", 401);
    }
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError("Sin base de datos", 503);
    }
    const resultado = await restaurarDesdeRespuestaOriginal();
    console.log(`[restaurar] ${resultado.corregidas.length} compras recuperadas`);
    res.status(200).json({
      revisadas: resultado.revisadas,
      sinRespaldo: resultado.sinRespaldo,
      corregidas: resultado.corregidas.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cron/probar-intent?token=… — comprueba el camino del contacto.
 *
 * Escribe un intent de mentira, lo vuelve a leer como lo hace la confirmación
 * y lo borra. Si el correo que sale es el que entró, el arreglo funciona en
 * producción y no solo en el editor.
 *
 * TEMPORAL: se borra con las otras rutas de prueba.
 */
router.get("/probar-intent", async (req, res, next) => {
  try {
    if (req.query.token !== TOKEN_PRUEBA) {
      throw new CustomError("No autorizado", 401);
    }
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError("Sin base de datos", 503);
    }

    const id = `PRUEBA-INTENT-${Date.now()}`;
    const escrito = "el-correo-que-ella-escribio@ejemplo.com";

    await CheckoutIntent.findOneAndUpdate(
      { clientTransactionId: id },
      { clientTransactionId: id, name: "Prueba", email: escrito, phone: "0999", challenge: "SK Recomposición" },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const leido = await CheckoutIntent.findOne({ clientTransactionId: id }).lean();
    await CheckoutIntent.deleteOne({ clientTransactionId: id });

    res.status(200).json({
      guardado: Boolean(leido),
      correoEscrito: escrito,
      correoRecuperado: leido?.email ?? null,
      coincide: leido?.email === escrito,
      retoRecuperado: leido?.challenge ?? null,
      limpiado: true,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
