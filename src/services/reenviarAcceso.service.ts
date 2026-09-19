import bcrypt from "bcryptjs";
import { ACCESS_MONTHS } from "../config/pricing";
import { CustomError } from "../errors/customError.error";
import { sendAccessEmail } from "../helpers/email.helper";
import { Order } from "../models/Order";
import { User } from "../models/User";
import { generatePassword } from "./auth.service";
import { entradaParaCorreoDeCompra } from "./telegramAviso.service";

/**
 * "Pagué y no me llegó nada": se le vuelve a mandar su acceso.
 *
 * Casi nunca es que el correo no salió —Resend lo marca entregado— sino que
 * cayó en spam o en un buzón que ella no revisa. Por eso se puede mandar
 * además a otra dirección: el usuario sigue siendo el correo con el que pagó,
 * y el correo lo dice así para que no intente entrar con el otro.
 *
 * Si todavía usa la contraseña que le mandamos, se le genera una nueva, porque
 * la anterior no se puede leer. Si ya creó la suya, no se le toca.
 */
export interface ResultadoReenvio {
  email: string;
  /** La contraseña que se le mandó. null si ya había creado la suya. */
  password: string | null;
  /** A qué direcciones se escribió y si Resend aceptó cada una. */
  envios: { to: string; enviado: boolean }[];
  telegramEnCorreo: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function reenviarAcceso(
  correo: string,
  otroCorreo?: string,
): Promise<ResultadoReenvio> {
  const email = correo.toLowerCase().trim();
  const otro = otroCorreo?.toLowerCase().trim();
  if (otro && !EMAIL.test(otro)) throw new CustomError(`Revisa el correo: ${otroCorreo}`, 400);

  const user = await User.findOne({ email });
  if (!user) throw new CustomError(`No hay cuenta con ${email}`, 404);

  const orden = await Order.findOne({ email, status: "approved" }).sort({ createdAt: 1 });
  if (!orden) throw new CustomError(`${email} no tiene una compra aprobada`, 404);

  let password: string | null = null;
  if (user.mustChangePassword) {
    password = generatePassword();
    user.password = await bcrypt.hash(password, 10);
    await user.save();
  }

  const telegramBotUrl = await entradaParaCorreoDeCompra(email);
  const destinos = [...new Set([email, otro].filter((d): d is string => Boolean(d)))];

  const envios: ResultadoReenvio["envios"] = [];
  for (const to of destinos) {
    const enviado = await sendAccessEmail({
      to,
      usuario: email,
      name: user.name || orden.buyerName || null,
      challenge: user.challenges.join(" y ") || orden.challenge,
      amountCents: orden.amountCents,
      accessMonths: orden.accessMonths ?? ACCESS_MONTHS,
      accessUntil: user.accessUntil ?? orden.accessUntil ?? new Date(),
      authorizationCode: orden.authorizationCode,
      password,
      telegramBotUrl,
      exclusivo: Boolean(user.accesoExclusivo) && orden.amountCents === 0,
    });
    envios.push({ to, enviado });
  }

  return { email, password, envios, telegramEnCorreo: Boolean(telegramBotUrl) };
}
