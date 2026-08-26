import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { confirmTransaction, resendAccess } from "../services/payphone.service";
import { pricingStatus } from "../config/pricing";

/**
 * El Origin real de la petición manda: así nadie puede forzar credenciales
 * de prueba desde producción enviándolas en el body.
 */
function requestOrigin(req: Request): string | undefined {
  const header = req.headers.origin || req.headers.referer;
  return typeof header === "string" && header.trim() ? header.trim() : undefined;
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
