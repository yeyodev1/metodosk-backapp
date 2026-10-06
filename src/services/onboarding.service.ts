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
 * Cada quince días: es el seguimiento que hace el equipo. La comparación
 * igual es contra la primera foto, no contra la anterior, así que el cambio
 * se ve aunque entre una toma y otra se mueva poco.
 */
export const DIAS_ENTRE_TOMAS = 15;

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
  /** Días que tiene para cambiar una foto ya subida. */
  diasParaCambiar: number;
}

const DIA_MS = 86_400_000;

/**
 * Cuántos días hay para cambiar una foto después de subirla.
 *
 * Hay quien sube cualquier foto para poder entrar a entrenar ese día, y la
 * buena la toma después. Pasado este plazo la foto queda fija: es su histórico.
 */
export const DIAS_PARA_CAMBIAR = 3;

function sePuedeCambiar(createdAt: Date, ahora = new Date()): boolean {
  return ahora.getTime() - createdAt.getTime() < DIAS_PARA_CAMBIAR * DIA_MS;
}

/**
 * Una foto subida hasta estos días antes de la fecha cuenta como la de esa toma.
 * Así quien se adelanta un poco no recibe un "hoy te toca" a la semana.
 */
export const DIAS_ADELANTO = 5;

/**
 * Cuándo toca la siguiente toma.
 *
 * El calendario sale de la primera foto y no se mueve: primera + 30, + 60,
 * + 90. Antes se contaba desde la más reciente, y subir una foto antes de
 * tiempo corría todo el calendario (subió el 1 en vez del 10 y la siguiente
 * pasaba al 31).
 */
export function calcularProximaToma(
  fotos: Array<{ createdAt: Date }>,
): Date | null {
  if (!fotos.length) return null;

  const tiempos = fotos.map((f) => f.createdAt.getTime());
  const primera = Math.min(...tiempos);
  const ultima = Math.max(...tiempos);
  const periodo = DIAS_ENTRE_TOMAS * DIA_MS;

  // El mes que cubre la última foto, contando el adelanto permitido.
  const cubierto = Math.floor((ultima - primera + DIAS_ADELANTO * DIA_MS) / periodo);
  return new Date(primera + (cubierto + 1) * periodo);
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

  const ahora = new Date();
  const proximaToma = calcularProximaToma(fotos);
  // Días enteros hacia arriba: faltando 20 horas se dice "1 día", no "0".
  const diasParaProxima = proximaToma
    ? Math.max(0, Math.ceil((proximaToma.getTime() - ahora.getTime()) / 86_400_000))
    : null;

  return {
    videoSeen: onboarding.videoSeen,
    photosUploaded: onboarding.photosUploaded,
    skipped: onboarding.skipped,
    completedAt: onboarding.completedAt ? onboarding.completedAt.toISOString() : null,
    // Las fotos de partida ya no se pueden saltar: sin frente y espalda no hay
    // seguimiento posible, y "Completar luego" terminaba siendo nunca. Si
    // Cloudinary falla no se bloquea a nadie: no es culpa de ella.
    done: !hayCloudinary || ANGULOS_PEDIDOS.every((a) => fotos.some((f) => f.angulo === a)),
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
    diasParaCambiar: DIAS_PARA_CAMBIAR,
  };
}

export function mapaMedida(m: InstanceType<typeof User>["measurements"][number]): Medida {
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
export function armarComparativa(
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
 * Lo único que se reemplaza es una foto del mismo ángulo subida hace menos de
 * `DIAS_PARA_CAMBIAR` días: eso no es una toma nueva, es la misma corregida.
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

  // Si la última de ese ángulo todavía se puede cambiar, esta la reemplaza y
  // conserva su fecha: es la misma toma, y así el calendario no se corre.
  const ultima = user.progressPhotos
    .filter((f) => f.angulo === angulo)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const reemplaza = ultima && sePuedeCambiar(ultima.createdAt) ? ultima : null;
  if (reemplaza) {
    await borrarFoto(reemplaza.publicId).catch(() => undefined);
    user.progressPhotos = user.progressPhotos.filter((f) => f.publicId !== reemplaza.publicId);
  }

  user.progressPhotos.push({
    angulo: angulo as Angulo,
    publicId: publicId.trim(),
    createdAt: reemplaza?.createdAt ?? new Date(),
  });

  user.onboarding.photosUploaded = true;
  const tieneTodas = ANGULOS_PEDIDOS.every((a) =>
    user.progressPhotos.some((f) => f.angulo === a),
  );
  if (tieneTodas && !user.onboarding.completedAt) {
    user.onboarding.completedAt = new Date();
  }

  await user.save();
  return armarEstado(user);
}

/** Quita la foto más reciente de un ángulo, si todavía está en plazo de cambio. */
export async function quitarFoto(userId: string, angulo: string): Promise<EstadoOnboarding> {
  await requireDb();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const delAngulo = user.progressPhotos
    .filter((f) => f.angulo === angulo)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const foto = delAngulo[0];

  if (foto && !sePuedeCambiar(foto.createdAt)) {
    throw new CustomError(
      `Esa foto ya no se puede quitar: se cambian hasta ${DIAS_PARA_CAMBIAR} días después de subirlas`,
      400,
    );
  }

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

/** Cómo se nombra cada campo en los errores: "pesoKg" no le dice nada a ella. */
const NOMBRES: Record<string, string> = {
  pesoKg: "peso",
  cinturaCm: "cintura",
  caderaCm: "cadera",
  pechoCm: "pecho",
  brazoCm: "brazo",
  piernaCm: "pierna",
};

const KG_POR_LIBRA = 0.45359237;

/**
 * Un campo que ella dejó en blanco vale null, no cero.
 *
 * La diferencia importa: cero kilos en la gráfica dibuja un desplome que nunca
 * pasó. Si no lo midió, no hay dato — y el histórico lo dibuja como hueco.
 *
 * Se acepta lo que se escribe de verdad: "62,5 kg", "62.5kg", "130 lb". Acá
 * casi todas se pesan en libras, y antes "130 lb" se rechazaba entero y la
 * toma se guardaba sin peso.
 */
function numeroOpcional(valor: unknown, campo: string): number | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const nombre = NOMBRES[campo] ?? campo;
  const texto = String(valor).trim().toLowerCase().replace(",", ".");
  if (!texto) return null;

  const coincide = texto.match(/^(\d+(?:\.\d+)?)\s*([a-z.]*)$/);
  if (!coincide) throw new CustomError(`Revisa el valor de ${nombre}: escribe solo el número`, 400);

  let n = Number(coincide[1]);
  const unidad = coincide[2]!.replace(/\./g, "");
  if (campo === "pesoKg" && ["lb", "lbs", "libra", "libras"].includes(unidad)) {
    n = n * KG_POR_LIBRA;
  } else if (unidad && !["kg", "kgs", "kilo", "kilos", "cm", "cms"].includes(unidad)) {
    throw new CustomError(`Revisa el valor de ${nombre}: escribe solo el número`, 400);
  }
  if (!Number.isFinite(n)) throw new CustomError(`Revisa el valor de ${nombre}`, 400);

  const [min, max] = LIMITES[campo]!;
  if (n < min || n > max) {
    throw new CustomError(`Ese valor de ${nombre} no parece correcto`, 400);
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
