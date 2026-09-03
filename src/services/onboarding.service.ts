import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import {
  cloudinaryConfig,
  firmarSubidaFoto,
  urlFirmada,
  borrarFoto,
} from "./cloudinary.service";

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

/**
 * Los ángulos que pide Karen: de frente y de espalda.
 *
 * `lado` queda aceptado por si alguien ya subió uno, pero no se le pide.
 */
export const ANGULOS = ["frente", "espalda", "lado"] as const;
export type Angulo = (typeof ANGULOS)[number];

/** Los que se piden en cada toma. */
export const ANGULOS_PEDIDOS: Angulo[] = ["frente", "espalda"];

/**
 * Cada cuánto toca repetir las fotos.
 *
 * Una vez al mes. Quincenal daba un cambio tan chico entre toma y toma que la
 * comparación desanimaba en vez de motivar: a los catorce días el espejo no se
 * mueve, y lo que se ve es "no pasó nada". Al mes sí hay diferencia que mirar.
 */
export const DIAS_ENTRE_TOMAS = 30;

/** Los campos de una toma de medidas. Todos opcionales: se apunta lo que se midió. */
export interface Medida {
  pesoKg: number | null;
  cinturaCm: number | null;
  caderaCm: number | null;
  pechoCm: number | null;
  brazoCm: number | null;
  piernaCm: number | null;
  nota: string;
  createdAt: string;
}

/** Una foto de partida y la más reciente del mismo ángulo, para comparar. */
export interface Comparativa {
  angulo: Angulo;
  antes: { url: string; createdAt: string };
  despues: { url: string; createdAt: string };
  /** Cuánto tiempo separa las dos. Es la mitad de lo que dice una comparación. */
  diasEntre: number;
}

export interface EstadoOnboarding {
  videoSeen: boolean;
  photosUploaded: boolean;
  skipped: boolean;
  completedAt: string | null;
  /** true cuando ya no hay que mostrarle el recorrido. */
  done: boolean;
  /** Todas sus fotos, de la más reciente a la más antigua. */
  fotos: Array<{ angulo: Angulo; url: string; createdAt: string }>;
  /** La última de cada ángulo: la referencia para repetir la misma pose. */
  ultimas: Partial<Record<Angulo, { url: string; createdAt: string }>>;
  /** Cuándo toca la siguiente toma. null si todavía no subió ninguna. */
  proximaToma: string | null;
  /**
   * Cuántos días faltan para la siguiente. 0 = hoy le toca.
   * null cuando todavía no hay ninguna foto de la que contar.
   */
  diasParaProxima: number | null;
  /** true cuando ya pasó el mes. */
  tomaPendiente: boolean;
  /** Cada cuántos días se repite la toma. Lo pinta la vista, no lo adivina. */
  diasEntreTomas: number;
  /** Antes y después por ángulo. Vacío mientras solo haya una toma. */
  comparativa: Comparativa[];
  /** Sus medidas, de la más reciente a la más antigua. */
  medidas: Medida[];
  /** false si falta configurar Cloudinary: la vista lo dice en vez de fallar. */
  fotosDisponibles: boolean;
}

function armarEstado(user: InstanceType<typeof User>): EstadoOnboarding {
  const onboarding = user.onboarding || {
    videoSeen: false,
    photosUploaded: false,
    skipped: false,
    completedAt: null,
  };
  const hayCloudinary = Boolean(cloudinaryConfig());

  const fotos = [...(user.progressPhotos || [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // La última de cada ángulo se muestra al tomar la siguiente: repetir la
  // misma pose y la misma ropa es lo que hace comparables dos fotos.
  const ultimas: EstadoOnboarding["ultimas"] = {};
  for (const f of fotos) {
    if (!ultimas[f.angulo]) {
      ultimas[f.angulo] = {
        url: hayCloudinary ? urlFirmada(f.publicId) : "",
        createdAt: f.createdAt.toISOString(),
      };
    }
  }

  const masReciente = fotos[0]?.createdAt ?? null;
  const proximaToma = masReciente
    ? new Date(masReciente.getTime() + DIAS_ENTRE_TOMAS * 86_400_000)
    : null;

  const ahora = new Date();
  // Días enteros hacia arriba: faltando 20 horas se dice "1 día", no "0".
  const diasParaProxima = proximaToma
    ? Math.max(0, Math.ceil((proximaToma.getTime() - ahora.getTime()) / 86_400_000))
    : null;

  return {
    videoSeen: onboarding.videoSeen,
    photosUploaded: onboarding.photosUploaded,
    skipped: onboarding.skipped,
    completedAt: onboarding.completedAt ? onboarding.completedAt.toISOString() : null,
    done: Boolean(onboarding.completedAt) || onboarding.skipped,
    fotos: fotos.map((f) => ({
      angulo: f.angulo,
      // Firmada al vuelo: la URL no se guarda, se construye cuando se pide.
      url: hayCloudinary ? urlFirmada(f.publicId) : "",
      createdAt: f.createdAt.toISOString(),
    })),
    ultimas,
    proximaToma: proximaToma ? proximaToma.toISOString() : null,
    diasParaProxima,
    tomaPendiente: Boolean(proximaToma && proximaToma <= ahora),
    diasEntreTomas: DIAS_ENTRE_TOMAS,
    comparativa: armarComparativa(fotos, hayCloudinary),
    medidas: [...(user.measurements || [])]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(mapaMedida),
    fotosDisponibles: hayCloudinary,
  };
}

function mapaMedida(m: InstanceType<typeof User>["measurements"][number]): Medida {
  return {
    pesoKg: m.pesoKg ?? null,
    cinturaCm: m.cinturaCm ?? null,
    caderaCm: m.caderaCm ?? null,
    pechoCm: m.pechoCm ?? null,
    brazoCm: m.brazoCm ?? null,
    piernaCm: m.piernaCm ?? null,
    nota: m.nota || "",
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * El antes y el después de cada ángulo.
 *
 * "Antes" es la primera foto que subió, no la anterior: comparar contra la del
 * mes pasado esconde justo lo que costó tres meses conseguir. Y solo aparece
 * cuando hay dos tomas distintas del mismo ángulo — una foto contra sí misma
 * no es una comparación, es un error de la pantalla.
 */
function armarComparativa(
  fotos: InstanceType<typeof User>["progressPhotos"],
  hayCloudinary: boolean,
): Comparativa[] {
  if (!hayCloudinary) return [];

  const salida: Comparativa[] = [];

  for (const angulo of ANGULOS) {
    // `fotos` llega de la más reciente a la más antigua.
    const delAngulo = fotos.filter((f) => f.angulo === angulo);
    if (delAngulo.length < 2) continue;

    const despues = delAngulo[0]!;
    const antes = delAngulo[delAngulo.length - 1]!;

    salida.push({
      angulo,
      antes: { url: urlFirmada(antes.publicId), createdAt: antes.createdAt.toISOString() },
      despues: {
        url: urlFirmada(despues.publicId),
        createdAt: despues.createdAt.toISOString(),
      },
      diasEntre: Math.max(
        0,
        Math.round((despues.createdAt.getTime() - antes.createdAt.getTime()) / 86_400_000),
      ),
    });
  }

  return salida;
}

export async function estado(userId: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);
  return armarEstado(user);
}

/** Ella confirma que vio el video. No lo damos por hecho desde el reproductor. */
export async function marcarVideoVisto(userId: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  user.onboarding.videoSeen = true;
  await user.save();
  return armarEstado(user);
}

export function firmarFoto(userId: string, angulo: string) {
  if (!ANGULOS.includes(angulo as Angulo)) {
    throw new CustomError("Ese ángulo de foto no existe", 400);
  }
  return firmarSubidaFoto(userId, angulo);
}

/**
 * Guarda la referencia de una foto ya subida a Cloudinary.
 *
 * El histórico se conserva: la gracia de repetir la foto cada dos semanas con
 * la misma ropa es poder comparar la semana 1 con la semana 12. Borrar la
 * anterior tiraría justo lo que hace que valga la pena tomarlas.
 *
 * Lo único que se reemplaza es una foto del mismo ángulo tomada hoy: eso no es
 * una toma nueva, es que la primera le salió mal.
 */
export async function guardarFoto(
  userId: string,
  angulo: string,
  publicId: string,
): Promise<EstadoOnboarding> {
  await requireDb();
  if (!ANGULOS.includes(angulo as Angulo)) {
    throw new CustomError("Ese ángulo de foto no existe", 400);
  }
  if (!publicId?.trim()) throw new CustomError("Falta la foto", 400);

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const hoy = new Date().toDateString();
  const deHoy = user.progressPhotos.find(
    (f) => f.angulo === angulo && f.createdAt.toDateString() === hoy,
  );
  if (deHoy) {
    await borrarFoto(deHoy.publicId).catch(() => undefined);
    user.progressPhotos = user.progressPhotos.filter((f) => f.publicId !== deHoy.publicId);
  }

  user.progressPhotos.push({
    angulo: angulo as Angulo,
    publicId: publicId.trim(),
    createdAt: new Date(),
  });

  // Con una foto ya cuenta: pedirle las tres para dejarla entrar sería
  // convertir un recordatorio útil en un peaje.
  user.onboarding.photosUploaded = true;
  if (user.onboarding.videoSeen && !user.onboarding.completedAt) {
    user.onboarding.completedAt = new Date();
  }

  await user.save();
  return armarEstado(user);
}

/** Quita la foto más reciente de un ángulo — la que acaba de subir. */
export async function quitarFoto(userId: string, angulo: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const delAngulo = user.progressPhotos
    .filter((f) => f.angulo === angulo)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const foto = delAngulo[0];

  if (foto) {
    await borrarFoto(foto.publicId).catch(() => undefined);
    user.progressPhotos = user.progressPhotos.filter((f) => f.publicId !== foto.publicId);
  }
  user.onboarding.photosUploaded = user.progressPhotos.length > 0;

  await user.save();
  return armarEstado(user);
}

/**
 * "Completar luego".
 *
 * No es lo mismo que terminarlo, y se guarda distinto: el acceso se abre igual
 * —ya pagó, no se le retiene nada— pero queda el registro de que las fotos
 * siguen pendientes.
 */
export async function saltar(userId: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  user.onboarding.skipped = true;
  await user.save();
  return armarEstado(user);
}

/** Volver a abrirlo desde su cuenta, si lo saltó y ahora sí quiere hacerlo. */
export async function reabrir(userId: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  user.onboarding.skipped = false;
  user.onboarding.completedAt = null;
  await user.save();
  return armarEstado(user);
}


/* ─────────────── Medidas ─────────────── */

/** Rangos de cordura. No son un juicio: atajan el dedo que resbala en el teclado. */
const LIMITES: Record<string, [number, number]> = {
  pesoKg: [25, 300],
  cinturaCm: [30, 250],
  caderaCm: [30, 250],
  pechoCm: [30, 250],
  brazoCm: [10, 100],
  piernaCm: [20, 150],
};

/**
 * Un campo que ella dejó en blanco vale null, no cero.
 *
 * La diferencia importa: cero kilos en la gráfica dibuja un desplome que nunca
 * pasó. Si no lo midió, no hay dato — y el histórico lo dibuja como hueco.
 */
function numeroOpcional(valor: unknown, campo: string): number | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!Number.isFinite(n)) throw new CustomError(`Revisa el valor de ${campo}`, 400);

  const [min, max] = LIMITES[campo]!;
  if (n < min || n > max) {
    throw new CustomError(`Ese valor de ${campo} no parece correcto`, 400);
  }
  // Un decimal: la cinta métrica no da para más y evita "72.4000000001".
  return Math.round(n * 10) / 10;
}

export interface EntradaMedidas {
  pesoKg?: unknown;
  cinturaCm?: unknown;
  caderaCm?: unknown;
  pechoCm?: unknown;
  brazoCm?: unknown;
  piernaCm?: unknown;
  nota?: unknown;
}

/**
 * Guarda la toma de medidas de hoy.
 *
 * Como con las fotos, una segunda toma el mismo día reemplaza a la primera:
 * eso no es un dato nuevo, es que se equivocó al escribirlo. El histórico de
 * los días anteriores no se toca nunca.
 */
export async function guardarMedidas(
  userId: string,
  entrada: EntradaMedidas,
): Promise<EstadoOnboarding> {
  await requireDb();

  const medida = {
    pesoKg: numeroOpcional(entrada.pesoKg, "pesoKg"),
    cinturaCm: numeroOpcional(entrada.cinturaCm, "cinturaCm"),
    caderaCm: numeroOpcional(entrada.caderaCm, "caderaCm"),
    pechoCm: numeroOpcional(entrada.pechoCm, "pechoCm"),
    brazoCm: numeroOpcional(entrada.brazoCm, "brazoCm"),
    piernaCm: numeroOpcional(entrada.piernaCm, "piernaCm"),
    nota: String(entrada.nota ?? "").trim().slice(0, 300),
    createdAt: new Date(),
  };

  const hayAlgo =
    medida.pesoKg !== null ||
    medida.cinturaCm !== null ||
    medida.caderaCm !== null ||
    medida.pechoCm !== null ||
    medida.brazoCm !== null ||
    medida.piernaCm !== null;
  if (!hayAlgo) throw new CustomError("Escribe al menos una medida", 400);

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const hoy = medida.createdAt.toDateString();
  user.measurements = user.measurements.filter((m) => m.createdAt.toDateString() !== hoy);
  user.measurements.push(medida);

  await user.save();
  return armarEstado(user);
}

/** Quita la toma de una fecha. Se identifica por el día, que es como ella la ve. */
export async function quitarMedidas(userId: string, fechaIso: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const objetivo = new Date(fechaIso);
  if (Number.isNaN(objetivo.getTime())) throw new CustomError("Fecha no válida", 400);

  const dia = objetivo.toDateString();
  user.measurements = user.measurements.filter((m) => m.createdAt.toDateString() !== dia);

  await user.save();
  return armarEstado(user);
}
