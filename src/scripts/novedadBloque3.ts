import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { User } from "../models/User";
import { sendNovedadEmail } from "../helpers/email.helper";
import { activarNovedad, estadoNovedad, guardarNovedad } from "../services/novedades.service";

/**
 * El aviso de que llegó el bloque 3: lunes y martes primero, el resto se suma.
 *
 * Misma mecánica que el bloque 2: sin argumentos solo lo guarda, con
 * `--avisar` da la orden al cron (25 por hora, 50 al día). Con `--admins` lo
 * manda de una a las cuentas de administración, para que lo vean hoy sin
 * esperar su turno en la cola.
 *
 *   pnpm novedad-bloque-3                    # lo guarda
 *   pnpm novedad-bloque-3 --avisar --admins  # lo manda
 */
const TITULO = "Ya tienes el bloque 3 de tu reto 🔥";

const TEXTO = [
  "Ya está abierto en tu app el bloque 3, el último de tu reto: las rutinas para tus semanas 9 a 12.",
  "Por ahora están el lunes y el martes. Los demás días de la semana se van sumando en los próximos días y los verás aparecer en su lugar, sin que tengas que hacer nada.",
  "Si todavía no llegas a tu semana 9, no te adelantes: termina tu bloque 2 primero y sigue con el 3 cuando te toque. Se te abre solo en tu semana 9.",
].join("\n\n");

const SITIO = (process.env.SITE_URL || "https://metodosk.ec").replace(/\/$/, "");
const CTA = { ctaTexto: "Ver mi bloque 3", ctaUrl: `${SITIO}/academia` };

async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  await guardarNovedad({ titulo: TITULO, texto: TEXTO, ...CTA });

  if (process.argv.includes("--avisar")) await activarNovedad();

  if (process.argv.includes("--admins")) {
    for (const admin of await User.find({ role: "admin", email: { $ne: null } })) {
      const ok = await sendNovedadEmail({ to: admin.email, name: admin.name, titulo: TITULO, texto: TEXTO, ...CTA });
      console.log(`${ok ? "✓" : "✗"} admin ${admin.email}`);
    }
  }

  const estado = await estadoNovedad();
  console.log(JSON.stringify({ ...estado, novedad: estado.novedad?.titulo }, null, 2));
  console.log(
    process.argv.includes("--avisar")
      ? "Orden dada: el cron manda la primera tanda en su próxima corrida."
      : "Guardado sin enviar. Para dar la orden: pnpm novedad-bloque-3 --avisar",
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
