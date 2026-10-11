import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as communityService from "../services/community.service";
import * as puntosService from "../services/puntos.service";

export async function listar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const desde = req.query.desde ? String(req.query.desde) : undefined;
    const antes = req.query.antes ? String(req.query.antes) : undefined;
    const tipo = req.query.tipo ? String(req.query.tipo) : undefined;
    const limite = req.query.limite ? Number(req.query.limite) : undefined;

    res.status(200).json(
      await communityService.listar(req.user!.userId, req.user!.accountType === "admin", {
        desde,
        antes,
        tipo,
        limite: Number.isFinite(limite) ? limite : undefined,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function publicar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { body, tipo, imagen } = req.body as { body?: string; tipo?: string; imagen?: string | null };
    res
      .status(201)
      .json(await communityService.publicar(req.user!.userId, { body: body || "", tipo, imagen }));
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

export async function reaccionar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tipo } = req.body as { tipo?: string };
    res
      .status(200)
      .json(await communityService.reaccionar(req.user!.userId, String(req.params.id), tipo || ""));
  } catch (error) {
    next(error);
  }
}

/** Firma la subida directa de la foto de un logro. */
export async function firmarImagen(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(communityService.firmarImagen(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

/** Sus puntos, su nivel, sus insignias y el ranking del mes. */
export async function puntos(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await puntosService.misPuntos(req.user!.userId, req.user!.accountType === "admin"));
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
