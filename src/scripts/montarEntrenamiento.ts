import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import { readFileSync } from "fs";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Course } from "../models/Course";
import { estadoVideo } from "../services/bunny.service";

/**
 * "Tu entrenamiento", un curso por reto y una clase por día.
 *
 * Los días se numeran en el título porque es una rutina: el martes va después
 * del lunes y eso no es decoración, es el orden en que hay que hacerlo.
 *
 * El bloque del lunes es el mismo para los dos retos —así vino el archivo, sin
 * apellido— y el del martes cambia según el plan. Por eso el curso se parte en
 * dos: mandarle a la de volumen el martes de recomposición sería darle el
 * entrenamiento contrario al que compró.
 *
 * Es idempotente: las clases se buscan por título, así que correrlo otra vez
 * cuando lleguen miércoles y jueves no duplica lo que ya está.
 *
 *   npm run montar-entrenamiento -- /ruta/entrenamiento-bunny.json
 */
interface VideoSubido {
  guid: string;
  titulo: string;
  segundos: number;
}

/** Qué día va en qué curso. La clave es la del JSON de subida. */
const PLAN: Array<{
  slug: string;
  challenge: "recomposicion" | "volumen";
  reto: string;
  foto: string;
  /**
   * `pendiente` es un día que existe en la semana pero todavía no tiene video:
   * se muestra en gris, en su lugar, para que la alumna vea la semana completa
   * y sepa que ese día viene, en vez de encontrarse un hueco entre martes y
   * viernes.
   */
  dias: Array<{ clave: string; titulo: string; resumen: string; pendiente?: boolean }>;
}> = [
  {
    slug: "entrenamiento-recomposicion",
    challenge: "recomposicion",
    reto: "SK Recomposición",
    foto: "metodosk/sk-08",
    dias: [
      { clave: "lunes-bloque-1", titulo: "Lunes · Bloque 1", resumen: "El primero de la semana. Sigue el video de principio a fin." },
      { clave: "martes-bloque-1-recomposicion", titulo: "Martes · Bloque 1", resumen: "Tu segundo día. Es el de recomposición: no es el mismo que el de volumen." },
      { clave: "miercoles-bloque-1", titulo: "Miércoles · Bloque 1", resumen: "Tercer día de la semana." },
      { clave: "jueves-bloque-1", titulo: "Jueves · Bloque 1", resumen: "Se publica pronto.", pendiente: true },
      { clave: "viernes-bloque-1", titulo: "Viernes · Bloque 1", resumen: "Cierra la semana." },
    ],
  },
  {
    slug: "entrenamiento-volumen",
    challenge: "volumen",
    reto: "SK Volumen",
    foto: "metodosk/sk-08",
    dias: [
      { clave: "lunes-bloque-1", titulo: "Lunes · Bloque 1", resumen: "El primero de la semana. Sigue el video de principio a fin." },
      { clave: "martes-bloque-1-volumen", titulo: "Martes · Bloque 1", resumen: "Tu segundo día. Es el de volumen: no es el mismo que el de recomposición." },
      { clave: "miercoles-bloque-1", titulo: "Miércoles · Bloque 1", resumen: "Tercer día de la semana." },
      { clave: "jueves-bloque-1", titulo: "Jueves · Bloque 1", resumen: "Se publica pronto.", pendiente: true },
      { clave: "viernes-bloque-1", titulo: "Viernes · Bloque 1", resumen: "Cierra la semana." },
    ],
  },
];

async function videoDe(subido: VideoSubido) {
  const estado = await estadoVideo(subido.guid);
  if (estado.status !== "listo") {
    throw new Error(`"${subido.titulo}" todavía no está listo en Bunny (${estado.status})`);
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
  const ruta = process.argv[2];
  if (!ruta) throw new Error("Uso: montar-entrenamiento /ruta/entrenamiento-bunny.json");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const subidos = JSON.parse(readFileSync(ruta, "utf-8")) as Record<string, VideoSubido>;

  for (const { slug, challenge, reto, foto, dias } of PLAN) {
    // Entra lo que ya tiene video y lo que está anunciado como pendiente.
    const disponibles = dias.filter((d) => d.pendiente || subidos[d.clave]);
    if (!disponibles.length) {
      console.log(`— ${reto}: todavía no hay ningún día subido, se salta`);
      continue;
    }

    const curso =
      (await Course.findOne({ slug })) ?? new Course({ slug, challenge, coverPhoto: foto });

    curso.title = `Tu entrenamiento · ${reto}`;
    curso.summary = "Tu rutina, día por día. Cada bloque es una sesión completa.";
    curso.challenge = challenge;
    curso.order = 3;
    curso.unlockMonth = 1;
    curso.coverPhoto = curso.coverPhoto || foto;
    curso.status = "publicado";
    curso.publicarEl = null;

    let orden = 1;
    for (const dia of disponibles) {
      // Sin video todavía: la clase queda en su lugar y en gris.
      const video = subidos[dia.clave] ? await videoDe(subidos[dia.clave]!) : null;
      const existente = curso.lessons.find((l) => l.title === dia.titulo);
      if (existente) {
        existente.video = video;
        existente.summary = dia.resumen;
        existente.order = orden;
      } else {
        curso.lessons.push({
          title: dia.titulo,
          summary: dia.resumen,
          order: orden,
          video,
          fileUrl: null,
        });
      }
      orden++;
    }

    await curso.save();
    console.log(
      `✓ ${curso.title}: ${disponibles
        .map((d) => (subidos[d.clave] ? d.titulo : `${d.titulo} (en gris)`))
        .join(", ")}`,
    );
  }

  /*
   * El curso viejo y compartido deja de mostrarse: su contenido ahora vive en
   * los dos por reto. Se esconde y no se borra, por si hubiera que volver.
   */
  const viejo = await Course.findOne({ slug: "entrenamiento" });
  if (viejo && viejo.status !== "borrador") {
    viejo.status = "borrador";
    await viejo.save();
    console.log("— el \"Tu entrenamiento\" compartido se esconde: ahora hay uno por reto");
  }

  console.log("\nLa ruta quedó así:");
  for (const c of await Course.find({ status: { $ne: "borrador" } }).sort({ order: 1 })) {
    const videos = (c.welcomeVideo ? 1 : 0) + c.lessons.filter((l) => l.video).length;
    console.log(
      `  ${String(c.order).padStart(2)} ${c.title.padEnd(34)} ${c.challenge.padEnd(14)} ${String(videos).padStart(2)} video(s)`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
