import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as avancesService from "../services/avances.service";

/**
 * Son fotos de su cuerpo: ni el navegador ni ningún proxy intermedio guarda
 * estas respuestas, que llevan las URLs firmadas.
 */
function sinCache(res: Response) {
  res.set("Cache-Control", "private, no-store");
}

/* ── Panel ── */

export async function listar(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    sinCache(res);
    res.status(200).json(await avancesService.listarAlumnas());
  } catch (error) {
    next(error);
  }
}

export async function ficha(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    sinCache(res);
    res.status(200).json(await avancesService.fichaAlumna(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function comentar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { body, firma, tomaDel } = (req.body ?? {}) as Record<string, unknown>;
    res
      .status(201)
      .json(
        await avancesService.comentar(req.user!.userId, String(req.params.id), {
          body,
          firma,
          tomaDel,
        }),
      );
  } catch (error) {
    next(error);
  }
}

export async function borrarNota(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await avancesService.borrarNota(String(req.params.notaId));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/* ── La alumna ── */

export async function misNotas(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    sinCache(res);
    res.status(200).json(await avancesService.misNotas(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function marcarLeidas(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await avancesService.marcarLeidas(req.user!.userId);
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function responder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res
      .status(201)
      .json(await avancesService.responder(req.user!.userId, (req.body ?? {}).body));
  } catch (error) {
    next(error);
  }
}
