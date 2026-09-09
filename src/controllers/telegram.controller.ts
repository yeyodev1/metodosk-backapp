import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import * as telegramService from "../services/telegram.service";

/** GET /api/telegram/grupos — los grupos abiertos, si le tocan y si ya se vinculó. */
export async function grupos(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }
    res.status(200).json(await telegramService.estado(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/telegram/webhook — cada mensaje que le llega al bot.
 *
 * Telegram manda en una cabecera el secreto que le dimos al registrar el
 * webhook. Sin él, cualquiera podría inventar mensajes "de una alumna" y
 * pedir entradas a nombre de otra. Sin secreto configurado la ruta queda
 * cerrada: mejor un bot mudo que uno que le cree a cualquiera.
 *
 * Siempre responde 200 una vez validado: si respondiera error, Telegram
 * reintentaría el mismo mensaje una y otra vez.
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const secreto = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    if (!secreto) throw new CustomError("TELEGRAM_WEBHOOK_SECRET no está configurado", 503);
    if (req.headers["x-telegram-bot-api-secret-token"] !== secreto) {
      throw new CustomError("No autorizado", 401);
    }

    await telegramService.procesarUpdate(req.body || {});
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
