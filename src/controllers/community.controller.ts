import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as communityService from "../services/community.service";

export async function listar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const desde = req.query.desde ? String(req.query.desde) : undefined;
    const limite = req.query.limite ? Number(req.query.limite) : undefined;

    res.status(200).json(
      await communityService.listar(req.user!.userId, req.user!.accountType === "admin", {
        desde,
        limite: Number.isFinite(limite) ? limite : undefined,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function publicar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { body } = req.body as { body?: string };
    res.status(201).json(await communityService.publicar(req.user!.userId, body || ""));
  } catch (error) {
    next(error);
  }
}

export async function borrar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(
      await communityService.borrar(
        req.user!.userId,
        req.user!.accountType === "admin",
        String(req.params.id),
      ),
    );
  } catch (error) {
    next(error);
  }
}

/* ─────────────── Foto de perfil ─────────────── */

export async function miAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await communityService.miAvatar(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

/** Firma la subida directa: la imagen no pasa por este servidor. */
export async function firmarAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(communityService.firmarAvatar(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function guardarAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { publicId } = req.body as { publicId?: string };
    if (!publicId) throw new CustomError("Falta la foto", 400);
    res.status(200).json(await communityService.guardarAvatar(req.user!.userId, publicId));
  } catch (error) {
    next(error);
  }
}

export async function quitarAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await communityService.quitarAvatar(req.user!.userId));
  } catch (error) {
    next(error);
  }
}
