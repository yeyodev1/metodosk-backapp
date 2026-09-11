import bcrypt from "bcryptjs";
import { ACCESS_MONTHS } from "../config/pricing";
import { CustomError } from "../errors/customError.error";
import { sendAccessEmail } from "../helpers/email.helper";
import { Order } from "../models/Order";
import { User } from "../models/User";
import { ensureMember, generatePassword } from "./auth.service";
import { entradaParaCorreoDeCompra } from "./telegramAviso.service";

/**
 * Acceso exclusivo: la cuenta queda como la de quien pagó en pre-venta
 * —los dos retos y el grupo VIP— y le llega el correo con su usuario y
 * contraseña.
 *
 * Deja una orden aprobada por $0 para que todo lo que se calcula desde la
 * primera compra (beneficios, grupos de Telegram, registro) la trate igual
 * que a una compradora. El id empieza con EXCLUSIVO- para distinguirla en
 * el panel.
 *
 * Se puede repetir sin duplicar nada: la orden y los retos no se vuelven a
 * crear. Lo único que cambia es la contraseña si todavía no la cambió ella,
 * porque es la única forma de poder mandársela otra vez.
 */
const RETOS = ["SK Recomposición", "SK Volumen"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ResultadoAcceso {
  email: string;
  retos: string[];
  accessUntil: string | null;
  /** La contraseña que se le mandó. null si ya había creado la suya. */
  password: string | null;
  correoEnviado: boolean;
  telegramEnCorreo: boolean;
}

function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d;
}

export async function darAccesoExclusivo(correo: string): Promise<ResultadoAcceso> {
  const email = correo.toLowerCase().trim();
  if (!EMAIL.test(email)) throw new CustomError(`Revisa el correo: ${correo}`, 400);

  const tx = `EXCLUSIVO-${email}`;
  const accessUntil = sumarMeses(new Date(), ACCESS_MONTHS);
  const previa = await User.findOne({ email });

  if (!(await Order.findOne({ clientTransactionId: tx }))) {
    await Order.create({
      clientTransactionId: tx,
      status: "approved",
      amountCents: 0,
      amountVerified: true,
      environment: "prod",
      email,
      phoneNumber: previa?.phone ?? null,
      buyerName: previa?.name || null,
      challenge: RETOS[0],
      accessMonths: ACCESS_MONTHS,
      accessUntil,
      payphoneResponse: { origen: "acceso-exclusivo", retos: RETOS },
    });
  }

  // Un paso por reto: ensureMember suma cada uno sin quitar el otro.
  let password: string | null = null;
  for (const challenge of RETOS) {
    const r = await ensureMember({ email, challenge, accessUntil, clientTransactionId: tx });
    password = password ?? r.password;
  }

  const user = await User.findOne({ email });
  if (!user) throw new CustomError(`No se pudo crear la cuenta de ${email}`, 500);

  // Si ya tenía cuenta pero nunca cambió la contraseña que le mandamos, se le
  // genera otra para poder enviársela. Si ya creó la suya, no se le toca.
  if (!password && user.mustChangePassword) {
    password = generatePassword();
    user.password = await bcrypt.hash(password, 10);
  }
  user.accesoExclusivo = true;
  await user.save();

  const telegramBotUrl = await entradaParaCorreoDeCompra(email);
  const correoEnviado = await sendAccessEmail({
    to: email,
    name: user.name || null,
    challenge: RETOS.join(" y "),
    amountCents: 0,
    accessMonths: ACCESS_MONTHS,
    accessUntil: user.accessUntil ?? accessUntil,
    password,
    telegramBotUrl,
    exclusivo: true,
  });

  return {
    email,
    retos: user.challenges,
    accessUntil: user.accessUntil ? user.accessUntil.toISOString() : null,
    password,
    correoEnviado,
    telegramEnCorreo: Boolean(telegramBotUrl),
  };
}
