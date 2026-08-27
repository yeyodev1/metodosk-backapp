import { Course, type Audiencia, type ICourse } from "../models/Course";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import { bunnyConfig, crearSubida, estadoVideo, borrarVideo, urlEmbed } from "./bunny.service";

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

/**
 * La ruta base del método, para que la academia no arranque vacía.
 *
 * Se siembra una sola vez y en estado "proximamente": la estructura ya se
 * vendió, así que la alumna debe verla — pero prometer que está lista antes de
 * que alguien suba el video sería mentirle.
 */
const RUTA_BASE: Array<Pick<ICourse, "title" | "slug" | "summary" | "challenge" | "order" | "unlockMonth" | "coverPhoto">> = [
  {
    title: "Tu entrenamiento",
    slug: "entrenamiento",
    summary: "La rutina completa de los 3 meses, en casa o en el gym.",
    challenge: "ambas",
    order: 1,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-08",
  },
  {
    title: "Movilidad y calentamiento",
    slug: "movilidad",
    summary: "Los diez minutos que deciden cómo te sientes al día siguiente.",
    challenge: "ambas",
    order: 2,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-15",
  },
  {
    title: "Tu nutrición",
    slug: "nutricion",
    summary: "Comida real, con porciones que se entienden.",
    challenge: "ambas",
    order: 3,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-05",
  },
  {
    title: "Masterclasses",
    slug: "masterclasses",
    summary: "Tres clases para manejar la alimentación en la vida real.",
    challenge: "ambas",
    order: 4,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-02",
  },
  {
    title: "La guía del Método SK",
    slug: "guia",
    summary: "Donde se ve el avance que la balanza no muestra.",
    challenge: "ambas",
    order: 5,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-03",
  },
  {
    title: "La comunidad",
    slug: "comunidad",
    summary: "Arrancas el mismo día que todas las que entran a este reto.",
    challenge: "ambas",
    order: 6,
    unlockMonth: 1,
    coverPhoto: "metodosk/sk-19",
  },
];

export async function seedCourses(): Promise<void> {
  if (!isConnected()) return;
  try {
    if ((await Course.estimatedDocumentCount()) > 0) return;
    await Course.insertMany(RUTA_BASE.map((c) => ({ ...c, status: "proximamente" })));
    console.log("[cursos] ruta base creada");
  } catch (error) {
    console.error("[cursos] no se pudo sembrar la ruta base:", error);
  }
}

/** El reto de la alumna, tal como se guardó en la compra, a audiencia. */
function audienciaDe(challenge: string | null | undefined): Audiencia | null {
  if (!challenge) return null;
  const texto = challenge.toLowerCase();
  if (texto.includes("volumen")) return "volumen";
  if (texto.includes("recomposici")) return "recomposicion";
  return null;
}

export interface CursoParaAlumna {
  id: string;
  title: string;
  slug: string;
  summary: string;
  order: number;
  unlockMonth: number;
  coverPhoto: string | null;
  /** 'abierto' | 'proximamente' | 'cerrado-por-mes' */
  estado: "abierto" | "proximamente" | "cerrado";
  welcomeVideo: { embedUrl: string; thumbnail: string | null } | null;
  lessons: Array<{
    id: string;
    title: string;
    summary: string | null;
    order: number;
    embedUrl: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
  }>;
}

/**
 * La ruta que le toca a esta alumna.
 *
 * Se filtra por su reto y por el mes en que va: mandarle el mes 3 en la
 * semana 2 no la adelanta, la abruma.
 */
export async function listarParaAlumna(
  userId: string,
  mesActual: number,
): Promise<CursoParaAlumna[]> {
  await requireDb();

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const audiencia = audienciaDe(user.challenge);
  const query: Record<string, unknown> = { status: { $in: ["publicado", "proximamente"] } };
  if (audiencia) query.challenge = { $in: [audiencia, "ambas"] };

  const cursos = await Course.find(query).sort({ order: 1 }).lean();
  const hayBunny = Boolean(bunnyConfig());

  return cursos.map((curso) => {
    const cerradoPorMes = curso.unlockMonth > mesActual;
    const estado: CursoParaAlumna["estado"] =
      curso.status !== "publicado" ? "proximamente" : cerradoPorMes ? "cerrado" : "abierto";
    const abierto = estado === "abierto";

    return {
      id: String(curso._id),
      title: curso.title,
      slug: curso.slug,
      summary: curso.summary,
      order: curso.order,
      unlockMonth: curso.unlockMonth,
      coverPhoto: curso.coverPhoto,
      estado,
      welcomeVideo:
        abierto && curso.welcomeVideo?.bunnyId && hayBunny
          ? {
              embedUrl: urlEmbed(curso.welcomeVideo.bunnyId),
              thumbnail: curso.welcomeVideo.thumbnail,
            }
          : null,
      // Los títulos de las clases se ven siempre: saber qué viene es parte de
      // lo que compró. El video solo cuando el curso está abierto.
      lessons: (curso.lessons || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((l: any) => ({
          id: String(l._id),
          title: l.title,
          summary: l.summary,
          order: l.order,
          embedUrl: abierto && l.video?.bunnyId && hayBunny ? urlEmbed(l.video.bunnyId) : null,
          fileUrl: abierto ? l.fileUrl : null,
          durationSeconds: l.video?.durationSeconds ?? null,
        })),
    };
  });
}

/* ─────────────── Administración ─────────────── */

export async function listarParaAdmin() {
  await requireDb();
  const cursos = await Course.find().sort({ order: 1 }).lean();
  return cursos.map((c) => ({
    id: String(c._id),
    title: c.title,
    slug: c.slug,
    summary: c.summary,
    challenge: c.challenge,
    order: c.order,
    unlockMonth: c.unlockMonth,
    status: c.status,
    coverPhoto: c.coverPhoto,
    welcomeVideo: c.welcomeVideo,
    lessons: (c.lessons || []).map((l: any) => ({
      id: String(l._id),
      title: l.title,
      summary: l.summary,
      order: l.order,
      video: l.video,
      fileUrl: l.fileUrl,
    })),
    updatedAt: c.updatedAt,
  }));
}

function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface CursoInput {
  title: string;
  summary?: string;
  challenge?: Audiencia;
  order?: number;
  unlockMonth?: number;
  status?: ICourse["status"];
  coverPhoto?: string | null;
}

export async function crearCurso(input: CursoInput) {
  await requireDb();
  if (!input.title?.trim()) throw new CustomError("El curso necesita un título", 400);

  const base = slugify(input.title);
  let slug = base;
  // Dos cursos con el mismo nombre no pueden pelearse la misma URL.
  for (let i = 2; await Course.exists({ slug }); i++) slug = `${base}-${i}`;

  const ultimo = await Course.findOne().sort({ order: -1 }).lean();
  const curso = await Course.create({
    title: input.title.trim(),
    slug,
    summary: input.summary?.trim() || "",
    challenge: input.challenge || "ambas",
    order: input.order ?? (ultimo?.order ?? 0) + 1,
    unlockMonth: input.unlockMonth ?? 1,
    status: input.status || "borrador",
    coverPhoto: input.coverPhoto || null,
  });

  return { id: String(curso._id), slug: curso.slug };
}

export async function actualizarCurso(id: string, input: Partial<CursoInput>) {
  await requireDb();
  const curso = await Course.findById(id);
  if (!curso) throw new CustomError("Curso no encontrado", 404);

  if (input.title !== undefined) curso.title = input.title.trim();
  if (input.summary !== undefined) curso.summary = input.summary.trim();
  if (input.challenge !== undefined) curso.challenge = input.challenge;
  if (input.order !== undefined) curso.order = input.order;
  if (input.unlockMonth !== undefined) curso.unlockMonth = input.unlockMonth;
  if (input.status !== undefined) curso.status = input.status;
  if (input.coverPhoto !== undefined) curso.coverPhoto = input.coverPhoto;

  await curso.save();
  return { id: String(curso._id) };
}

/** Reordena la ruta completa de una vez: arrastrar y soltar manda una sola lista. */
export async function reordenar(ids: string[]) {
  await requireDb();
  await Promise.all(ids.map((id, i) => Course.updateOne({ _id: id }, { $set: { order: i + 1 } })));
  return { ok: true };
}

export async function eliminarCurso(id: string) {
  await requireDb();
  const curso = await Course.findById(id);
  if (!curso) throw new CustomError("Curso no encontrado", 404);

  // Los videos se borran también: dejarlos huérfanos en Bunny se paga cada mes.
  const videos = [curso.welcomeVideo, ...(curso.lessons || []).map((l) => l.video)];
  for (const video of videos) {
    if (video?.bunnyId) await borrarVideo(video.bunnyId).catch(() => undefined);
  }

  await curso.deleteOne();
  return { ok: true };
}

/* ─────────────── Video ─────────────── */

/**
 * Prepara la subida de un video y guarda su hueco en el curso.
 *
 * `destino` es 'welcome' o el id de una clase. El navegador sube directo a
 * Bunny con la firma que se devuelve acá.
 */
export async function prepararVideo(courseId: string, destino: string, titulo: string) {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("Curso no encontrado", 404);

  const subida = await crearSubida(titulo || curso.title);
  const video = {
    bunnyId: subida.videoId,
    title: titulo || curso.title,
    status: "subiendo" as const,
    durationSeconds: null,
    thumbnail: null,
  };

  if (destino === "welcome") {
    // Si había uno antes, se borra: dos videos de bienvenida no existen.
    if (curso.welcomeVideo?.bunnyId) {
      await borrarVideo(curso.welcomeVideo.bunnyId).catch(() => undefined);
    }
    curso.welcomeVideo = video;
  } else {
    const leccion = (curso.lessons as any).id(destino);
    if (!leccion) throw new CustomError("Clase no encontrada", 404);
    if (leccion.video?.bunnyId) await borrarVideo(leccion.video.bunnyId).catch(() => undefined);
    leccion.video = video;
  }

  await curso.save();
  return subida;
}

/** Bunny codifica en background: esto pregunta si ya se puede ver. */
export async function refrescarVideo(courseId: string, destino: string) {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("Curso no encontrado", 404);

  const video =
    destino === "welcome" ? curso.welcomeVideo : (curso.lessons as any).id(destino)?.video;
  if (!video?.bunnyId) throw new CustomError("Ese video todavía no existe", 404);

  const estado = await estadoVideo(video.bunnyId);
  video.status = estado.status;
  video.durationSeconds = estado.durationSeconds;
  video.thumbnail = estado.thumbnail;
  await curso.save();

  return estado;
}

/* ─────────────── Clases ─────────────── */

export async function agregarClase(courseId: string, title: string, summary?: string) {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("Curso no encontrado", 404);
  if (!title?.trim()) throw new CustomError("La clase necesita un título", 400);

  const orden = (curso.lessons || []).length + 1;
  (curso.lessons as any).push({
    title: title.trim(),
    summary: summary?.trim() || null,
    order: orden,
    video: null,
    fileUrl: null,
  });
  await curso.save();

  const creada: any = curso.lessons[curso.lessons.length - 1];
  return { id: String(creada._id) };
}

export async function eliminarClase(courseId: string, lessonId: string) {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("Curso no encontrado", 404);

  const leccion = (curso.lessons as any).id(lessonId);
  if (!leccion) throw new CustomError("Clase no encontrada", 404);
  if (leccion.video?.bunnyId) await borrarVideo(leccion.video.bunnyId).catch(() => undefined);

  leccion.deleteOne();
  await curso.save();
  return { ok: true };
}
