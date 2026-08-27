import crypto from "crypto";
import { CustomError } from "../errors/customError.error";

/**
 * Bunny Stream — el video del método.
 *
 * El archivo nunca pasa por nuestro servidor. Se crea el video en Bunny, se
 * firma una subida temporal y el navegador sube directo contra Bunny: un
 * archivo de clase pesa cientos de megas y la función de Vercel se corta muy
 * por debajo de eso.
 *
 * La API key se queda acá. Si llegara al navegador, cualquiera podría borrar
 * la librería entera de videos.
 */

const API = "https://video.bunnycdn.com";

interface Config {
  apiKey: string;
  libraryId: string;
  /** Hostname del pull zone, p. ej. vz-xxxx.b-cdn.net */
  cdnHostname: string;
  /** Clave de token authentication, si la librería la tiene activada. */
  tokenKey: string | null;
}

/** Falta configuración → se dice qué falta, no "algo salió mal". */
export function bunnyConfig(): Config | null {
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;

  if (!apiKey || !libraryId || !cdnHostname) return null;

  return {
    apiKey,
    libraryId,
    cdnHostname: cdnHostname.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    tokenKey: process.env.BUNNY_STREAM_TOKEN_KEY || null,
  };
}

export function requireBunny(): Config {
  const config = bunnyConfig();
  if (!config) {
    throw new CustomError(
      "Falta configurar Bunny Stream. Se necesitan BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID y BUNNY_STREAM_CDN_HOSTNAME.",
      503,
    );
  }
  return config;
}

async function bunnyFetch(path: string, init: RequestInit = {}): Promise<any> {
  const config = requireBunny();
  const respuesta = await fetch(`${API}/library/${config.libraryId}${path}`, {
    ...init,
    headers: {
      AccessKey: config.apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    console.error(`[bunny] ${path} → ${respuesta.status}`, detalle.slice(0, 300));
    throw new CustomError("Bunny rechazó la operación. Revisa la librería y la key.", 502);
  }

  if (respuesta.status === 204) return null;
  return respuesta.json();
}

/**
 * Crea el video vacío y devuelve lo que el navegador necesita para subirlo.
 *
 * La firma caduca: es para esta subida y nada más. Si se filtrara, no sirve
 * para tocar el resto de la librería.
 */
export async function crearSubida(titulo: string): Promise<{
  videoId: string;
  libraryId: string;
  uploadUrl: string;
  signature: string;
  expiration: number;
}> {
  const config = requireBunny();
  const video = await bunnyFetch("/videos", {
    method: "POST",
    body: JSON.stringify({ title: titulo }),
  });

  const videoId: string = video.guid;
  // Una hora alcanza de sobra para una clase, y limita la ventana si se filtra.
  const expiration = Math.floor(Date.now() / 1000) + 3600;
  const signature = crypto
    .createHash("sha256")
    .update(config.libraryId + config.apiKey + expiration + videoId)
    .digest("hex");

  return {
    videoId,
    libraryId: config.libraryId,
    uploadUrl: `${API}/tusupload`,
    signature,
    expiration,
  };
}

/** Estado del procesamiento: Bunny tarda en dejar un video reproducible. */
export async function estadoVideo(videoId: string): Promise<{
  status: "subiendo" | "procesando" | "listo" | "error";
  durationSeconds: number | null;
  thumbnail: string | null;
}> {
  const config = requireBunny();
  const video = await bunnyFetch(`/videos/${videoId}`);

  // 0 en cola · 1 procesando · 2 codificando · 3 terminado · 4 resolución lista · 5 falló
  const codigo: number = video.status ?? 0;
  const status =
    codigo === 5 ? "error" : codigo >= 3 ? "listo" : codigo === 0 ? "subiendo" : "procesando";

  return {
    status,
    durationSeconds: video.length || null,
    thumbnail: video.thumbnailFileName
      ? `https://${config.cdnHostname}/${videoId}/${video.thumbnailFileName}`
      : null,
  };
}

export async function borrarVideo(videoId: string): Promise<void> {
  await bunnyFetch(`/videos/${videoId}`, { method: "DELETE" });
}

/**
 * URL de reproducción para una alumna.
 *
 * Con token authentication activado en la librería, el enlace caduca y no se
 * puede pasar por WhatsApp: es lo único que separa el material vendido de un
 * enlace que circula gratis.
 */
export function urlReproduccion(videoId: string, horas = 6): string {
  const config = requireBunny();
  const base = `https://${config.cdnHostname}/${videoId}/playlist.m3u8`;

  if (!config.tokenKey) return base;

  const expira = Math.floor(Date.now() / 1000) + horas * 3600;
  const ruta = `/${videoId}/playlist.m3u8`;
  const token = crypto
    .createHash("sha256")
    .update(config.tokenKey + ruta + expira)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${base}?token=${token}&expires=${expira}`;
}

/**
 * El reproductor embebido de Bunny, para no montar un player propio.
 *
 * `desde` retoma la reproducción en el segundo indicado — así una clase de 40
 * minutos no obliga a buscar a mano dónde se quedó.
 */
export function urlEmbed(videoId: string, desde = 0): string {
  const config = requireBunny();
  const base = `https://player.mediadelivery.net/embed/${config.libraryId}/${videoId}`;
  return desde > 5 ? `${base}?t=${Math.floor(desde)}s` : base;
}
