import crypto from "crypto";
import { CustomError } from "../errors/customError.error";

/**
 * Cloudinary para las fotos de avance.
 *
 * El archivo sube directo del navegador a Cloudinary; el servidor solo firma.
 * El secreto se queda acá: con él, cualquiera podría borrar o listar la
 * biblioteca entera.
 *
 * Se suben como `authenticated`, no públicas. Son fotos del cuerpo de una
 * alumna: una URL pública, aunque tenga un id imposible de adivinar, se puede
 * reenviar y queda accesible para siempre. Así, ver una foto exige una firma
 * que solo este servidor sabe construir.
 */

interface Config {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function cloudinaryConfig(): Config | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

function requireCloudinary(): Config {
  const config = cloudinaryConfig();
  if (!config) {
    throw new CustomError(
      "Falta configurar Cloudinary. Se necesitan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.",
      503,
    );
  }
  return config;
}

/** Cloudinary firma el sha1 de los parámetros ordenados más el secreto. */
function firmar(params: Record<string, string | number>, apiSecret: string): string {
  const cadena = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(cadena + apiSecret).digest("hex");
}

export interface SubidaFirmada {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  folder: string;
  type: "authenticated";
}

/**
 * Prepara la subida de una foto.
 *
 * Cada alumna tiene su carpeta y cada foto un id irrepetible: dos tomas del
 * mismo ángulo no se pisan, así se puede comparar el mes 1 con el mes 3.
 */
export function firmarSubidaFoto(userId: string, angulo: string): SubidaFirmada {
  const config = requireCloudinary();

  const folder = `metodosk/alumnas/${userId}`;
  const publicId = `${angulo}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);

  const params = { folder, public_id: publicId, timestamp, type: "authenticated" };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    signature: firmar(params, config.apiSecret),
    publicId,
    folder,
    type: "authenticated",
  };
}

/**
 * URL firmada para ver una foto privada.
 *
 * Sin la firma, Cloudinary devuelve 401. La construye este servidor con el
 * secreto, así que un enlace reenviado no sirve fuera de acá.
 */
export function urlFirmada(publicId: string, ancho = 800): string {
  const config = requireCloudinary();

  const transformacion = `c_limit,w_${ancho},q_auto,f_auto`;
  const aFirmar = `${transformacion}/${publicId}`;
  const firma = crypto
    .createHash("sha1")
    .update(aFirmar + config.apiSecret)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 8);

  return `https://res.cloudinary.com/${config.cloudName}/image/authenticated/s--${firma}--/${transformacion}/${publicId}`;
}

/** Borrar de verdad: una imagen que ella quita no se queda en el servidor. */
export async function borrarImagen(
  publicId: string,
  type: "authenticated" | "upload" = "authenticated",
): Promise<void> {
  const config = requireCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = firmar({ public_id: publicId, timestamp, type }, config.apiSecret);

  const cuerpo = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    type,
    api_key: config.apiKey,
    signature,
  });

  const respuesta = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
    { method: "POST", body: cuerpo },
  );

  if (!respuesta.ok) {
    console.error("[cloudinary] no se pudo borrar", publicId, respuesta.status);
  }
}

/** Las fotos de avance, que son las privadas. */
export async function borrarFoto(publicId: string): Promise<void> {
  return borrarImagen(publicId, "authenticated");
}

/* ─────────────── Foto de perfil de la comunidad ─────────────── */

export interface SubidaAvatarFirmada {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  folder: string;
  /** Recortada a cuadrado y a la cara desde el propio Cloudinary. */
  transformation: string;
}

/**
 * Prepara la subida de la foto de perfil.
 *
 * A diferencia de las de avance, esta se sube **pública**: la ve el resto de
 * la comunidad en cada mensaje, y firmar cada avatar de cada mensaje del muro
 * significaría recalcular decenas de firmas en cada carga. Es además la foto
 * que ella elige mostrar, no una que se le pidió.
 *
 * El id lleva un sufijo aleatorio en vez de ser fijo por cuenta: con un id
 * fijo, cambiar de foto deja la anterior cacheada en el CDN durante horas.
 */
export function firmarSubidaAvatar(userId: string): SubidaAvatarFirmada {
  const config = requireCloudinary();

  const folder = "metodosk/avatares";
  const publicId = `${userId}-${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);
  // Se recorta al subir, no al mostrar: así no viaja un JPG de 5 MB para
  // pintarse a 96 px en el muro.
  const transformation = "c_fill,g_face,w_400,h_400,q_auto";

  const params = { folder, public_id: publicId, timestamp, transformation };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    apiKey: config.apiKey,
    timestamp,
    signature: firmar(params, config.apiSecret),
    publicId,
    folder,
    transformation,
  };
}

/** URL pública del avatar, ya recortado al tamaño en que se pinta. */
export function urlAvatar(publicId: string | null, lado = 96): string | null {
  if (!publicId) return null;
  const config = cloudinaryConfig();
  if (!config) return null;
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/c_fill,g_face,w_${lado},h_${lado},q_auto,f_auto/${publicId}`;
}

/* ─────────────── Guías del método (PDF) ─────────────── */

/**
 * La subida de una guía.
 *
 * Va como `authenticated`, igual que las fotos de avance: el PDF nunca tiene
 * una URL pública. La alumna no recibe el archivo sino sus páginas sueltas, en
 * imagen y con su correo encima, para que un reenvío se pueda rastrear.
 *
 * Sube el navegador directo a Cloudinary y el servidor solo firma: son 50 MB
 * y no caben en una función de Vercel.
 */
export function firmarSubidaGuia(slug: string, audiencia: string): SubidaFirmada {
  const config = requireCloudinary();

  const folder = "metodosk/guias";
  const publicId = `${slug}-${audiencia}-${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);

  const params = { folder, public_id: publicId, timestamp, type: "authenticated" };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    signature: firmar(params, config.apiSecret),
    publicId,
    folder,
    type: "authenticated",
  };
}

/**
 * Una página de la guía, en imagen y firmada, con el correo de la alumna.
 *
 * `pg_N` le pide a Cloudinary que renderice esa página del PDF; el archivo
 * entero nunca sale de ahí. La marca de agua se pone al entregar y no al
 * subir: así una sola copia del PDF sirve para todas, y cada quien recibe la
 * suya marcada.
 *
 * La firma la construye este servidor con el secreto, así que la URL no se
 * puede fabricar desde fuera. Sí se puede reenviar una vez emitida —Cloudinary
 * no caduca estas firmas sin token de pago—, y por eso la marca importa: lo
 * que se reparta lleva el nombre de quien lo repartió.
 */
export function urlPaginaGuia(
  publicId: string,
  pagina: number,
  marca: string,
  ancho = 1400,
): string {
  const config = requireCloudinary();

  // La coma y la barra parten la transformación: se limpian antes de firmar.
  const texto = encodeURIComponent(marca.replace(/[,/]/g, " ").slice(0, 60));
  const transformacion = [
    `pg_${Math.max(1, Math.floor(pagina))},c_limit,w_${ancho},q_auto:good,f_jpg`,
    `l_text:Arial_32_bold:${texto},co_rgb:191413,o_22,g_south_east,x_28,y_28`,
    "fl_layer_apply",
  ].join("/");

  const firma = crypto
    .createHash("sha1")
    .update(`${transformacion}/${publicId}` + config.apiSecret)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 8);

  return `https://res.cloudinary.com/${config.cloudName}/image/authenticated/s--${firma}--/${transformacion}/${publicId}`;
}
