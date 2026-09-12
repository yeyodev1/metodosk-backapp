import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { bunnyConfig } from "../services/bunny.service";
import * as courseService from "../services/course.service";
import { firmarSubidaGuia } from "../services/cloudinary.service";
import type { Audiencia } from "../models/Course";

/** GET /api/courses — la ruta de la alumna, según su reto y el mes en que va. */
export async function misCursos(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const mes = Math.min(Math.max(Number(req.query.mes) || 1, 1), 3);
    const cursos = await courseService.listarParaAlumna(req.user!.userId, mes);
    res.status(200).json({ cursos });
  } catch (error) {
    next(error);
  }
}

/* ─────────────── Administración ─────────────── */

export async function listar(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      cursos: await courseService.listarParaAdmin(),
      // La vista necesita saberlo para decir qué falta en vez de fallar al subir.
      bunnyListo: Boolean(bunnyConfig()),
    });
  } catch (error) {
    next(error);
  }
}

export async function crear(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await courseService.crearCurso(req.body));
  } catch (error) {
    next(error);
  }
}

export async function actualizar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await courseService.actualizarCurso(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function reordenar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids)) throw new CustomError("Falta el orden de los cursos", 400);
    res.status(200).json(await courseService.reordenar(ids));
  } catch (error) {
    next(error);
  }
}

export async function eliminar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await courseService.eliminarCurso(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/courses/:id/video — firma la subida directa a Bunny. */
export async function prepararVideo(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { destino, titulo } = req.body as { destino?: string; titulo?: string };
    if (!destino) throw new CustomError("Falta indicar a qué video corresponde", 400);
    res.status(200).json(await courseService.prepararVideo(String(req.params.id), destino, titulo || ""));
  } catch (error) {
    next(error);
  }
}

export async function refrescarVideo(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const destino = String(req.query.destino || "");
    if (!destino) throw new CustomError("Falta indicar a qué video corresponde", 400);
    res.status(200).json(await courseService.refrescarVideo(String(req.params.id), destino));
  } catch (error) {
    next(error);
  }
}

export async function agregarClase(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, summary } = req.body as { title?: string; summary?: string };
    res.status(201).json(await courseService.agregarClase(String(req.params.id), title || "", summary));
  } catch (error) {
    next(error);
  }
}

export async function eliminarClase(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await courseService.eliminarClase(String(req.params.id), String(req.params.lessonId)));
  } catch (error) {
    next(error);
  }
}

/* ─────────────── Guías en PDF ─────────────── */

/**
 * GET /api/courses/:id/guia/:audiencia — su guía, página por página.
 *
 * Devuelve las URLs firmadas en vez del archivo: el PDF pesa 50 MB y hacerlo
 * pasar por la función costaría el doble de ancho de banda y el triple de
 * espera. Lo que protege el material no es esconder la URL —una imagen no
 * puede mandar la cabecera de sesión— sino que solo este servidor las puede
 * firmar y que cada página sale con el correo de la alumna encima.
 */
export async function guiaDeCurso(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const mes = Math.min(Math.max(Number(req.query.mes) || 1, 1), 3);
    const guia = await courseService.guiaParaAlumna(
      req.user!.userId,
      String(req.params.id),
      String(req.params.audiencia),
      mes,
    );
    res.status(200).json(guia);
  } catch (error) {
    next(error);
  }
}

/* ─────────────── Guías, desde el panel ─────────────── */

/** POST /api/admin/courses/:id/guia/subida — firma la subida del PDF. */
export async function prepararGuia(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const audiencia = String(req.body?.audiencia ?? "");
    if (!["recomposicion", "volumen", "ambas"].includes(audiencia)) {
      throw new CustomError("Elige para qué reto es la guía", 400);
    }
    res.status(200).json(firmarSubidaGuia(String(req.params.id), audiencia));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/courses/:id/guia — deja la guía subida colgada del curso. */
export async function guardarGuia(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const audiencia = String(req.body?.audiencia ?? "");
    const publicId = String(req.body?.publicId ?? "").trim();
    const paginas = Number(req.body?.paginas);
    if (!["recomposicion", "volumen", "ambas"].includes(audiencia)) {
      throw new CustomError("Elige para qué reto es la guía", 400);
    }
    if (!publicId) throw new CustomError("Falta el archivo subido", 400);
    if (!Number.isInteger(paginas) || paginas < 1) {
      throw new CustomError("No pudimos leer cuántas páginas tiene", 400);
    }

    await courseService.guardarGuia(String(req.params.id), {
      audiencia: audiencia as Audiencia,
      titulo: String(req.body?.titulo ?? "").trim() || "Tu guía",
      publicId,
      paginas,
    });
    res.status(200).json({ cursos: await courseService.listarParaAdmin() });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/courses/:id/guia/:audiencia */
export async function eliminarGuia(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await courseService.borrarGuia(String(req.params.id), String(req.params.audiencia));
    res.status(200).json({ cursos: await courseService.listarParaAdmin() });
  } catch (error) {
    next(error);
  }
}
