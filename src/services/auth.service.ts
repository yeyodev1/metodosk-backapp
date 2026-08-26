import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User, type UserRole } from "../models/User";
import { Order } from "../models/Order";
import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";

const TOKEN_TTL = "30d";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new CustomError("Falta JWT_SECRET en el servidor", 500);
  return secret;
}

/**
 * Espera a que la base esté lista en vez de rechazar de una.
 *
 * En una instancia fría la petición puede llegar antes que la conexión, y
 * fallar ahí le mostraba a la compradora un error que no significa nada para
 * ella. Se reintenta una vez y, si de verdad no hay base, el mensaje habla de
 * lo que ella puede hacer: volver a intentar.
 */
async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  challenge: string | null;
  accessUntil: string | null;
  /** true si el acceso sigue vigente hoy. */
  accessActive: boolean;
  mustChangePassword: boolean;
}

function sanitize(user: InstanceType<typeof User>): SessionUser {
  const accessUntil = user.accessUntil ?? null;
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    challenge: user.challenge,
    accessUntil: accessUntil ? accessUntil.toISOString() : null,
    accessActive: Boolean(accessUntil && accessUntil > new Date()),
    mustChangePassword: user.mustChangePassword,
  };
}

function signToken(user: InstanceType<typeof User>): string {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email, accountType: user.role },
    jwtSecret(),
    { expiresIn: TOKEN_TTL },
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

/** Contraseña legible pero no adivinable, para enviar por correo. */
export function generatePassword(): string {
  const alfabeto = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  await requireDb();
  if (!email || !password) {
    throw new CustomError("Escribe tu correo y tu contraseña", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Mismo mensaje exista o no la cuenta: el login no sirve para descubrir correos.
  const invalido = new CustomError("Correo o contraseña incorrectos", 401);
  if (!user) throw invalido;
  if (!(await bcrypt.compare(password, user.password))) throw invalido;

  user.lastLoginAt = new Date();
  await user.save();

  return { token: signToken(user), user: sanitize(user) };
}

export async function findById(id: string): Promise<SessionUser> {
  await requireDb();
  const user = await User.findById(id);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);
  return sanitize(user);
}

/**
 * Estado de un correo, para que el registro pueda decir con claridad qué pasa.
 * Solo informa sobre compras, que es algo que quien pagó ya sabe.
 */
export async function checkEmail(
  email: string,
): Promise<{ hasPurchase: boolean; hasAccount: boolean; challenge: string | null }> {
  await requireDb();
  const normalizado = email.toLowerCase().trim();
  if (!EMAIL.test(normalizado)) throw new CustomError("Revisa el correo", 400);

  const orden = await Order.findOne({ email: normalizado, status: "approved" }).sort({
    createdAt: -1,
  });
  const cuenta = await User.findOne({ email: normalizado });

  return {
    hasPurchase: Boolean(orden),
    hasAccount: Boolean(cuenta) && !cuenta?.mustChangePassword,
    challenge: orden?.challenge ?? null,
  };
}

/**
 * Alta de contraseña para quien ya compró.
 *
 * Exige una compra aprobada con ese correo: sin eso no hay cuenta que crear.
 * Es a propósito que no exista un registro abierto — el acceso se compra.
 */
export async function register(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  await requireDb();

  const normalizado = email.toLowerCase().trim();
  if (!EMAIL.test(normalizado)) throw new CustomError("Revisa el correo", 400);
  if (!password || password.length < MIN_PASSWORD) {
    throw new CustomError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 400);
  }

  const orden = await Order.findOne({ email: normalizado, status: "approved" }).sort({
    createdAt: -1,
  });
  if (!orden) {
    throw new CustomError(
      "No encontramos una compra con ese correo. El acceso al reto se compra primero.",
      404,
    );
  }

  const existente = await User.findOne({ email: normalizado });
  if (existente && !existente.mustChangePassword) {
    throw new CustomError(
      "Ya tienes una cuenta con ese correo. Entra con tu contraseña.",
      409,
    );
  }

  const hash = await bcrypt.hash(password, 10);
  const user = existente ?? new User({ email: normalizado, password: hash, role: "member" });

  user.password = hash;
  user.mustChangePassword = false;
  user.name = user.name || orden.buyerName || "";
  user.phone = user.phone ?? orden.phoneNumber ?? null;
  user.challenge = orden.challenge ?? user.challenge;
  user.accessUntil = orden.accessUntil ?? user.accessUntil;
  user.clientTransactionId = orden.clientTransactionId;
  await user.save();

  return { token: signToken(user), user: sanitize(user) };
}

/** Cambio de contraseña de la propia cuenta. */
export async function changePassword(
  userId: string,
  current: string,
  next: string,
): Promise<SessionUser> {
  await requireDb();
  if (!next || next.length < MIN_PASSWORD) {
    throw new CustomError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);
  if (!(await bcrypt.compare(current, user.password))) {
    throw new CustomError("Tu contraseña actual no es correcta", 401);
  }

  user.password = await bcrypt.hash(next, 10);
  user.mustChangePassword = false;
  await user.save();

  return sanitize(user);
}

/**
 * Crea o actualiza la cuenta de una compradora cuando su pago se aprueba.
 *
 * Devuelve la contraseña en claro solo si la acaba de generar, para poder
 * mandarla por correo. Si la cuenta ya existía, no se toca la contraseña.
 */
export async function ensureMember(input: {
  email: string;
  name?: string | null;
  phone?: string | null;
  challenge?: string | null;
  accessUntil: Date;
  clientTransactionId: string;
}): Promise<{ password: string | null; created: boolean }> {
  if (mongoose.connection.readyState !== 1) return { password: null, created: false };

  const email = input.email.toLowerCase().trim();
  if (!EMAIL.test(email)) return { password: null, created: false };

  try {
    let user = await User.findOne({ email });
    let password: string | null = null;
    let created = false;

    if (!user) {
      password = generatePassword();
      user = new User({
        email,
        password: await bcrypt.hash(password, 10),
        role: "member",
        mustChangePassword: true,
      });
      created = true;
    }

    user.name = input.name?.trim() || user.name;
    user.phone = input.phone ?? user.phone;
    user.challenge = input.challenge ?? user.challenge;
    // Si vuelve a comprar, se conserva la fecha más lejana.
    if (!user.accessUntil || input.accessUntil > user.accessUntil) {
      user.accessUntil = input.accessUntil;
    }
    user.clientTransactionId = input.clientTransactionId;
    await user.save();

    return { password, created };
  } catch (error) {
    console.error("[auth] no se pudo crear la cuenta de la compradora:", error);
    return { password: null, created: false };
  }
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
