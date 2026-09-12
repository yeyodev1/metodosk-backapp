import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Course } from "../models/Course";

/**
 * Deja un curso listo para abrirse solo, a la hora acordada.
 *
 * El material se carga con días de anticipación y el curso queda publicado,
 * pero la alumna no lo ve hasta la fecha: nadie tiene que estar despierto
 * apretando un botón a medianoche, y si algo falla se descubre antes y no
 * con noventa personas esperando.
 *
 * La hora se escribe en la de Ecuador (UTC-5), que es la que usa el reto.
 *
 *   npm run programar-curso -- entrenamiento "2026-09-14 00:00"
 *   npm run programar-curso -- entrenamiento ya        (lo abre ahora)
 *   npm run programar-curso -- --ver                   (solo muestra)
 */
const ZONA = "-05:00";

const fmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "—";

async function main() {
  const args = process.argv.slice(2);
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const cursos = await Course.find().sort({ order: 1 });

  if (!args.length || args[0] === "--ver") {
    console.log("curso                      estado         se abre");
    for (const c of cursos) {
      console.log(
        `${c.slug.padEnd(26)} ${c.status.padEnd(14)} ${
          c.publicarEl ? fmt(c.publicarEl) : c.status === "publicado" ? "ya está abierto" : "sin fecha"
        }`,
      );
    }
    await mongoose.disconnect();
    return;
  }

  const [slug, cuando] = args;
  const curso = cursos.find((c) => c.slug === slug);
  if (!curso) throw new Error(`No existe el curso "${slug}"`);
  if (!cuando) throw new Error('Falta la fecha: "2026-09-14 00:00" o "ya"');

  if (cuando === "ya") {
    curso.publicarEl = null;
    curso.status = "publicado";
  } else {
    const fecha = new Date(cuando.replace(" ", "T") + ZONA);
    if (Number.isNaN(fecha.getTime())) {
      throw new Error(`No entendí la fecha "${cuando}". Usa: "2026-09-14 00:00"`);
    }
    curso.publicarEl = fecha;
    // Publicado pero con fecha: el material queda listo y la puerta cerrada.
    curso.status = "publicado";
  }

  await curso.save();
  console.log(
    `${curso.title} (${curso.slug}) → ${
      curso.publicarEl ? `se abre el ${fmt(curso.publicarEl)}` : "abierto desde ya"
    }`,
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
