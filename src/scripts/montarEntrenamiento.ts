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
 * cuando llegue un bloque nuevo no duplica lo que ya está.
 *
 *   npm run montar-entrenamiento -- /ruta/entrenamiento-bunny.json
 */
interface VideoSubido {
  guid: string;
  titulo: string;
  segundos: number;
}

/**
 * Qué día va en qué curso. La clave es la del JSON de subida.
 *
 * Cada bloque es su propio curso y no más clases en el mismo: el bloque se
 * abre entero en su semana (el 2 en la semana 5, contada desde la compra; ver
 * `config/bloques.ts`) y lo que se abre o se cierra es el curso.
 *
 * En el bloque 2 llegó un solo martes y un solo jueves, sin apellido de reto
 * —los dos son de tren superior—, así que van iguales en los dos cursos.
 */
const PLAN: Array<{
  slug: string;
  challenge: "recomposicion" | "volumen";
  reto: string;
  foto: string;
  bloque: number;
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
    bloque: 1,
    dias: [
      { clave: "lunes-bloque-1", titulo: "Lunes · Bloque 1", resumen: "El primero de la semana. Sigue el video de principio a fin." },
      { clave: "martes-bloque-1-recomposicion", titulo: "Martes · Bloque 1", resumen: "Tu segundo día. Es el de recomposición: no es el mismo que el de volumen." },
      { clave: "miercoles-bloque-1", titulo: "Miércoles · Bloque 1", resumen: "Tercer día de la semana." },
      { clave: "jueves-bloque-1-recomposicion", titulo: "Jueves · Bloque 1", resumen: "Cuarto día. Es el de recomposición: no es el mismo que el de volumen." },
      { clave: "viernes-bloque-1", titulo: "Viernes · Bloque 1", resumen: "Cierra la semana." },
    ],
  },
  {
    slug: "entrenamiento-volumen",
    challenge: "volumen",
    reto: "SK Volumen",
    foto: "metodosk/sk-08",
    bloque: 1,
    dias: [
      { clave: "lunes-bloque-1", titulo: "Lunes · Bloque 1", resumen: "El primero de la semana. Sigue el video de principio a fin." },
      { clave: "martes-bloque-1-volumen", titulo: "Martes · Bloque 1", resumen: "Tu segundo día. Es el de volumen: no es el mismo que el de recomposición." },
      { clave: "miercoles-bloque-1", titulo: "Miércoles · Bloque 1", resumen: "Tercer día de la semana." },
      { clave: "jueves-bloque-1-volumen", titulo: "Jueves · Bloque 1", resumen: "Cuarto día. Es el de volumen: no es el mismo que el de recomposición." },
      { clave: "viernes-bloque-1", titulo: "Viernes · Bloque 1", resumen: "Cierra la semana." },
    ],
  },
  ...(["recomposicion", "volumen"] as const).map((challenge) => ({
    slug: `entrenamiento-bloque-2-${challenge}`,
    challenge,
    reto: challenge === "recomposicion" ? "SK Recomposición" : "SK Volumen",
    foto: "metodosk/sk-08",
    bloque: 2,
    dias: [
      { clave: "lunes-bloque-2", titulo: "Lunes · Bloque 2", resumen: "Empieza el bloque 2: rutinas nuevas para tus semanas 5 a 8." },
      { clave: "martes-bloque-2", titulo: "Martes · Bloque 2", resumen: "Tren superior. Arranca con abdominales para entrar en calor." },
      { clave: "miercoles-bloque-2", titulo: "Miércoles · Bloque 2", resumen: "Tercer día de la semana." },
      { clave: "jueves-bloque-2", titulo: "Jueves · Bloque 2", resumen: "Tren superior. Arranca con abdominales: conecta con tu core." },
      { clave: "viernes-bloque-2", titulo: "Viernes · Bloque 2", resumen: "Cierra la semana." },
    ],
  })),
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

  for (const { slug, challenge, reto, foto, bloque, dias } of PLAN) {
    // Entra lo que ya tiene video y lo que está anunciado como pendiente.
    const disponibles = dias.filter((d) => d.pendiente || subidos[d.clave]);
    if (!disponibles.length) {
      console.log(`— ${reto}: todavía no hay ningún día subido, se salta`);
      continue;
    }

    const curso =
      (await Course.findOne({ slug })) ?? new Course({ slug, challenge, coverPhoto: foto });

    if (bloque === 1) {
      curso.title = `Tu entrenamiento · ${reto}`;
      curso.summary = "Tu rutina, día por día. Cada bloque es una sesión completa.";
    } else {
      curso.title = `Tu entrenamiento · Bloque ${bloque} · ${reto}`;
      curso.summary = `Las rutinas de tus semanas ${(bloque - 1) * 4 + 1} a ${bloque * 4}. Se abre en tu semana ${(bloque - 1) * 4 + 1}, contada desde tu compra.`;
    }
    curso.challenge = challenge;
    // Mismo lugar en la ruta: el bloque decide cuál va primero.
    curso.order = 3;
    curso.unlockMonth = bloque;
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
  for (const c of await Course.find({ status: { $ne: "borrador" } }).sort({ order: 1, unlockMonth: 1 })) {
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
