import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as onboardingService from "../services/onboarding.service";

export async function estado(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await onboardingService.estado(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function videoVisto(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await onboardingService.marcarVideoVisto(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

/** Firma la subida directa: la foto no pasa por este servidor. */
export async function firmarFoto(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { angulo } = req.body as { angulo?: string };
    if (!angulo) throw new CustomError("Falta el ángulo de la foto", 400);
    res.status(200).json(onboardingService.firmarFoto(req.user!.userId, angulo));
  } catch (error) {
    next(error);
  }
}

export async function guardarFoto(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { angulo, publicId } = req.body as { angulo?: string; publicId?: string };
    if (!angulo || !publicId) throw new CustomError("Falta la foto", 400);
    res
      .status(200)
      .json(await onboardingService.guardarFoto(req.user!.userId, angulo, publicId));
  } catch (error) {
    next(error);
  }
}

export async function quitarFoto(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await onboardingService.quitarFoto(req.user!.userId, String(req.params.angulo)));
  } catch (error) {
    next(error);
  }
}

export async function saltar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await onboardingService.saltar(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function reabrir(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await onboardingService.reabrir(req.user!.userId));
  } catch (error) {
    next(error);
  }
}
