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

/** Borrar de verdad: una foto que ella quita no se queda en el servidor. */
export async function borrarFoto(publicId: string): Promise<void> {
  const config = requireCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = firmar({ public_id: publicId, timestamp, type: "authenticated" }, config.apiSecret);

  const cuerpo = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    type: "authenticated",
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
