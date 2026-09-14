import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { listarParaAlumna } from "../services/course.service";
import { User } from "../models/User";

/**
 * Qué le devuelve el servidor a una alumna concreta, tal cual.
 *
 * No mira la base "a ojo": llama a la misma función que sirve la app, con su
 * cuenta, así que lo que imprime es exactamente lo que ella ve. Es la única
 * forma de zanjar un "a mí me sale bloqueado" sin pedirle capturas.
 *
 *   npm run ver-como-alumna -- correo@ejemplo.com
 *   npm run ver-como-alumna              (toma una alumna cualquiera con reto)
 */
async function main() {
  const correo = process.argv[2]?.toLowerCase().trim();
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const user = correo
    ? await User.findOne({ email: correo })
    : await User.findOne({ role: "member", challenge: { $ne: null } }).sort({ createdAt: -1 });

  if (!user) throw new Error(correo ? `No existe ${correo}` : "No hay alumnas con reto");

  const retos = user.challenges?.length ? user.challenges : [user.challenge];
  console.log(`\n${user.email}`);
  console.log(`  retos: ${retos.filter(Boolean).join(", ") || "NINGUNO"}`);
  console.log(`  acceso hasta: ${user.accessUntil?.toISOString().slice(0, 10) ?? "—"}`);
  console.log(`  último ingreso: ${user.lastLoginAt?.toISOString().slice(0, 16) ?? "NUNCA"}`);

  // El mes que la app pide según la semana en que va; 1 mientras esté en el
  // primer mes, que es donde está todo el mundo ahora.
  for (const mes of [1]) {
    const cursos = await listarParaAlumna(String(user._id), mes);
    console.log(`\n  esto es lo que ve (mes ${mes}):`);
    for (const c of cursos) {
      const clases = c.lessons.filter((l) => l.embedUrl).length;
      const video = c.welcomeVideo ? "video de bienvenida" : "";
      const detalle = [video, clases ? `${clases} clase(s) reproducibles` : ""].filter(Boolean).join(" + ");
      console.log(
        `    ${c.estado.toUpperCase().padEnd(13)} ${c.title.padEnd(36)} ${detalle || "sin material"}`,
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
