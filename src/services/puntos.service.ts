import { Progress } from "../models/Progress";
import { CommunityPost } from "../models/CommunityPost";
import { Comment } from "../models/Comment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import {
  INSIGNIAS,
  NIVELES,
  PREMIO_DEL_MES,
  PUNTOS,
  nivelDe,
  type AccionPuntos,
  type Conteo,
} from "../config/puntos";
import { urlAvatar } from "./cloudinary.service";

/**
 * Los puntos de cada alumna, contados desde lo que ya está guardado.
 *
 * No hay una tabla de puntos aparte: se cuentan las clases terminadas, las
 * publicaciones, los comentarios, las reacciones recibidas y las tomas de
 * avance. Así no hay forma de que el número se desfase de lo que hizo, y los
 * puntos valen hacia atrás: lo que hizo antes de que existiera el ranking
 * también cuenta.
 *
 * Con ~200 alumnas se calcula entero en una pasada y se guarda un minuto en
 * memoria. Publicar o reaccionar lo invalida, para que vea sus puntos subir.
 */

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

interface Evento {
  user: string;
  accion: AccionPuntos;
  fecha: Date;
}

export interface PuntosAlumna {
  userId: string;
  nombre: string;
  avatarPublicId: string | null;
  total: number;
  mes: number;
  porAccion: Record<AccionPuntos, number>;
  conteo: Conteo;
}

/** El día en Ecuador (UTC-5): el tope diario se cuenta en su día, no en el de Londres. */
const DESFASE_MS = 5 * 3_600_000;
const diaDe = (fecha: Date) => new Date(fecha.getTime() - DESFASE_MS).toISOString().slice(0, 10);
const mesDe = (fecha: Date) => diaDe(fecha).slice(0, 7);

/** Solo el nombre de pila y la inicial: es un ranking, no un registro civil. */
function nombreCorto(nombre: string): string {
  const limpio = (nombre || "").trim();
  if (!limpio) return "Alumna";
  const [pila, apellido] = limpio.split(/\s+/);
  // "MIGUEL" y "miguel" se ven como "Miguel": en un ranking, las mayúsculas gritan.
  const corto = pila![0]!.toUpperCase() + pila!.slice(1).toLowerCase();
  return apellido ? `${corto} ${apellido[0]!.toUpperCase()}.` : corto;
}

const CERO: Record<AccionPuntos, number> = {
  video: 0,
  publicacion: 0,
  comentario: 0,
  reaccion: 0,
  fotos: 0,
  medidas: 0,
};

let cache: { hecho: number; datos: Map<string, PuntosAlumna> } | null = null;
const VIGENCIA_MS = 60_000;

/** Publicar, comentar o reaccionar cambia los puntos: la próxima lectura recalcula. */
export function invalidarPuntos() {
  cache = null;
}

async function calcular(): Promise<Map<string, PuntosAlumna>> {
  if (cache && Date.now() - cache.hecho < VIGENCIA_MS) return cache.datos;
  await requireDb();

  const alumnas = await User.find(
    { role: "member", clientTransactionId: { $not: /^PRUEBA-TELEGRAM-BOT/ } },
    { name: 1, avatarPublicId: 1, "progressPhotos.createdAt": 1, "measurements.createdAt": 1 },
  ).lean();
  const ids = new Set(alumnas.map((a) => String(a._id)));

  const eventos: Evento[] = [];
  const logros = new Map<string, number>();

  for (const a of alumnas) {
    const user = String(a._id);
    for (const f of a.progressPhotos ?? []) eventos.push({ user, accion: "fotos", fecha: f.createdAt });
    for (const m of a.measurements ?? []) eventos.push({ user, accion: "medidas", fecha: m.createdAt });
  }

  const [vistos, posts, comentarios] = await Promise.all([
    Progress.find({ completed: true }, { user: 1, completedAt: 1, updatedAt: 1 }).lean(),
    CommunityPost.find(
      { hidden: false, fromStaff: false },
      { user: 1, createdAt: 1, tipo: 1, reacciones: 1 },
    ).lean(),
    Comment.find({ hidden: false, fromStaff: false }, { user: 1, createdAt: 1 }).lean(),
  ]);

  for (const v of vistos) {
    eventos.push({ user: String(v.user), accion: "video", fecha: v.completedAt ?? v.updatedAt });
  }
  for (const p of posts) {
    const autora = String(p.user);
    eventos.push({ user: autora, accion: "publicacion", fecha: p.createdAt });
    if (p.tipo === "logro") logros.set(autora, (logros.get(autora) ?? 0) + 1);
    // Reaccionar a lo propio no suma: los puntos son por lo que provoca en otras.
    for (const r of p.reacciones ?? []) {
      if (String(r.user) !== autora) {
        eventos.push({ user: autora, accion: "reaccion", fecha: r.createdAt ?? p.createdAt });
      }
    }
  }
  for (const c of comentarios) {
    eventos.push({ user: String(c.user), accion: "comentario", fecha: c.createdAt });
  }

  const esteMes = mesDe(new Date());
  const datos = new Map<string, PuntosAlumna>();
  for (const a of alumnas) {
    datos.set(String(a._id), {
      userId: String(a._id),
      nombre: nombreCorto(a.name || ""),
      avatarPublicId: a.avatarPublicId ?? null,
      total: 0,
      mes: 0,
      porAccion: { ...CERO },
      conteo: {
        videos: 0,
        publicaciones: 0,
        logros: logros.get(String(a._id)) ?? 0,
        comentarios: 0,
        reacciones: 0,
        tomasFotos: 0,
        tomasMedidas: 0,
        diasActivos: 0,
      },
    });
  }

  // Cuántas veces sumó cada acción cada día, para aplicar el tope.
  const usadas = new Map<string, number>();
  const dias = new Map<string, Set<string>>();

  for (const e of eventos.sort((x, y) => x.fecha.getTime() - y.fecha.getTime())) {
    if (!ids.has(e.user)) continue;
    const alumna = datos.get(e.user)!;
    const regla = PUNTOS[e.accion];
    const dia = diaDe(e.fecha);

    const clave = `${e.user}|${e.accion}|${dia}`;
    const veces = usadas.get(clave) ?? 0;

    // El conteo para insignias va por hechos, no por puntos: las fotos y las
    // medidas se cuentan por día (una toma), el resto por cada vez.
    if (e.accion === "video") alumna.conteo.videos++;
    if (e.accion === "publicacion") alumna.conteo.publicaciones++;
    if (e.accion === "comentario") alumna.conteo.comentarios++;
    if (e.accion === "reaccion") alumna.conteo.reacciones++;
    if (e.accion === "fotos" && veces === 0) alumna.conteo.tomasFotos++;
    if (e.accion === "medidas" && veces === 0) alumna.conteo.tomasMedidas++;

    usadas.set(clave, veces + 1);
    if (regla.topeDiario !== null && veces >= regla.topeDiario) continue;

    alumna.total += regla.puntos;
    alumna.porAccion[e.accion] += regla.puntos;
    if (mesDe(e.fecha) === esteMes) alumna.mes += regla.puntos;

    if (!dias.has(e.user)) dias.set(e.user, new Set());
    dias.get(e.user)!.add(dia);
  }

  for (const [user, set] of dias) datos.get(user)!.conteo.diasActivos = set.size;

  cache = { hecho: Date.now(), datos };
  return datos;
}

/** El nivel de cada autora, para pintarlo junto a su nombre en el muro. */
export async function nivelesDeAutoras(): Promise<Map<string, { nivel: number; nombre: string }>> {
  const datos = await calcular();
  const mapa = new Map<string, { nivel: number; nombre: string }>();
  for (const [id, a] of datos) {
    const n = nivelDe(a.total);
    mapa.set(id, { nivel: n.nivel, nombre: n.nombre });
  }
  return mapa;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Todo lo que pinta la pantalla de puntos: lo suyo, el ranking y las reglas. */
export async function misPuntos(userId: string, esAdmin: boolean) {
  const datos = await calcular();

  const ordenados = [...datos.values()]
    .filter((a) => a.mes > 0)
    .sort((x, y) => y.mes - x.mes || y.total - x.total);

  const ranking = ordenados.slice(0, 10).map((a, i) => ({
    posicion: i + 1,
    nombre: a.nombre,
    inicial: a.nombre[0]!.toUpperCase(),
    avatarUrl: urlAvatar(a.avatarPublicId),
    puntos: a.mes,
    nivel: nivelDe(a.total).nombre,
    yo: a.userId === userId,
  }));

  const mia = datos.get(userId) ?? null;
  const posicion = mia ? ordenados.findIndex((a) => a.userId === userId) + 1 : 0;

  const ahora = new Date(Date.now() - DESFASE_MS);

  return {
    mes: MESES[ahora.getUTCMonth()],
    premio: PREMIO_DEL_MES,
    // La administración no compite: ve el ranking, no tiene puntos propios.
    yo:
      mia && !esAdmin
        ? {
            total: mia.total,
            mes: mia.mes,
            posicion: posicion || null,
            participantes: ordenados.length,
            nivel: nivelDe(mia.total),
            porAccion: mia.porAccion,
            insignias: INSIGNIAS.map((i) => ({
              id: i.id,
              nombre: i.nombre,
              como: i.como,
              icono: i.icono,
              ganada: i.ganada(mia.conteo),
            })),
          }
        : null,
    ranking,
    reglas: (Object.keys(PUNTOS) as AccionPuntos[]).map((accion) => ({ accion, ...PUNTOS[accion] })),
    niveles: NIVELES,
    insignias: INSIGNIAS.map((i) => ({ id: i.id, nombre: i.nombre, como: i.como, icono: i.icono })),
  };
}
