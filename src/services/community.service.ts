import { CommunityPost, MAX_LARGO_POST } from "../models/CommunityPost";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import { firmarSubidaAvatar, urlAvatar, borrarImagen } from "./cloudinary.service";

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

/** Solo el nombre de pila: es una comunidad, no un registro civil. */
function nombreCorto(nombre: string): string {
  const limpio = nombre.trim();
  if (!limpio) return "Alumna";
  const [pila, apellido] = limpio.split(/\s+/);
  return apellido ? `${pila} ${apellido[0]!.toUpperCase()}.` : pila!;
}

export interface MensajePublico {
  id: string;
  authorName: string;
  /** URL lista para pintar, o null si no puso foto. */
  avatarUrl: string | null;
  /** La inicial, para el círculo de color cuando no hay foto. */
  inicial: string;
  body: string;
  fromStaff: boolean;
  createdAt: string;
  mine: boolean;
}

function mapa(fila: any, userId: string): MensajePublico {
  const authorName = fila.authorName || "Alumna";
  return {
    id: String(fila._id),
    authorName,
    avatarUrl: urlAvatar(fila.authorAvatar ?? null),
    inicial: authorName[0]!.toUpperCase(),
    body: fila.body,
    fromStaff: Boolean(fila.fromStaff),
    createdAt: fila.createdAt.toISOString(),
    mine: String(fila.user) === userId,
  };
}

/**
 * La última página del muro.
 *
 * Vuelve del más nuevo al más viejo porque así se pagina, pero se entrega al
 * revés: un chat se lee hacia abajo, y darle la vuelta en el navegador
 * significaría hacerlo en cada refresco.
 *
 * `desde` permite pedir solo lo que llegó después de un mensaje concreto: el
 * muro se refresca solo cada pocos segundos y traer los 60 completos cada vez
 * sería gastar batería para repintar lo mismo.
 */
export async function listar(
  userId: string,
  esAdmin: boolean,
  opciones: { desde?: string; limite?: number } = {},
): Promise<{ mensajes: MensajePublico[]; hayMas: boolean }> {
  await requireDb();

  const limite = Math.min(Math.max(opciones.limite ?? 60, 1), 100);
  const query: Record<string, unknown> = {};
  if (!esAdmin) query.hidden = false;

  if (opciones.desde) {
    const fecha = new Date(opciones.desde);
    if (!Number.isNaN(fecha.getTime())) query.createdAt = { $gt: fecha };
  }

  // Se pide uno de más para saber si quedan anteriores, sin contar la colección.
  const filas = await CommunityPost.find(query)
    .sort({ createdAt: -1 })
    .limit(limite + 1)
    .lean();

  const hayMas = filas.length > limite;
  const pagina = hayMas ? filas.slice(0, limite) : filas;

  return {
    mensajes: pagina.reverse().map((f) => mapa(f, userId)),
    hayMas,
  };
}

export async function publicar(userId: string, texto: string): Promise<MensajePublico> {
  await requireDb();

  const body = (texto || "").trim();
  if (!body) throw new CustomError("Escribe tu mensaje", 400);
  if (body.length > MAX_LARGO_POST) {
    throw new CustomError(`El mensaje no puede pasar de ${MAX_LARGO_POST} caracteres`, 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const esStaff = user.role === "admin";
  const creado = await CommunityPost.create({
    user: user._id,
    authorName: esStaff ? user.name || "Equipo Método SK" : nombreCorto(user.name || ""),
    authorAvatar: user.avatarPublicId ?? null,
    body,
    fromStaff: esStaff,
  });

  return mapa(creado.toObject(), userId);
}

/**
 * Borrar el propio mensaje.
 *
 * La administración además puede borrar cualquiera: en un muro abierto hace
 * falta poder quitar algo hoy, no cuando alguien revise la cola de moderación.
 */
export async function borrar(userId: string, esAdmin: boolean, id: string) {
  await requireDb();

  const post = await CommunityPost.findById(id);
  if (!post) throw new CustomError("Mensaje no encontrado", 404);
  if (!esAdmin && String(post.user) !== userId) {
    throw new CustomError("Ese mensaje no es tuyo", 403);
  }

  await post.deleteOne();
  return { ok: true };
}

/* ─────────────── Foto de perfil ─────────────── */

/** Firma la subida del avatar. La imagen no pasa por este servidor. */
export function firmarAvatar(userId: string) {
  return firmarSubidaAvatar(userId);
}

/**
 * Guarda su nueva foto de perfil.
 *
 * Los mensajes ya publicados conservan la foto con la que salieron: el muro es
 * un registro de lo que se dijo y cuándo, no una vista que se reescribe hacia
 * atrás cada vez que alguien cambia de foto.
 */
export async function guardarAvatar(userId: string, publicId: string) {
  await requireDb();
  if (!publicId?.trim()) throw new CustomError("Falta la foto", 400);

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const anterior = user.avatarPublicId;
  user.avatarPublicId = publicId.trim();
  await user.save();

  // La anterior ya no la referencia nada: dejarla es acumular basura pagada.
  if (anterior && anterior !== user.avatarPublicId) {
    const enUso = await CommunityPost.exists({ authorAvatar: anterior });
    if (!enUso) await borrarImagen(anterior, "upload").catch(() => undefined);
  }

  return { avatarUrl: urlAvatar(user.avatarPublicId), publicId: user.avatarPublicId };
}

/** Volver a la inicial. Poner foto es opcional, y quitarla también. */
export async function quitarAvatar(userId: string) {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const anterior = user.avatarPublicId;
  user.avatarPublicId = null;
  await user.save();

  if (anterior) {
    const enUso = await CommunityPost.exists({ authorAvatar: anterior });
    if (!enUso) await borrarImagen(anterior, "upload").catch(() => undefined);
  }

  return { avatarUrl: null, publicId: null };
}

/** Su avatar actual, para pintarlo en el compositor antes de escribir nada. */
export async function miAvatar(userId: string) {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const nombre = user.role === "admin" ? user.name || "Equipo" : nombreCorto(user.name || "");
  return {
    avatarUrl: urlAvatar(user.avatarPublicId ?? null),
    publicId: user.avatarPublicId ?? null,
    nombre,
    inicial: nombre[0]!.toUpperCase(),
  };
}
