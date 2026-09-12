import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Course } from "../models/Course";
import { estadoVideo } from "../services/bunny.service";

/**
 * Publica un video que ya está en Bunny dentro de un curso de la ruta.
 *
 * Existe porque el video se subió desde la terminal —92 MB no pasan por una
 * función de Vercel— y el panel solo sabe adjuntar lo que él mismo subió.
 *
 *   npm run publicar-video -- <slug> <bunnyId> "Título del video"
 */
async function main() {
  const [slug, bunnyId, titulo] = process.argv.slice(2);
  if (!slug || !bunnyId) throw new Error("Uso: publicar-video slug bunnyId [título]");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const curso = await Course.findOne({ slug });
  if (!curso) throw new Error(`No existe el curso ${slug}`);

  const estado = await estadoVideo(bunnyId);
  if (estado.status !== "listo") {
    throw new Error(`El video todavía no está listo en Bunny (${estado.status})`);
  }

  curso.welcomeVideo = {
    bunnyId,
    title: titulo || curso.title,
    status: "listo",
    durationSeconds: estado.durationSeconds,
    thumbnail: estado.thumbnail,
  };
  // Sin esto el curso se ve como "próximamente" y el video no se reproduce.
  curso.status = "publicado";
  await curso.save();

  console.log(
    `${curso.title} (${curso.slug}) · publicado · video ${bunnyId} · ${estado.durationSeconds}s`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
