import { Types } from "mongoose";
import { User } from "../models/User";
import { ProgressNote, IProgressNote, MAX_LARGO_NOTA } from "../models/ProgressNote";
import { FIRMAS, Firma, esFirma } from "../config/firmas";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import { cloudinaryConfig, urlFirmada } from "./cloudinary.service";
import {
  Angulo,
  Comparativa,
  Medida,
  armarComparativa,
  mapaMedida,
} from "./onboarding.service";
import { sendNotaAvanceEmail } from "../helpers/email.helper";

/**
 * El seguimiento de las fotos de avance, del lado del equipo.
 *
 * Las alumnas suben sus fotos desde "Mi progreso"; hasta ahora se guardaban y
 * nadie del equipo tenía dónde mirarlas. Acá Karen y Scarlett las ven por
 * alumna y por toma, y le dejan a cada una su recomendación, que le llega
 * avisada por correo.
 *
 * Todo esto es privado: son fotos de su cuerpo. Las URLs se firman al vuelo,
 * nada de esto sale por una ruta que no pase por el middleware de admin o por
 * la sesión de la propia alumna, y el correo avisa sin llevar ni el texto ni
 * las fotos.
 */

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

const DIA_MS = 86_400_000;

/** Un día del calendario de Ecuador, para agrupar fotos subidas el mismo día. */
function claveDia(fecha: Date): string {
  return fecha.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
}

function siteUrl(): string {
  return (process.env.SITE_URL || "https://metodosk.ec").replace(/\/$/, "");
}

/* ─────────────── Conversación ─────────────── */

export interface NotaPublica {
  id: string;
  fromStaff: boolean;
  /** Cómo se pinta quien escribe. En sus respuestas, su nombre de pila. */
  autor: { nombre: string; rol: string; inicial: string; firma: Firma | null };
  body: string;
  tomaDel: string | null;
  createdAt: string;
  /** Cuándo lo leyó la otra parte. */
  leidaEl: string | null;
  /** Solo para el panel: si el correo de aviso salió. */
  avisoEnviadoEl?: string | null;
}

function mapaNota(
  n: Pick<IProgressNote, "_id" | "fromStaff" | "firma" | "body" | "tomaDel" | "createdAt" | "leidaEl" | "avisoEnviadoEl">,
  nombreAlumna: string,
  paraAdmin: boolean,
): NotaPublica {
  const firma = n.fromStaff ? (n.firma ?? "equipo") : null;
  const pila = nombreAlumna.trim().split(/\s+/)[0] || "Alumna";
  const autor = firma
    ? { nombre: FIRMAS[firma].nombre, rol: FIRMAS[firma].rol, inicial: FIRMAS[firma].inicial, firma }
    : { nombre: pila, rol: "", inicial: pila[0]!.toUpperCase(), firma: null };

  return {
    id: String(n._id),
    fromStaff: n.fromStaff,
    autor,
    body: n.body,
    tomaDel: n.tomaDel ? n.tomaDel.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    leidaEl: n.leidaEl ? n.leidaEl.toISOString() : null,
    ...(paraAdmin
      ? { avisoEnviadoEl: n.avisoEnviadoEl ? n.avisoEnviadoEl.toISOString() : null }
      : {}),
  };
}

async function conversacion(alumnaId: string, nombre: string, paraAdmin: boolean) {
  const filas = await ProgressNote.find({ alumna: alumnaId }).sort({ createdAt: 1 }).lean();
  return filas.map((n) => mapaNota(n as unknown as IProgressNote, nombre, paraAdmin));
}

function limpiarTexto(body: unknown): string {
  const texto = String(body ?? "").trim();
  if (!texto) throw new CustomError("Escribe el mensaje", 400);
  if (texto.length > MAX_LARGO_NOTA) {
    throw new CustomError(`El mensaje no puede pasar de ${MAX_LARGO_NOTA} caracteres`, 400);
  }
  return texto;
}

/* ─────────────── Panel: lista de alumnas ─────────────── */

export interface ResumenAlumna {
  id: string;
  nombre: string;
  email: string;
  reto: string | null;
  /** Miniatura de su última foto de frente (o la que haya). */
  miniatura: string | null;
  /** Cuántos días distintos subió fotos. */
  tomas: number;
  primeraToma: string;
  ultimaToma: string;
  /** Días entre su primera foto y hoy: en qué punto del reto va. */
  diasDesdeInicio: number;
  ultimoComentario: string | null;
  /** Subió fotos después del último comentario del equipo (o nunca se le comentó). */
  porComentar: boolean;
  /** Respuestas suyas que el equipo no ha abierto. */
  respuestasNuevas: number;
}

export async function listarAlumnas(): Promise<{
  alumnas: ResumenAlumna[];
  sinFotos: number;
}> {
  await requireDb();
  const hayCloudinary = Boolean(cloudinaryConfig());

  const usuarias = await User.find({ role: "member", "progressPhotos.0": { $exists: true } })
    .select("name email challenge progressPhotos")
    .lean();

  const sinFotos = await User.countDocuments({
    role: "member",
    accessUntil: { $gt: new Date() },
    "progressPhotos.0": { $exists: false },
  });

  const ids = usuarias.map((u) => u._id);
  const notas = await ProgressNote.find({ alumna: { $in: ids } })
    .select("alumna fromStaff leidaEl createdAt")
    .lean();

  const ultimoDelEquipo = new Map<string, Date>();
  const nuevas = new Map<string, number>();
  for (const n of notas) {
    const key = String(n.alumna);
    if (n.fromStaff) {
      const antes = ultimoDelEquipo.get(key);
      if (!antes || n.createdAt > antes) ultimoDelEquipo.set(key, n.createdAt);
    } else if (!n.leidaEl) {
      nuevas.set(key, (nuevas.get(key) || 0) + 1);
    }
  }

  const ahora = Date.now();
  const alumnas = usuarias.map((u): ResumenAlumna => {
    const fotos = [...u.progressPhotos].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const ultima = fotos[0]!;
    const primera = fotos[fotos.length - 1]!;
    const portada = fotos.find((f) => f.angulo === "frente") ?? ultima;
    const comentario = ultimoDelEquipo.get(String(u._id)) ?? null;

    return {
      id: String(u._id),
      nombre: u.name || u.email,
      email: u.email,
      reto: u.challenge ?? null,
      miniatura: hayCloudinary ? urlFirmada(portada.publicId, 240) : null,
      tomas: new Set(fotos.map((f) => claveDia(new Date(f.createdAt)))).size,
      primeraToma: new Date(primera.createdAt).toISOString(),
      ultimaToma: new Date(ultima.createdAt).toISOString(),
      diasDesdeInicio: Math.floor((ahora - new Date(primera.createdAt).getTime()) / DIA_MS),
      ultimoComentario: comentario ? comentario.toISOString() : null,
      porComentar: !comentario || new Date(ultima.createdAt) > comentario,
      respuestasNuevas: nuevas.get(String(u._id)) || 0,
    };
  });

  // Primero lo que espera al equipo: respuestas suyas, después fotos sin
  // comentar; dentro de cada grupo, lo más reciente arriba.
  alumnas.sort((a, b) => {
    const peso = (x: ResumenAlumna) => (x.respuestasNuevas ? 2 : 0) + (x.porComentar ? 1 : 0);
    return peso(b) - peso(a) || b.ultimaToma.localeCompare(a.ultimaToma);
  });

  return { alumnas, sinFotos };
}

/* ─────────────── Panel: la ficha de una alumna ─────────────── */

export interface Toma {
  /** El día, como AAAA-MM-DD de Ecuador. */
  dia: string;
  fecha: string;
  fotos: Array<{ angulo: Angulo; url: string; grande: string; createdAt: string }>;
}

export interface FichaAlumna {
  alumna: {
    id: string;
    nombre: string;
    email: string;
    reto: string | null;
    accessUntil: string | null;
  };
  tomas: Toma[];
  comparativa: Comparativa[];
  medidas: Medida[];
  notas: NotaPublica[];
  fotosDisponibles: boolean;
}

export async function fichaAlumna(alumnaId: string): Promise<FichaAlumna> {
  await requireDb();
  if (!Types.ObjectId.isValid(alumnaId)) throw new CustomError("Alumna no encontrada", 404);

  const user = await User.findById(alumnaId);
  if (!user || user.role !== "member") throw new CustomError("Alumna no encontrada", 404);

  const hayCloudinary = Boolean(cloudinaryConfig());
  const fotos = [...(user.progressPhotos || [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // Una toma = las fotos de un mismo día. Así se miran juntas la de frente y
  // la de espalda del día 15, en vez de sueltas en una lista.
  const porDia = new Map<string, Toma>();
  for (const f of fotos) {
    const dia = claveDia(f.createdAt);
    if (!porDia.has(dia)) {
      porDia.set(dia, { dia, fecha: f.createdAt.toISOString(), fotos: [] });
    }
    porDia.get(dia)!.fotos.push({
      angulo: f.angulo,
      url: hayCloudinary ? urlFirmada(f.publicId, 600) : "",
      grande: hayCloudinary ? urlFirmada(f.publicId, 1400) : "",
      createdAt: f.createdAt.toISOString(),
    });
  }
  const orden: Record<string, number> = { frente: 0, espalda: 1, lado: 2 };
  for (const t of porDia.values()) t.fotos.sort((a, b) => orden[a.angulo]! - orden[b.angulo]!);

  // Se leen antes de marcarlas: así esta vez todavía se ve cuáles eran nuevas.
  const notas = await conversacion(String(user._id), user.name || "", true);

  // Abrir la ficha es leer lo que ella escribió.
  await ProgressNote.updateMany(
    { alumna: user._id, fromStaff: false, leidaEl: null },
    { $set: { leidaEl: new Date() } },
  );

  return {
    alumna: {
      id: String(user._id),
      nombre: user.name || user.email,
      email: user.email,
      reto: user.challenge ?? null,
      accessUntil: user.accessUntil ? user.accessUntil.toISOString() : null,
    },
    tomas: [...porDia.values()],
    comparativa: armarComparativa(fotos, hayCloudinary),
    medidas: [...(user.measurements || [])]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(mapaMedida),
    notas,
    fotosDisponibles: hayCloudinary,
  };
}

/* ─────────────── Panel: comentar ─────────────── */

/**
 * Si ya se le avisó hace menos de esto, el comentario nuevo no manda otro
 * correo: tres comentarios seguidos son una sola visita a su cuenta, y el
 * plan de Resend tiene tope diario compartido con los correos de compra.
 */
const VENTANA_AVISO_MS = 30 * 60_000;

export async function comentar(
  adminId: string,
  alumnaId: string,
  input: { body: unknown; firma: unknown; tomaDel?: unknown },
): Promise<{ notas: NotaPublica[]; avisada: boolean }> {
  await requireDb();
  if (!Types.ObjectId.isValid(alumnaId)) throw new CustomError("Alumna no encontrada", 404);
  if (!esFirma(input.firma)) throw new CustomError("Elige con qué nombre firmas", 400);
  const body = limpiarTexto(input.body);

  const user = await User.findById(alumnaId);
  if (!user || user.role !== "member") throw new CustomError("Alumna no encontrada", 404);

  const tomaDel =
    typeof input.tomaDel === "string" && !Number.isNaN(Date.parse(input.tomaDel))
      ? new Date(input.tomaDel)
      : null;

  const nota = await ProgressNote.create({
    alumna: user._id,
    autor: new Types.ObjectId(adminId),
    fromStaff: true,
    firma: input.firma,
    body,
    tomaDel,
  });

  const reciente = await ProgressNote.exists({
    alumna: user._id,
    fromStaff: true,
    _id: { $ne: nota._id },
    avisoEnviadoEl: { $gte: new Date(Date.now() - VENTANA_AVISO_MS) },
  });

  let avisada = false;
  if (reciente) {
    // Ya tiene un correo reciente que la trae a la conversación: esta nota se
    // da por avisada con él.
    nota.avisoEnviadoEl = new Date();
    await nota.save();
  } else {
    avisada = await avisar(nota, user);
  }

  return { notas: await conversacion(String(user._id), user.name || "", true), avisada };
}

/** Quitar un comentario del equipo, por si salió con un error. */
export async function borrarNota(notaId: string): Promise<void> {
  await requireDb();
  if (!Types.ObjectId.isValid(notaId)) throw new CustomError("Comentario no encontrado", 404);
  await ProgressNote.deleteOne({ _id: notaId });
}

/** Manda el correo de una nota y deja constancia. Nunca lanza. */
async function avisar(
  nota: InstanceType<typeof ProgressNote>,
  user: { name?: string | null; email: string },
): Promise<boolean> {
  const firma = FIRMAS[nota.firma ?? "equipo"];
  const url = `${siteUrl()}/mi-progreso?nota=${nota._id}#notas`;

  const ok = await sendNotaAvanceEmail({
    to: user.email,
    name: user.name,
    firma: { ...firma, esEquipo: (nota.firma ?? "equipo") === "equipo" },
    tomaDel: nota.tomaDel,
    url,
  });

  if (ok) nota.avisoEnviadoEl = new Date();
  else nota.avisoIntentos += 1;
  await nota.save();
  return ok;
}

/**
 * Reintenta los avisos que no salieron (Resend caído, cupo del día agotado).
 *
 * Solo los de los últimos tres días y con menos de tres intentos: un aviso de
 * hace una semana ya no avisa nada, y uno que falla siempre es un correo roto.
 */
export async function reintentarAvisos(): Promise<{ enviados: number; fallidos: number }> {
  await requireDb();
  const pendientes = await ProgressNote.find({
    fromStaff: true,
    avisoEnviadoEl: null,
    avisoIntentos: { $lt: 3 },
    createdAt: { $gte: new Date(Date.now() - 3 * DIA_MS) },
  })
    .sort({ createdAt: 1 })
    .limit(20);

  let enviados = 0;
  let fallidos = 0;
  const avisadas = new Set<string>();

  for (const nota of pendientes) {
    const key = String(nota.alumna);
    // Varias pendientes de la misma alumna: un solo correo.
    if (avisadas.has(key)) {
      nota.avisoEnviadoEl = new Date();
      await nota.save();
      continue;
    }
    const user = await User.findById(nota.alumna).select("name email").lean();
    if (!user?.email) {
      nota.avisoIntentos = 3;
      await nota.save();
      continue;
    }
    if (await avisar(nota, user)) {
      enviados++;
      avisadas.add(key);
    } else {
      fallidos++;
    }
  }

  return { enviados, fallidos };
}

/* ─────────────── La alumna ─────────────── */

export async function misNotas(userId: string): Promise<{ notas: NotaPublica[]; nuevas: number }> {
  await requireDb();
  const user = await User.findById(userId).select("name").lean();
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const notas = await conversacion(userId, user.name || "", false);
  return { notas, nuevas: notas.filter((n) => n.fromStaff && !n.leidaEl).length };
}

/** Las del equipo que tenía sin leer pasan a leídas. Lo llama la vista al mostrarlas. */
export async function marcarLeidas(userId: string): Promise<void> {
  await requireDb();
  await ProgressNote.updateMany(
    { alumna: userId, fromStaff: true, leidaEl: null },
    { $set: { leidaEl: new Date() } },
  );
}

/**
 * Ella contesta.
 *
 * Solo se puede contestar una conversación que el equipo empezó: esto es para
 * seguir una recomendación, no un canal de soporte abierto (para eso está
 * Telegram).
 */
export async function responder(userId: string, body: unknown) {
  await requireDb();
  const texto = limpiarTexto(body);

  const empezada = await ProgressNote.exists({ alumna: userId, fromStaff: true });
  if (!empezada) throw new CustomError("Todavía no hay comentarios que contestar", 400);

  await ProgressNote.create({
    alumna: new Types.ObjectId(userId),
    autor: new Types.ObjectId(userId),
    fromStaff: false,
    body: texto,
    // Sus respuestas no mandan correo: el aviso para el equipo es el contador
    // del panel.
    avisoEnviadoEl: new Date(),
  });

  return misNotas(userId);
}
