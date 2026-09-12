import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import { readFileSync } from "fs";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Guia } from "../models/Guia";

/**
 * Carga las guías de nutrición en la base, desde un JSON local.
 *
 * El JSON no se versiona y el contenido no entra al repositorio: los repos
 * son públicos y esto es lo que las alumnas pagaron. Correrlo de nuevo
 * reemplaza la guía del mes anterior.
 *
 *   npm run publicar-guias -- /ruta/al/guias-contenido.json
 */
async function main() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error("Uso: publicar-guias /ruta/al/guias-contenido.json");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const datos = JSON.parse(readFileSync(ruta, "utf-8")) as Record<string, any>;

  for (const [audiencia, contenido] of Object.entries(datos)) {
    if (!["recomposicion", "volumen"].includes(audiencia)) {
      console.warn(`saltada: ${audiencia} no es un reto conocido`);
      continue;
    }
    await Guia.findOneAndUpdate(
      { audiencia },
      { audiencia, contenido },
      { upsert: true, new: true },
    );
    const dias = contenido.dias?.length ?? 0;
    const comidas = (contenido.dias ?? []).reduce(
      (n: number, d: any) => n + (d.comidas?.length ?? 0),
      0,
    );
    const filas = (contenido.tablas ?? []).reduce(
      (n: number, t: any) => n + (t.filas?.length ?? 0),
      0,
    );
    console.log(
      `${audiencia}: ${dias} días · ${comidas} comidas · ${contenido.snacks?.length ?? 0} snacks · ` +
        `${contenido.tablas?.length ?? 0} tablas (${filas} filas)`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
