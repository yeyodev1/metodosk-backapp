import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { dbConnect } from "../config/mongo";
import { User } from "../models/User";

/**
 * Crea o promueve una cuenta de administración desde la terminal.
 *
 * Si el correo ya existe, se promueve y se le pone la contraseña dada; si
 * no, se crea. La contraseña no queda marcada como "cámbiala": es la que
 * la dueña pidió.
 *
 *   npm run crear-admin -- correo contraseña "Nombre"
 */
async function main() {
  const [correo, password, nombre] = process.argv.slice(2);
  if (!correo || !password) throw new Error("Uso: crear-admin correo contraseña [nombre]");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const email = correo.toLowerCase().trim();
  const hash = await bcrypt.hash(password, 10);
  const existente = await User.findOne({ email });

  if (existente) {
    existente.role = "admin";
    existente.password = hash;
    existente.mustChangePassword = false;
    if (nombre) existente.name = nombre;
    await existente.save();
    console.log(`promovida: ${email}`);
  } else {
    await User.create({
      email,
      password: hash,
      name: nombre || "",
      role: "admin",
      mustChangePassword: false,
      recursosEnviados: new Date(),
    });
    console.log(`creada: ${email}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
