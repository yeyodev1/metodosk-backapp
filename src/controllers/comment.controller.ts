import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as commentService from "../services/comment.service";

export async function listar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const courseId = String(req.query.courseId || "");
    const lessonId = String(req.query.lessonId || "");
    if (!courseId || !lessonId) throw new CustomError("Falta el video", 400);

    res.status(200).json({
      comentarios: await commentService.listar(
        courseId,
        lessonId,
        req.user!.userId,
        req.user!.accountType === "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function crear(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { courseId, lessonId, body, parent } = req.body as {
      courseId?: string;
      lessonId?: string;
      body?: string;
      parent?: string;
    };
    if (!courseId || !lessonId) throw new CustomError("Falta el video", 400);

    res.status(201).json(
      await commentService.crear(req.user!.userId, {
        courseId,
        lessonId,
        body: body || "",
        parent,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function borrar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await commentService.borrarPropio(req.user!.userId, String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/* ─────────────── Administración ─────────────── */

export async function listarAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const soloSinResponder = String(req.query.pendientes || "") === "1";
    res.status(200).json({ comentarios: await commentService.listarParaAdmin(soloSinResponder) });
  } catch (error) {
    next(error);
  }
}

export async function ocultar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { hidden } = req.body as { hidden?: boolean };
    res.status(200).json(await commentService.ocultar(String(req.params.id), Boolean(hidden)));
  } catch (error) {
    next(error);
  }
}

export async function eliminar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await commentService.eliminar(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
