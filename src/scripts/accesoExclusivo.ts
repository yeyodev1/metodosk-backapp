import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { darAccesoExclusivo } from "../services/accesoExclusivo.service";

/**
 * Acceso exclusivo desde la terminal. Lo mismo que el botón del panel (ver
 * accesoExclusivo.service), pero ojo: el correo solo sale si hay
 * RESEND_API_KEY, y esa en Vercel es secreta y no se descarga.
 *
 *   npm run acceso-exclusivo -- correo1 correo2 ...
 */
async function main() {
  const correos = process.argv.slice(2).filter(Boolean);
  if (!correos.length) throw new Error("Uso: acceso-exclusivo correo1 correo2 ...");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  for (const correo of correos) {
    try {
      const r = await darAccesoExclusivo(correo);
      console.log(
        `${r.email} · retos: ${r.retos.join(", ")} · hasta ${r.accessUntil?.slice(0, 10)}` +
          ` · contraseña: ${r.password ?? "(la que ella ya creó)"}` +
          ` · correo: ${r.correoEnviado ? "enviado" : "NO SALIÓ"}` +
          ` · telegram: ${r.telegramEnCorreo ? "en el correo" : "todavía no"}`,
      );
    } catch (error) {
      console.error(`ERROR con ${correo}:`, (error as Error).message);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
