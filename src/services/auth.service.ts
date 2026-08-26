import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";

const TOKEN_TTL = "7d";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new CustomError("Falta JWT_SECRET en el servidor", 500);
  }
  return secret;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  if (mongoose.connection.readyState !== 1) {
    throw new CustomError("El servidor no tiene base de datos configurada", 503);
  }
  if (!email || !password) {
    throw new CustomError("Escribe tu correo y tu contraseña", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Mismo mensaje exista o no la cuenta: no revelamos qué correos están dados de alta.
  const invalido = new CustomError("Correo o contraseña incorrectos", 401);
  if (!user) throw invalido;

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw invalido;

  user.lastLoginAt = new Date();
  await user.save();

  const payload = { userId: user._id.toString(), email: user.email, accountType: user.role };
  const token = jwt.sign(payload, jwtSecret(), { expiresIn: TOKEN_TTL });

  return { token, user: sanitize(user) };
}

export async function findById(id: string): Promise<SessionUser> {
  const user = await User.findById(id);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);
  return sanitize(user);
}

function sanitize(user: InstanceType<typeof User>): SessionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/**
 * Crea la cuenta de administración si todavía no existe.
 *
 * Las credenciales salen del entorno para no dejarlas escritas en el repo.
 * Si la cuenta ya está, no se toca: cambiar la contraseña desde acá borraría
 * una que se hubiera cambiado a mano.
 */
export async function seedAdmin(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;

  const email = (process.env.ADMIN_EMAIL || "admin@metodosk.ec").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.warn("[auth] ADMIN_PASSWORD no definida — no se crea la cuenta de administración");
    return;
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) return;

    await User.create({
      email,
      password: await bcrypt.hash(password, 10),
      name: process.env.ADMIN_NAME || "Administración",
      role: "admin",
    });
    console.log(`[auth] cuenta de administración creada: ${email}`);
  } catch (error) {
    console.error("[auth] no se pudo crear la cuenta de administración:", error);
  }
}
