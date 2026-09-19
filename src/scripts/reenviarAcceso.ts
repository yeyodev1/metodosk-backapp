import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { reenviarAcceso } from "../services/reenviarAcceso.service";

/**
 * "Pagué y no me llegó el correo" (ver reenviarAcceso.service).
 *
 *   npm run reenviar-acceso -- correo@de-su-compra.com
 *   npm run reenviar-acceso -- correo@de-su-compra.com --a=otro@correo.com
 *
 * Con `--a=` le llega además a esa otra dirección. El usuario para entrar
 * sigue siendo el correo de la compra, y el correo se lo dice.
 */
async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const otro = args.find((a) => a.startsWith("--a="))?.split("=")[1];
  const [correo] = args.filter((a) => !a.startsWith("--"));

  if (!correo) throw new Error("Uso: reenviar-acceso <correo de la compra> [--a=otro@correo]");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const r = await reenviarAcceso(correo, otro);
  console.log(
    `${r.email} · contraseña: ${r.password ?? "(la que ella ya creó)"}` +
      ` · telegram: ${r.telegramEnCorreo ? "en el correo" : "todavía no"}`,
  );
  for (const e of r.envios) console.log(`  → ${e.to}: ${e.enviado ? "enviado" : "NO SALIÓ"}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
