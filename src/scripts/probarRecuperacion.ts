import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import crypto from "crypto";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { User } from "../models/User";

/**
 * Planta un enlace de recuperación para una cuenta de prueba y lo imprime,
 * para probar /auth/restablecer contra producción sin leer un correo.
 * Solo para cuentas de prueba: a nadie más se le toca la contraseña.
 */
async function main() {
  const email = (process.argv[2] || "").toLowerCase();
  if (!email.startsWith("prueba-")) throw new Error("Solo cuentas de prueba (prueba-...)");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const u = await User.findOne({ email });
  if (!u) throw new Error("No existe");
  console.log(
    "guardado por /recuperar:",
    u.passwordReset ? `sí (vence ${u.passwordReset.expiresAt.toISOString()})` : "no",
  );
  const token = crypto.randomBytes(32).toString("hex");
  u.passwordReset = {
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 3600000),
  };
  await u.save();
  console.log("TOKEN=" + token);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
