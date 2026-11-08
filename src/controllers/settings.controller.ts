import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as settingsService from "../services/settings.service";

/** GET /api/settings/vsl — público: se ve al terminar de pagar, sin sesión. */
export async function vsl(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ vsl: await settingsService.vslPublico() });
  } catch (error) {
    next(error);
  }
}

export async function vslAdmin(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingsService.vslAdmin());
  } catch (error) {
    next(error);
  }
}

export async function prepararVsl(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { titulo } = req.body as { titulo?: string };
    res.status(200).json(await settingsService.prepararVsl(titulo || ""));
  } catch (error) {
    next(error);
  }
}

export async function refrescarVsl(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingsService.refrescarVsl());
  } catch (error) {
    next(error);
  }
}

export async function borrarVsl(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingsService.borrarVsl());
  } catch (error) {
    next(error);
  }
}

/** GET /api/settings/web — público: la landing pregunta si está apagada. */
export async function web(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ apagada: await settingsService.webApagada() });
  } catch (error) {
    next(error);
  }
}

export async function cambiarWeb(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { apagada } = req.body as { apagada?: unknown };
    if (typeof apagada !== "boolean") throw new CustomError("Falta indicar si se apaga o se enciende", 400);
    res.status(200).json(await settingsService.cambiarWeb(apagada));
  } catch (error) {
    next(error);
  }
}
