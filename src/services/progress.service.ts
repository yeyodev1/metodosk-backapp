import { Progress, UMBRAL_COMPLETADO } from "../models/Progress";
import { Course } from "../models/Course";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

export interface AvanceVideo {
  courseId: string;
  lessonId: string;
  seconds: number;
  duration: number | null;
  completed: boolean;
}

export interface ResumenCurso {
  courseId: string;
  /** Videos vistos / videos del curso. */
  vistos: number;
  total: number;
  porcentaje: number;
}

/**
 * Todo el avance de una alumna, más el resumen por curso.
 *
 * El resumen se calcula acá y no en el navegador: si cada pantalla lo hiciera
 * a su manera, la barra del curso y la del método acabarían diciendo cosas
 * distintas sobre lo mismo.
 */
export async function miAvance(userId: string): Promise<{
  videos: AvanceVideo[];
  cursos: ResumenCurso[];
  porcentajeTotal: number;
}> {
  await requireDb();

  const filas = await Progress.find({ user: userId }).lean();
  const videos: AvanceVideo[] = filas.map((f) => ({
    courseId: f.courseId,
    lessonId: f.lessonId,
    seconds: f.seconds,
    duration: f.duration,
    completed: f.completed,
  }));

  const cursos = await Course.find({ status: "publicado" }).lean();
  let totalVideos = 0;
  let totalVistos = 0;

  const resumen: ResumenCurso[] = cursos.map((curso) => {
    const id = String(curso._id);
    // El video de bienvenida cuenta como uno más: también hay que verlo.
    const total = (curso.welcomeVideo?.bunnyId ? 1 : 0) + (curso.lessons || []).length;
    const vistos = videos.filter((v) => v.courseId === id && v.completed).length;

    totalVideos += total;
    totalVistos += Math.min(vistos, total);

    return {
      courseId: id,
      vistos: Math.min(vistos, total),
      total,
      porcentaje: total ? Math.round((Math.min(vistos, total) / total) * 100) : 0,
    };
  });

  return {
    videos,
    cursos: resumen,
    porcentajeTotal: totalVideos ? Math.round((totalVistos / totalVideos) * 100) : 0,
  };
}

/**
 * Guarda dónde va un video.
 *
 * Nunca retrocede el máximo alcanzado ni desmarca algo ya visto: si vuelve a
 * abrir una clase terminada para repasar el minuto 2, eso no significa que la
 * haya dejado a medias.
 */
export async function guardar(
  userId: string,
  input: { courseId: string; lessonId: string; seconds: number; duration?: number | null; completed?: boolean },
): Promise<AvanceVideo> {
  await requireDb();

  const { courseId, lessonId } = input;
  if (!courseId || !lessonId) throw new CustomError("Falta el video", 400);

  const seconds = Math.max(0, Math.floor(input.seconds || 0));
  const duration = input.duration && input.duration > 0 ? Math.floor(input.duration) : null;

  const actual = await Progress.findOne({ user: userId, courseId, lessonId });

  const completado =
    actual?.completed ||
    input.completed === true ||
    Boolean(duration && seconds / duration >= UMBRAL_COMPLETADO);

  const fila = await Progress.findOneAndUpdate(
    { user: userId, courseId, lessonId },
    {
      $set: {
        seconds: Math.max(seconds, actual?.seconds ?? 0),
        duration: duration ?? actual?.duration ?? null,
        completed: completado,
        ...(completado && !actual?.completed ? { completedAt: new Date() } : {}),
      },
      $setOnInsert: { user: userId, courseId, lessonId },
    },
    { upsert: true, new: true },
  );

  return {
    courseId: fila.courseId,
    lessonId: fila.lessonId,
    seconds: fila.seconds,
    duration: fila.duration,
    completed: fila.completed,
  };
}

/** Marcar a mano, para cuando el reproductor no avisa que terminó. */
export async function marcarVista(userId: string, courseId: string, lessonId: string) {
  return guardar(userId, { courseId, lessonId, seconds: 0, completed: true });
}
