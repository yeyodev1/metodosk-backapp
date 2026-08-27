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

/** Cada cuánto toca repetir las fotos. */
export const DIAS_ENTRE_TOMAS = 14;

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
  /** true cuando ya pasaron las dos semanas. */
  tomaPendiente: boolean;
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
    tomaPendiente: Boolean(proximaToma && proximaToma <= new Date()),
    fotosDisponibles: hayCloudinary,
  };
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
