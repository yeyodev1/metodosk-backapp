import { Course, type Audiencia, type ICourse } from "../models/Course";
import { User } from "../models/User";
import { Progress } from "../models/Progress";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import { bunnyConfig, crearSubida, estadoVideo, borrarVideo, urlEmbed } from "./bunny.service";
import { borrarImagen, urlPaginaGuia } from "./cloudinary.service";

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

/**
 * Todo lo que ha comprado, no solo lo último.
 *
 * Quien compró los dos retos tiene que ver el material de los dos. Filtrar por
 * `challenge` a secas le escondía el primero en cuanto compraba el segundo.
 */
function audienciasDe(user: { challenge: string | null; challenges?: string[] }): Audiencia[] {
  const todos = user.challenges?.length ? user.challenges : [user.challenge];
  const audiencias = todos
    .map(audienciaDe)
    .filter((a): a is Audiencia => a !== null);
  return [...new Set(audiencias)];
}

export interface CursoParaAlumna {
  id: string;
  title: string;
  slug: string;
  summary: string;
  order: number;
  unlockMonth: number;
  coverPhoto: string | null;
  /** A qué reto pertenece, para poder agruparlos si compró los dos. */
  challenge: Audiencia;
  /** 'abierto' | 'proximamente' | 'cerrado-por-mes' */
  estado: "abierto" | "proximamente" | "cerrado";
  /**
   * Las guías que le tocan, sin el public_id: la alumna pide sus páginas por
   * número contra nuestro API y nunca ve dónde vive el archivo.
   */
  guias: Array<{ audiencia: Audiencia; titulo: string; paginas: number }>;
  welcomeVideo: { embedUrl: string; thumbnail: string | null; completed: boolean } | null;
  lessons: Array<{
    id: string;
    title: string;
    summary: string | null;
    order: number;
    embedUrl: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
    /** Dónde se quedó y si ya la terminó. */
    seconds: number;
    completed: boolean;
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

  const audiencias = audienciasDe(user);
  const query: Record<string, unknown> = { status: { $in: ["publicado", "proximamente"] } };
  if (audiencias.length) query.challenge = { $in: [...audiencias, "ambas"] };

  const cursos = await Course.find(query).sort({ order: 1 }).lean();
  const hayBunny = Boolean(bunnyConfig());

  // El avance se trae de una vez y no por curso: son doce cursos, no doce
  // consultas.
  const avance = await Progress.find({ user: userId }).lean();
  const visto = (courseId: string, lessonId: string) =>
    avance.find((a) => a.courseId === courseId && a.lessonId === lessonId);

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
      challenge: curso.challenge,
      estado,
      welcomeVideo:
        abierto && curso.welcomeVideo?.bunnyId && hayBunny
          ? {
              // Retoma donde se quedó: en un video largo, buscar el punto a
              // mano es la parte que hace que no se vuelva.
              embedUrl: urlEmbed(
                curso.welcomeVideo.bunnyId,
                visto(String(curso._id), "welcome")?.seconds ?? 0,
              ),
              thumbnail: curso.welcomeVideo.thumbnail,
              completed: Boolean(visto(String(curso._id), "welcome")?.completed),
            }
          : null,
      // Los títulos de las clases se ven siempre: saber qué viene es parte de
      // lo que compró. El video solo cuando el curso está abierto.
      lessons: (curso.lessons || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((l: any) => {
          const suyo = visto(String(curso._id), String(l._id));
          return {
            id: String(l._id),
            title: l.title,
            summary: l.summary,
            order: l.order,
            embedUrl:
              abierto && l.video?.bunnyId && hayBunny
                ? urlEmbed(l.video.bunnyId, suyo?.seconds ?? 0)
                : null,
            fileUrl: abierto ? l.fileUrl : null,
            durationSeconds: l.video?.durationSeconds ?? null,
            seconds: suyo?.seconds ?? 0,
            completed: Boolean(suyo?.completed),
          };
        }),
      // La guía de su reto. La de la otra no se le nombra siquiera: no le
      // sirve y le diría que compre el plan contrario al que está haciendo.
      guias: abierto
        ? (curso.guias || [])
            .filter(
              (g) =>
                g.audiencia === "ambas" ||
                audiencias.length === 0 ||
                audiencias.includes(g.audiencia),
            )
            .map((g) => ({ audiencia: g.audiencia, titulo: g.titulo, paginas: g.paginas }))
        : [],
    };
  });
}

/**
 * La URL firmada de una página de la guía, para esta alumna.
 *
 * Se comprueba todo de nuevo acá y no se confía en lo que pida el navegador:
 * que el curso esté abierto, que la guía sea de su reto y que la página exista.
 * Sin esto, cambiar un número en la URL entregaría la guía del otro plan.
 */
export async function guiaParaAlumna(
  userId: string,
  courseId: string,
  audiencia: string,
  mesActual: number,
): Promise<{ titulo: string; paginas: number; urls: string[] }> {
  await requireDb();

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const curso = await Course.findById(courseId).lean();
  if (!curso) throw new CustomError("No encontramos esa guía", 404);
  if (curso.status !== "publicado" || curso.unlockMonth > mesActual) {
    throw new CustomError("Esta guía todavía no está abierta", 403);
  }

  const suyas = audienciasDe(user);
  const guia = (curso.guias || []).find((g) => g.audiencia === audiencia);
  if (!guia) throw new CustomError("No encontramos esa guía", 404);
  if (guia.audiencia !== "ambas" && suyas.length && !suyas.includes(guia.audiencia)) {
    throw new CustomError("Esa guía es del otro reto", 403);
  }

  /**
   * Se firman todas las páginas de una vez y no una por una.
   *
   * Un `<img>` no puede mandar la cabecera de sesión, así que la alternativa
   * sería que el navegador pidiera cada página por separado y las armara como
   * blob: setenta y una peticiones autenticadas para leer un documento. La
   * marca de agua con su correo es lo que protege el material, no que la URL
   * esté escondida.
   */
  const urls = Array.from({ length: guia.paginas }, (_, i) =>
    urlPaginaGuia(guia.publicId, i + 1, user.email),
  );

  return { titulo: guia.titulo, paginas: guia.paginas, urls };
}

/* ─────────────── Guías, desde el panel ─────────────── */

/** Guarda la guía recién subida en el curso, o reemplaza la de esa audiencia. */
export async function guardarGuia(
  courseId: string,
  guia: { audiencia: Audiencia; titulo: string; publicId: string; paginas: number },
): Promise<void> {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("No encontramos el curso", 404);

  const anterior = curso.guias.find((g) => g.audiencia === guia.audiencia);
  curso.guias = [...curso.guias.filter((g) => g.audiencia !== guia.audiencia), guia];
  await curso.save();

  // El PDF viejo se borra: es material que ya no se entrega y ocupa igual.
  if (anterior && anterior.publicId !== guia.publicId) {
    await borrarImagen(anterior.publicId, "authenticated").catch(() => {});
  }
}

export async function borrarGuia(courseId: string, audiencia: string): Promise<void> {
  await requireDb();
  const curso = await Course.findById(courseId);
  if (!curso) throw new CustomError("No encontramos el curso", 404);

  const guia = curso.guias.find((g) => g.audiencia === audiencia);
  curso.guias = curso.guias.filter((g) => g.audiencia !== audiencia);
  await curso.save();
  if (guia) await borrarImagen(guia.publicId, "authenticated").catch(() => {});
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
