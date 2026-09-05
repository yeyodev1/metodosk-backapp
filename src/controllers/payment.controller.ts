import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { AuthRequest } from "../types/AuthRequest";
import { dbConnect, isConnected } from "../config/mongo";
import { Order } from "../models/Order";
import { CheckoutIntent } from "../models/CheckoutIntent";
import { User } from "../models/User";
import {
  confirmTransaction,
  resendAccess,
  type MetaSignals,
} from "../services/payphone.service";
import { pricingStatus, presaleDeadline } from "../config/pricing";
import { beneficiosDe } from "../config/perks";

/**
 * El Origin real de la petición manda: así nadie puede forzar credenciales
 * de prueba desde producción enviándolas en el body.
 */
function requestOrigin(req: Request): string | undefined {
  const header = req.headers.origin || req.headers.referer;
  return typeof header === "string" && header.trim() ? header.trim() : undefined;
}

/**
 * Detrás de Vercel el socket siempre es el proxy: la IP real viene en la
 * cabecera. Meta la usa para cruzar la compra con la persona que vio el
 * anuncio, así que mandar la del proxy es peor que no mandar nada.
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const cadena = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const primera = (cadena || "").split(",")[0]?.trim();
  return primera || req.socket?.remoteAddress || null;
}

/**
 * Señales del pixel que el navegador arrastra hasta la confirmación.
 *
 * `_fbp` y `_fbc` son cookies de primera parte que el servidor no puede leer
 * (viven en el dominio del front), y sin ellas la venta no se atribuye al
 * anuncio que la originó.
 */
function metaSignals(req: Request): MetaSignals {
  const meta = (req.body ?? {}).meta ?? {};
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    fbp: texto(meta.fbp),
    fbc: texto(meta.fbc),
    eventSourceUrl: texto(meta.eventSourceUrl) ?? requestOrigin(req) ?? null,
    clientIp: clientIp(req),
    userAgent: texto(req.headers["user-agent"]),
  };
}

/** POST /api/payments/confirm — body: { id, clientTxId } */
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTxId, contact } = req.body ?? {};
    if (!id || !clientTxId) {
      throw new CustomError("Faltan id y clientTxId", 400);
    }

    const result = await confirmTransaction(
      String(id),
      String(clientTxId),
      requestOrigin(req),
      contact,
      metaSignals(req),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payments/resend — body: { id, clientTxId, email? }
 *
 * Reenvía la confirmación de compra. Sin `email` va a la dirección del pago;
 * con `email` va a la que indique la compradora.
 */
export async function resend(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTxId, email } = req.body ?? {};
    if (!id || !clientTxId) {
      throw new CustomError("Faltan id y clientTxId", 400);
    }

    const result = await resendAccess(
      String(id),
      String(clientTxId),
      requestOrigin(req),
      typeof email === "string" ? email : undefined,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/payments/pricing — precio vigente, para que el front no lo adivine. */
export async function pricing(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(pricingStatus());
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payments/mine — las compras de quien pregunta.
 *
 * Se busca por el correo de su cuenta, no por un id que venga en la petición:
 * si el cliente eligiera de quién ver los pagos, cualquiera vería los de otra.
 */
export async function misPagos(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const user = await User.findById(req.user!.userId);
    if (!user) throw new CustomError("Cuenta no encontrada", 404);

    const orders = await Order.find({ email: user.email }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      pagos: orders.map((o) => ({
        id: String(o._id),
        referencia: o.clientTransactionId,
        status: o.status,
        amountCents: o.amountCents,
        currency: o.currency,
        challenge: o.challenge,
        accessUntil: o.accessUntil,
        authorizationCode: o.authorizationCode,
        createdAt: o.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payments/beneficios — qué le toca a quien pregunta.
 *
 * Se resuelve en el servidor porque el corte depende de **cuándo compró**, y
 * esa fecha no puede venir del navegador: bastaría cambiar el reloj del
 * teléfono para reclamar un beneficio de pre-venta comprando en diciembre.
 */
export async function beneficios(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const user = await User.findById(req.user!.userId);
    if (!user) throw new CustomError("Cuenta no encontrada", 404);

    // La primera compra aprobada, no la última: quien entró en pre-venta y
    // después sumó el segundo reto no pierde lo que ya se había ganado.
    const primera = await Order.findOne({ email: user.email, status: "approved" })
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json(beneficiosDe(primera?.createdAt ?? null, presaleDeadline()));
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payments/intent — guarda el contacto antes de salir a PayPhone.
 *
 * body: { clientTransactionId, name?, email?, phone?, challenge? }
 *
 * Es lo que hace que las credenciales lleguen al correo que la compradora
 * escribió y no al que PayPhone tenga asociado a su tarjeta. Ver el comentario
 * del modelo CheckoutIntent para el porqué.
 *
 * Nunca falla hacia el cliente: si esto se cae, la compra tiene que poder
 * seguir igual. Se responde 200 con `guardado:false` y la confirmación usará
 * los respaldos de siempre.
 */
export async function guardarIntent(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientTransactionId, name, email, phone, challenge } = req.body ?? {};
    if (!clientTransactionId) {
      throw new CustomError("Falta clientTransactionId", 400);
    }

    if (!isConnected() && !(await dbConnect())) {
      return res.status(200).json({ guardado: false });
    }

    const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    await CheckoutIntent.findOneAndUpdate(
      { clientTransactionId: String(clientTransactionId) },
      {
        clientTransactionId: String(clientTransactionId),
        name: texto(name),
        email: texto(email)?.toLowerCase() ?? null,
        phone: texto(phone),
        challenge: texto(challenge),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(200).json({ guardado: true });
  } catch (error) {
    // Un fallo acá no puede impedir que alguien compre.
    if (error instanceof CustomError && error.status === 400) return next(error);
    console.error("[payments] no se pudo guardar el intent:", error);
    res.status(200).json({ guardado: false });
  }
}
