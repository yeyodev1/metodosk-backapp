import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { dbConnect } from "../config/mongo";
import { ACCESS_MONTHS } from "../config/pricing";
import { sendAccessEmail } from "../helpers/email.helper";
import { Order } from "../models/Order";
import { User } from "../models/User";
import { ensureMember, generatePassword } from "../services/auth.service";
import { entradaParaCorreoDeCompra } from "../services/telegramAviso.service";

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
 *   npm run acceso-exclusivo -- correo1 correo2 ...
 */
const RETOS = ["SK Recomposición", "SK Volumen"];

function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d;
}

async function darAcceso(correo: string) {
  const email = correo.toLowerCase().trim();
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
  if (!user) throw new Error(`no se pudo crear la cuenta de ${email}`);

  // Si ya tenía cuenta pero nunca cambió la contraseña que le mandamos, se le
  // genera otra para poder enviársela. Si ya creó la suya, no se le toca.
  if (!password && user.mustChangePassword) {
    password = generatePassword();
    user.password = await bcrypt.hash(password, 10);
  }
  user.accesoExclusivo = true;
  await user.save();

  const telegramBotUrl = await entradaParaCorreoDeCompra(email);
  const enviado = await sendAccessEmail({
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

  console.log(
    `${email} · retos: ${user.challenges.join(", ")} · hasta ${user.accessUntil?.toISOString().slice(0, 10)}` +
      ` · contraseña: ${password ?? "(la que ella ya creó)"} · correo: ${enviado ? "enviado" : "NO SALIÓ"}` +
      ` · telegram: ${telegramBotUrl ? "en el correo" : "todavía no"}`,
  );
}

async function main() {
  const correos = process.argv.slice(2).filter(Boolean);
  if (!correos.length) throw new Error("Uso: acceso-exclusivo correo1 correo2 ...");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  for (const correo of correos) {
    try {
      await darAcceso(correo);
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
