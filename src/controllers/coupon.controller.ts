import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as couponService from "../services/coupon.service";

/** GET /api/payments/cupon/:code — público: lo consulta el checkout. */
export async function validar(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.validarCupon(String(req.params.code || "")));
  } catch (error) {
    next(error);
  }
}

export async function listar(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.listarCupones());
  } catch (error) {
    next(error);
  }
}

export async function crear(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const autor = req.user?.email ?? null;
    res.status(201).json(await couponService.crearCupon(req.body ?? {}, autor));
  } catch (error) {
    next(error);
  }
}

export async function editar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.editarCupon(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

export async function eliminar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await couponService.eliminarCupon(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
