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

/**
 * Qué peso usar, lo escribió Scarlet.
 *
 * Va dentro de "Qué necesitas" y no en otra pantalla: la pregunta aparece
 * justo cuando la alumna está viendo con qué va a entrenar.
 */
const NOTA_PESOS = {
  titulo: "¿Qué peso debo utilizar?",
  cuerpo: [
    "Principiante: utiliza un peso que te permita realizar todas las repeticiones con buena técnica y control. Las últimas repeticiones deben sentirse desafiantes, pero sin perder la correcta ejecución.",
    "Intermedio: elige un peso que haga que las últimas repeticiones sean difíciles, manteniendo siempre una buena técnica.",
    "Avanzado: trabaja con un peso que te exija al máximo según las repeticiones indicadas, sin comprometer la técnica.",
    "Recuerda: no existe un peso exacto para cada nivel. El peso ideal depende de tu fuerza, tu experiencia y del ejercicio que estés haciendo.",
    "Si puedes terminar todas las repeticiones fácilmente, probablemente es momento de aumentar el peso. Si no puedes completarlas con buena técnica, disminúyelo.",
  ],
};

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
  const porReto: Array<{
    clave: string;
    slug: string;
    challenge: "recomposicion" | "volumen";
    reto: string;
    foto: string;
  }> = [
    {
      clave: "necesitas-recomposicion",
      slug: "que-necesitas-recomposicion",
      challenge: "recomposicion",
      reto: "SK Recomposición",
      foto: "https://res.cloudinary.com/kr8lmvcf/image/upload/c_fill,g_auto,w_720,q_auto,f_auto/metodosk/cursos/que-necesitas-volumen",
    },
    {
      clave: "necesitas-volumen",
      slug: "que-necesitas-volumen",
      challenge: "volumen",
      reto: "SK Volumen",
      // URL completa: vive en la cuenta de las alumnas, no en la del shoot.
      foto: "https://res.cloudinary.com/kr8lmvcf/image/upload/c_fill,g_auto,w_720,q_auto,f_auto/metodosk/cursos/que-necesitas-volumen",
    },
  ];

  for (const { clave, slug, challenge, reto, foto } of porReto) {
    const subido = subidos[clave];
    if (!subido) {
      console.log(`— falta el video ${clave}, se salta`);
      continue;
    }

    const curso =
      (await Course.findOne({ slug })) ??
      new Course({ slug, challenge, coverPhoto: foto });

    // El reto va en el título y no en una etiqueta: dos cursos con el mismo
    // nombre, distinguidos por un chip pequeño, se leen como un duplicado.
    curso.title = `Qué necesitas · ${reto}`;
    curso.summary = "Lo que hay que tener listo antes del primer día. Dura un minuto.";
    curso.challenge = challenge;
    curso.order = 1;
    curso.unlockMonth = 1;
    curso.coverPhoto = foto;
    curso.welcomeVideo = await videoDe(subido);
    curso.notas = [NOTA_PESOS];
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

  /* ── "La comunidad" es una puerta al muro, no un curso con videos ── */
  const comunidad = await Course.findOne({ slug: "comunidad" });
  if (comunidad) {
    comunidad.enlace = "/comunidad";
    comunidad.summary = "El muro de todas las que están haciendo el reto. Preséntate y cuenta cómo vas.";
    comunidad.status = "publicado";
    comunidad.publicarEl = null;
    await comunidad.save();
    console.log("✓ La comunidad · lleva al muro");
  }

  /* ── El orden de la ruta: "qué necesitas" va primero ── */
  const despues = ["movilidad", "entrenamiento", "nutricion", "masterclasses", "comunidad"];
  for (const [posicion, slug] of despues.entries()) {
    const curso = await Course.findOne({ slug });
    if (curso) {
      curso.order = posicion + 2;
      await curso.save();
    }
  }

  /*
   * "La guía del Método SK" deja de ser un curso: la guía ahora es su propia
   * sección en el menú, con el menú de la semana y las tablas. Dejarla como
   * curso vacío prometía un material que ya está en otro lado. Se esconde, no
   * se borra: si algún día se le sube material propio, vuelve con un cambio.
   */
  const guia = await Course.findOne({ slug: "guia" });
  if (guia && guia.status !== "borrador") {
    guia.status = "borrador";
    await guia.save();
    console.log("— \"La guía del Método SK\" se esconde: ya vive en su propia sección");
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
