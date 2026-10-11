import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename } from "path";
import { requireBunny } from "../services/bunny.service";

/**
 * Sube videos grandes a Bunny Stream desde esta máquina.
 *
 * El panel sube desde el navegador, y con un archivo de 5 GB eso es dejar una
 * pestaña abierta una hora rezando que no se duerma la laptop. Acá el archivo
 * va directo de disco a Bunny, sin pasar por nuestro servidor.
 *
 * Anota cada subida en el JSON apenas termina, así que si se corta se vuelve a
 * correr y salta lo que ya subió. Ese JSON es el que después lee
 * `montar-entrenamiento`.
 *
 *   npm run subir-videos -- ../contenido/entrenamiento-bunny.json \
 *     lunes-bloque-2="Lunes · Bloque 2"=~/Downloads/LUNES\ BLOQUE\ 2.mp4 …
 */
interface Subido {
  guid: string;
  titulo: string;
  segundos: number | null;
}

const API = "https://video.bunnycdn.com";

async function crearVideo(titulo: string): Promise<string> {
  const { apiKey, libraryId } = requireBunny();
  const r = await fetch(`${API}/library/${libraryId}/videos`, {
    method: "POST",
    headers: { AccessKey: apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ title: titulo }),
  });
  if (!r.ok) throw new Error(`Bunny no creó "${titulo}": ${r.status} ${await r.text()}`);
  return ((await r.json()) as { guid: string }).guid;
}

async function subirArchivo(guid: string, archivo: string): Promise<void> {
  const { apiKey, libraryId } = requireBunny();
  const tamano = statSync(archivo).size;
  let enviados = 0;
  let ultimo = 0;

  const flujo = createReadStream(archivo, { highWaterMark: 8 * 1024 * 1024 });
  flujo.on("data", (trozo) => {
    enviados += trozo.length;
    const pct = Math.floor((enviados / tamano) * 100);
    if (pct >= ultimo + 10) {
      ultimo = pct - (pct % 10);
      console.log(`   ${basename(archivo)}: ${ultimo}%`);
    }
  });

  const r = await fetch(`${API}/library/${libraryId}/videos/${guid}`, {
    method: "PUT",
    headers: {
      AccessKey: apiKey,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(tamano),
    },
    body: flujo as unknown as BodyInit,
    // Node exige decirlo para mandar un cuerpo en streaming.
    duplex: "half",
  } as RequestInit);
  if (!r.ok) throw new Error(`Bunny rechazó ${basename(archivo)}: ${r.status} ${await r.text()}`);
}

async function main() {
  const [ruta, ...pares] = process.argv.slice(2);
  if (!ruta || !pares.length) {
    throw new Error('Uso: subir-videos /ruta/salida.json clave="Título"=/ruta/al/video.mp4 …');
  }

  const subidos: Record<string, Subido> = existsSync(ruta)
    ? JSON.parse(readFileSync(ruta, "utf-8"))
    : {};

  for (const par of pares) {
    const [clave, titulo, archivo] = par.split("=");
    if (!clave || !titulo || !archivo) throw new Error(`No entiendo "${par}"`);
    if (subidos[clave]) {
      console.log(`— ${clave}: ya estaba subido (${subidos[clave]!.guid}), se salta`);
      continue;
    }
    if (!existsSync(archivo)) throw new Error(`No existe ${archivo}`);

    const gb = (statSync(archivo).size / 1024 ** 3).toFixed(1);
    console.log(`↑ ${clave}: ${basename(archivo)} (${gb} GB)`);
    const guid = await crearVideo(titulo);
    await subirArchivo(guid, archivo);

    // Se anota ya: si el siguiente falla, este no se vuelve a subir.
    subidos[clave] = { guid, titulo, segundos: null };
    writeFileSync(ruta, JSON.stringify(subidos, null, 2) + "\n");
    console.log(`✓ ${clave}: ${guid}`);
  }
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
