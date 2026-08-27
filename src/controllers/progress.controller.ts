import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as progressService from "../services/progress.service";

export async function mio(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await progressService.miAvance(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function guardar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { courseId, lessonId, seconds, duration, completed } = req.body as {
      courseId?: string;
      lessonId?: string;
      seconds?: number;
      duration?: number;
      completed?: boolean;
    };
    if (!courseId || !lessonId) throw new CustomError("Falta el video", 400);

    res.status(200).json(
      await progressService.guardar(req.user!.userId, {
        courseId,
        lessonId,
        seconds: seconds ?? 0,
        duration,
        completed,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function marcarVista(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { courseId, lessonId } = req.body as { courseId?: string; lessonId?: string };
    if (!courseId || !lessonId) throw new CustomError("Falta el video", 400);
    res
      .status(200)
      .json(await progressService.marcarVista(req.user!.userId, courseId, lessonId));
  } catch (error) {
    next(error);
  }
}
