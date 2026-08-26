import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as authService from "../services/auth.service";

/** POST /api/auth/login — body: { email, password } */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body ?? {};
    const result = await authService.login(String(email ?? ""), String(password ?? ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/check-email — body: { email }
 *
 * Le dice al registro si ese correo tiene una compra y si ya tiene cuenta,
 * para poder explicar con precisión qué le toca hacer.
 */
export async function checkEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body ?? {};
    const result = await authService.checkEmail(String(email ?? ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/register — body: { email, password }. Requiere compra aprobada. */
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body ?? {};
    const result = await authService.register(String(email ?? ""), String(password ?? ""));
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/auth/me — devuelve la sesión del token. */
export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const user = await authService.findById(req.user.userId);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/auth/password — body: { current, next } */
export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { current, next: nueva } = req.body ?? {};
    const user = await authService.changePassword(
      req.user.userId,
      String(current ?? ""),
      String(nueva ?? ""),
    );
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}
