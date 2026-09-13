import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import { readFileSync } from "fs";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Course } from "../models/Course";
import { estadoVideo } from "../services/bunny.service";

/**
 * Arma la ruta del reto con los videos ya subidos a Bunny.
 *
 * Toma el JSON que deja el script de subida —clave → guid— y engancha cada
 * video donde va. Es idempotente: correrlo dos veces deja lo mismo, así que
 * se puede repetir cuando lleguen más videos sin miedo a duplicar clases.
 *
 * "Qué necesitas" va en dos cursos, uno por reto: el material es distinto y
 * mandarle a la de volumen el de recomposición sería decirle que compre lo
 * que no necesita. Los estiramientos son los mismos para las dos.
 *
 * "Qué necesitas" se abre de inmediato aunque el resto quede programado: dice
 * qué comprar antes de empezar, y estrenarlo a medianoche del primer día es
 * enterarse con las tiendas cerradas. `--abrir` solo afecta al material del
 * reto en sí.
 *
 *   npm run montar-cursos -- /ruta/videos-bunny.json
 *   npm run montar-cursos -- /ruta/videos-bunny.json --abrir "2026-09-14 00:00"
 */
const ZONA = "-05:00";

interface VideoSubido {
  guid: string;
  titulo: string;
  segundos: number;
}

async function videoDe(subido: VideoSubido) {
  const estado = await estadoVideo(subido.guid);
  if (estado.status !== "listo") {
    throw new Error(`El video "${subido.titulo}" todavía no está listo (${estado.status})`);
  }
  return {
    bunnyId: subido.guid,
    title: subido.titulo,
    status: "listo" as const,
    durationSeconds: estado.durationSeconds,
    thumbnail: estado.thumbnail,
  };
}

async function main() {
  const args = process.argv.slice(2);
  // El JSON es el primer argumento suelto; lo que va tras --abrir es la fecha.
  const corte = args.indexOf("--abrir");
  const ruta = (corte >= 0 ? args.slice(0, corte) : args).find((a) => !a.startsWith("--"));
  if (!ruta) throw new Error("Uso: montar-cursos /ruta/videos-bunny.json [--abrir \"2026-09-14 00:00\"]");

  /**
   * La fecha puede llegar partida en dos: la terminal separa "2026-09-14
   * 00:00" en cuanto se pierden las comillas. Se juntan todos los trozos que
   * siguen a --abrir hasta la próxima opción.
   */
  const i = args.indexOf("--abrir");
  const cuando =
    i >= 0
      ? args
          .slice(i + 1)
          .filter((a) => !a.startsWith("--"))
          .join(" ")
          .trim() || null
      : null;
  const publicarEl = cuando ? new Date(cuando.replace(" ", "T") + ZONA) : null;
  if (cuando && Number.isNaN(publicarEl!.getTime())) {
    throw new Error(`No entendí la fecha "${cuando}". Usa: "2026-09-14 00:00"`);
  }

  if (!(await dbConnect())) throw new Error("Sin base de datos");
  const subidos = JSON.parse(readFileSync(ruta, "utf-8")) as Record<string, VideoSubido>;

  /* ── "Qué necesitas", uno por reto ── */
  const porReto: Array<{ clave: string; slug: string; challenge: "recomposicion" | "volumen"; foto: string }> = [
    { clave: "necesitas-recomposicion", slug: "que-necesitas-recomposicion", challenge: "recomposicion", foto: "metodosk/sk-07" },
    { clave: "necesitas-volumen", slug: "que-necesitas-volumen", challenge: "volumen", foto: "metodosk/sk-06" },
  ];

  for (const { clave, slug, challenge, foto } of porReto) {
    const subido = subidos[clave];
    if (!subido) {
      console.log(`— falta el video ${clave}, se salta`);
      continue;
    }

    const curso =
      (await Course.findOne({ slug })) ??
      new Course({ slug, challenge, coverPhoto: foto });

    curso.title = "Qué necesitas para entrenar";
    curso.summary = "Lo que hay que tener listo antes del primer día. Dura un minuto.";
    curso.challenge = challenge;
    curso.order = 1;
    curso.unlockMonth = 1;
    curso.coverPhoto = curso.coverPhoto || foto;
    curso.welcomeVideo = await videoDe(subido);
    curso.status = "publicado";
    // Abierto ya: es lo que hay que comprar antes del primer día.
    curso.publicarEl = null;
    await curso.save();
    console.log(`✓ ${curso.title} (${challenge}) · ${subido.segundos}s · abierto ya`);
  }

  /* ── Los estiramientos, dentro de Movilidad ── */
  const movilidad = await Course.findOne({ slug: "movilidad" });
  if (movilidad) {
    const clases: Array<[string, string, string]> = [
      ["estiramiento-superior", "Estiramiento de tren superior", "Hombros, espalda y brazos."],
      ["estiramiento-inferior", "Estiramiento de tren inferior", "Piernas, glúteo y cadera."],
    ];

    let orden = 1;
    for (const [clave, titulo, resumen] of clases) {
      const subido = subidos[clave];
      if (!subido) {
        console.log(`— falta el video ${clave}, se salta`);
        continue;
      }

      const video = await videoDe(subido);
      // Por título, no por posición: si se vuelve a correr, actualiza la
      // misma clase en vez de agregar una repetida.
      const existente = movilidad.lessons.find((l) => l.title === titulo);
      if (existente) {
        existente.video = video;
        existente.summary = resumen;
        existente.order = orden;
      } else {
        movilidad.lessons.push({ title: titulo, summary: resumen, order: orden, video, fileUrl: null });
      }
      console.log(`✓ ${titulo} · ${subido.segundos}s`);
      orden++;
    }

    movilidad.status = "publicado";
    movilidad.publicarEl = publicarEl;
    await movilidad.save();
    console.log(
      publicarEl
        ? `  Movilidad se abre el ${publicarEl.toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}`
        : "  Movilidad queda abierta ya",
    );
  } else {
    console.log("— no existe el curso movilidad");
  }

  /* ── El orden de la ruta: "qué necesitas" va primero ── */
  const despues = ["entrenamiento", "movilidad", "nutricion", "masterclasses", "guia", "comunidad"];
  for (const [posicion, slug] of despues.entries()) {
    const curso = await Course.findOne({ slug });
    if (curso) {
      curso.order = posicion + 2;
      await curso.save();
    }
  }

  console.log("\nLa ruta quedó así:");
  for (const c of await Course.find().sort({ order: 1 })) {
    const cuando = c.publicarEl
      ? `se abre ${new Date(c.publicarEl).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}`
      : c.status === "publicado"
        ? "abierto"
        : c.status;
    const videos = (c.welcomeVideo ? 1 : 0) + c.lessons.filter((l) => l.video).length;
    console.log(
      `  ${String(c.order).padStart(2)} ${c.title.padEnd(30)} ${c.challenge.padEnd(14)} ${String(videos).padStart(2)} video(s)  ${cuando}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
