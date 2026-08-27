import { Comment, MAX_LARGO } from "../models/Comment";
import { User } from "../models/User";
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

export interface ComentarioPublico {
  id: string;
  authorName: string;
  body: string;
  fromStaff: boolean;
  createdAt: Date;
  mine: boolean;
  respuestas: ComentarioPublico[];
}

/** Solo el nombre de pila: es una comunidad, no un registro civil. */
function nombreCorto(nombre: string): string {
  const limpio = nombre.trim();
  if (!limpio) return "Alumna";
  const [pila, apellido] = limpio.split(/\s+/);
  return apellido ? `${pila} ${apellido[0]!.toUpperCase()}.` : pila!;
}

/**
 * El hilo de un video.
 *
 * Los ocultos no se envían siquiera: filtrarlos en el navegador significaría
 * que viajaron hasta allá y cualquiera podría leerlos en la red.
 */
export async function listar(
  courseId: string,
  lessonId: string,
  userId: string,
  esAdmin: boolean,
): Promise<ComentarioPublico[]> {
  await requireDb();

  const query: Record<string, unknown> = { courseId, lessonId };
  if (!esAdmin) query.hidden = false;

  const filas = await Comment.find(query).sort({ createdAt: -1 }).limit(200).lean();

  const mapa = (f: any): ComentarioPublico => ({
    id: String(f._id),
    authorName: f.authorName || "Alumna",
    body: f.body,
    fromStaff: f.fromStaff,
    createdAt: f.createdAt,
    mine: String(f.user) === userId,
    respuestas: [],
  });

  const raiz = filas.filter((f) => !f.parent).map(mapa);
  const porId = new Map(raiz.map((c) => [c.id, c]));

  // Las respuestas van bajo su comentario, en el orden en que se escribieron.
  for (const f of filas.filter((x) => x.parent).reverse()) {
    porId.get(String(f.parent))?.respuestas.push(mapa(f));
  }

  return raiz;
}

export async function crear(
  userId: string,
  input: { courseId: string; lessonId: string; body: string; parent?: string | null },
): Promise<ComentarioPublico> {
  await requireDb();

  const body = (input.body || "").trim();
  if (!body) throw new CustomError("Escribe tu comentario", 400);
  if (body.length > MAX_LARGO) {
    throw new CustomError(`El comentario no puede pasar de ${MAX_LARGO} caracteres`, 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const creado = await Comment.create({
    user: user._id,
    authorName: user.role === "admin" ? "Equipo Método SK" : nombreCorto(user.name || ""),
    courseId: input.courseId,
    lessonId: input.lessonId,
    body,
    fromStaff: user.role === "admin",
    parent: input.parent || null,
  });

  return {
    id: String(creado._id),
    authorName: creado.authorName,
    body: creado.body,
    fromStaff: creado.fromStaff,
    createdAt: creado.createdAt,
    mine: true,
    respuestas: [],
  };
}

/**
 * Borrar el propio comentario.
 *
 * Se borra de verdad solo si es suyo. La administración oculta, no borra: un
 * hilo que desaparece sin rastro deja a quien preguntó sin saber qué pasó.
 */
export async function borrarPropio(userId: string, id: string) {
  await requireDb();
  const comentario = await Comment.findById(id);
  if (!comentario) throw new CustomError("Comentario no encontrado", 404);
  if (String(comentario.user) !== userId) {
    throw new CustomError("Ese comentario no es tuyo", 403);
  }
  await Comment.deleteMany({ $or: [{ _id: comentario._id }, { parent: comentario._id }] });
  return { ok: true };
}

/* ─────────────── Administración ─────────────── */

/** Todo lo que se ha comentado, lo más nuevo primero, para moderar. */
export async function listarParaAdmin(soloSinResponder = false) {
  await requireDb();

  const filas = await Comment.find({ parent: null }).sort({ createdAt: -1 }).limit(200).lean();
  const ids = filas.map((f) => f._id);
  const respuestas = await Comment.find({ parent: { $in: ids } }).lean();

  const conteo = new Map<string, number>();
  for (const r of respuestas) {
    const key = String(r.parent);
    conteo.set(key, (conteo.get(key) || 0) + 1);
  }

  const lista = filas.map((f) => ({
    id: String(f._id),
    authorName: f.authorName,
    body: f.body,
    courseId: f.courseId,
    lessonId: f.lessonId,
    hidden: f.hidden,
    fromStaff: f.fromStaff,
    createdAt: f.createdAt,
    respuestas: conteo.get(String(f._id)) || 0,
  }));

  return soloSinResponder ? lista.filter((c) => !c.respuestas && !c.fromStaff) : lista;
}

export async function ocultar(id: string, oculto: boolean) {
  await requireDb();
  const comentario = await Comment.findByIdAndUpdate(id, { hidden: oculto }, { new: true });
  if (!comentario) throw new CustomError("Comentario no encontrado", 404);
  return { id, hidden: comentario.hidden };
}

export async function eliminar(id: string) {
  await requireDb();
  await Comment.deleteMany({ $or: [{ _id: id }, { parent: id }] });
  return { ok: true };
}
