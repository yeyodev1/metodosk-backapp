import { Setting, CLAVE_VSL, type VslGuardado } from "../models/Setting";
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

async function leerVsl(): Promise<VslGuardado | null> {
  const guardado = await Setting.findOne({ key: CLAVE_VSL }).lean();
  return (guardado?.value as VslGuardado) || null;
}

/**
 * El VSL para quien acaba de comprar.
 *
 * No pide sesión: se reproduce en la pantalla de resultado del pago, cuando
 * todavía no hay cuenta creada. Es un video de venta, no material del reto.
 *
 * Devuelve null en vez de fallar si no hay video: la pantalla de compra tiene
 * que seguir funcionando aunque nadie haya subido el VSL todavía.
 */
export async function vslPublico(): Promise<{
  embedUrl: string;
  durationSeconds: number | null;
  thumbnail: string | null;
} | null> {
  if (!isConnected() && !(await dbConnect())) return null;
  if (!bunnyConfig()) return null;

  try {
    const vsl = await leerVsl();
    if (!vsl?.bunnyId || vsl.status !== "listo") return null;

    return {
      embedUrl: urlEmbed(vsl.bunnyId),
      durationSeconds: vsl.durationSeconds,
      thumbnail: vsl.thumbnail,
    };
  } catch (error) {
    console.error("[vsl] no se pudo leer:", error);
    return null;
  }
}

/* ─────────────── Administración ─────────────── */

export async function vslAdmin() {
  await requireDb();
  const vsl = await leerVsl();
  return { vsl, bunnyListo: Boolean(bunnyConfig()) };
}

export async function prepararVsl(titulo: string) {
  await requireDb();

  const anterior = await leerVsl();
  // Solo hay un video de bienvenida: el anterior deja de pagarse.
  if (anterior?.bunnyId) await borrarVideo(anterior.bunnyId).catch(() => undefined);

  const subida = await crearSubida(titulo || "Video de bienvenida — Método SK");
  const valor: VslGuardado = {
    bunnyId: subida.videoId,
    status: "subiendo",
    durationSeconds: null,
    thumbnail: null,
  };

  await Setting.findOneAndUpdate(
    { key: CLAVE_VSL },
    { key: CLAVE_VSL, value: valor },
    { upsert: true },
  );

  return subida;
}

/** Bunny transcodifica en background: esto pregunta si ya se puede ver. */
export async function refrescarVsl() {
  await requireDb();
  const vsl = await leerVsl();
  if (!vsl?.bunnyId) throw new CustomError("Todavía no hay video de bienvenida", 404);

  const estado = await estadoVideo(vsl.bunnyId);
  const valor: VslGuardado = { ...vsl, ...estado };
  await Setting.findOneAndUpdate({ key: CLAVE_VSL }, { value: valor });

  return valor;
}

export async function borrarVsl() {
  await requireDb();
  const vsl = await leerVsl();
  if (vsl?.bunnyId) await borrarVideo(vsl.bunnyId).catch(() => undefined);
  await Setting.deleteOne({ key: CLAVE_VSL });
  return { ok: true };
}
