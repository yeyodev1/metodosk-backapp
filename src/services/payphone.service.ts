import axios, { AxiosError } from "axios";
import mongoose from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Order } from "../models/Order";
import { AppEnvironment, resolveEnvironment } from "../config/environments";
import { ACCESS_MONTHS, isKnownAmount } from "../config/pricing";
import { sendAccessEmail } from "../helpers/email.helper";
import { ensureMember } from "./auth.service";

/** Endpoint de confirmación de la Cajita de Pagos. */
const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

/** Datos que capturó nuestro formulario, para el correo y el registro. */
export interface CheckoutContact {
  name?: string;
  email?: string;
  phone?: string;
  /** Nombre del reto elegido, p. ej. "SK Recomposición". */
  challenge?: string;
}

/** Lo que devolvemos al frontend (ver metodosk-frontapp/src/services/paymentService.ts). */
export interface PayphoneConfirmation {
  transactionStatus: "Approved" | "Canceled" | "Failed" | string;
  clientTransactionId: string;
  authorizationCode?: string;
  amount: number;
  message?: string;
  /** Datos del acceso, para que la página de resultado los muestre. */
  challenge?: string | null;
  accessMonths?: number;
  accessUntil?: string | null;
  /** Correo al que se envió la confirmación. */
  email?: string | null;
  emailSent?: boolean;
}

interface PayphoneRaw {
  statusCode?: number;
  transactionStatus?: string;
  transactionId?: number | string;
  clientTransactionId?: string;
  authorizationCode?: string;
  amount?: number;
  message?: string;
  email?: string;
  phoneNumber?: string;
  optionalParameter4?: string;
  currency?: string;
}

function credentialsFor(environment: AppEnvironment) {
  const token =
    environment === "test"
      ? process.env.PAYPHONE_TEST_TOKEN || process.env.PAYPHONE_TOKEN
      : process.env.PAYPHONE_TOKEN;

  if (!token) {
    throw new CustomError(
      `Falta el token de PayPhone para el entorno "${environment}"`,
      500,
    );
  }
  return { token };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** statusCode 3 = aprobada, 2 = cancelada. */
function statusFrom(raw: PayphoneRaw): "approved" | "canceled" | "failed" {
  if (raw.statusCode === 3 || raw.transactionStatus === "Approved") return "approved";
  if (raw.statusCode === 2 || raw.transactionStatus === "Canceled") return "canceled";
  return "failed";
}

/**
 * Confirma la transacción contra PayPhone y deja constancia del pedido.
 *
 * PayPhone reversa automáticamente cualquier cobro que no se confirme dentro
 * de los 5 minutos siguientes, así que esta llamada es obligatoria.
 */
export async function confirmTransaction(
  id: string,
  clientTxId: string,
  origin?: string,
  contact?: CheckoutContact,
): Promise<PayphoneConfirmation> {
  if (!id || !clientTxId) {
    throw new CustomError("Faltan id y clientTxId", 400);
  }

  const environment = resolveEnvironment(origin);
  const { token } = credentialsFor(environment);

  let raw: PayphoneRaw;
  try {
    const response = await axios.post(
      CONFIRM_URL,
      { id: Number(id), clientTxId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );
    raw = response.data as PayphoneRaw;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw new CustomError(
      axiosError.response?.data?.message || "No pudimos confirmar el pago con PayPhone",
      axiosError.response?.status || 502,
    );
  }

  const status = statusFrom(raw);
  const amountCents = Number(raw.amount) || 0;
  const amountVerified = isKnownAmount(amountCents);

  if (status === "approved" && !amountVerified) {
    // El cobro pasó por un monto que no es ninguno de nuestros precios.
    console.error(
      `[payphone] monto inesperado en ${clientTxId}: ${amountCents} centavos`,
    );
  }

  const accessUntil = status === "approved" ? addMonths(new Date(), ACCESS_MONTHS) : null;
  // Preferimos el correo que escribió la compradora; el de PayPhone es el respaldo.
  const email = contact?.email?.trim() || raw.email || null;

  await persistOrder({
    clientTransactionId: raw.clientTransactionId || clientTxId,
    payphoneTransactionId: raw.transactionId != null ? String(raw.transactionId) : null,
    status,
    amountCents,
    amountVerified,
    currency: raw.currency || "USD",
    authorizationCode: raw.authorizationCode ?? null,
    environment,
    email,
    phoneNumber: contact?.phone ?? raw.phoneNumber ?? null,
    cardHolder: raw.optionalParameter4 ?? null,
    buyerName: contact?.name ?? null,
    challenge: contact?.challenge ?? null,
    accessMonths: ACCESS_MONTHS,
    accessUntil,
    payphoneResponse: raw,
  });

  // El correo va después de guardar: si falla, la compra igual queda registrada.
  let emailSent = false;
  if (status === "approved" && accessUntil) {
    // La cuenta se crea sola con la compra; la contraseña solo existe la
    // primera vez, para poder enviarla.
    const cuenta = email
      ? await ensureMember({
          email,
          name: contact?.name ?? raw.optionalParameter4 ?? null,
          phone: contact?.phone ?? raw.phoneNumber ?? null,
          challenge: contact?.challenge ?? null,
          accessUntil,
          clientTransactionId: raw.clientTransactionId || clientTxId,
        })
      : { password: null, created: false };

    emailSent = await sendAccessEmail({
      to: email ?? "",
      name: contact?.name ?? raw.optionalParameter4 ?? null,
      challenge: contact?.challenge ?? null,
      amountCents,
      accessMonths: ACCESS_MONTHS,
      accessUntil,
      authorizationCode: raw.authorizationCode ?? null,
      password: cuenta.password,
    });
  }

  return {
    transactionStatus:
      raw.transactionStatus ??
      (status === "approved" ? "Approved" : status === "canceled" ? "Canceled" : "Failed"),
    clientTransactionId: raw.clientTransactionId || clientTxId,
    authorizationCode: raw.authorizationCode,
    amount: amountCents,
    message: raw.message,
    challenge: contact?.challenge ?? null,
    accessMonths: ACCESS_MONTHS,
    accessUntil: accessUntil ? accessUntil.toISOString() : null,
    email,
    emailSent,
  };
}

/**
 * Vuelve a enviar la confirmación de compra, opcionalmente a otra dirección.
 *
 * Se reconfirma contra PayPhone en vez de confiar en lo que llegue del
 * cliente: sin eso, cualquiera podría pedir el reenvío de una compra que no
 * existe o que no fue aprobada.
 */
export async function resendAccess(
  id: string,
  clientTxId: string,
  origin?: string,
  toEmail?: string,
): Promise<{ sent: boolean; email: string | null; accessUntil: string | null }> {
  if (!canResend(clientTxId)) {
    throw new CustomError(
      "Demasiados reenvíos para esta compra. Espera unos minutos.",
      429,
    );
  }

  const environment = resolveEnvironment(origin);
  const { token } = credentialsFor(environment);

  let raw: PayphoneRaw;
  try {
    const response = await axios.post(
      CONFIRM_URL,
      { id: Number(id), clientTxId },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20000 },
    );
    raw = response.data as PayphoneRaw;
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw new CustomError(
      axiosError.response?.data?.message || "No encontramos esa compra",
      axiosError.response?.status || 502,
    );
  }

  if (statusFrom(raw) !== "approved") {
    throw new CustomError("Esa compra no está aprobada", 400);
  }

  const destino = toEmail?.trim() || raw.email || "";
  if (!isEmail(destino)) {
    throw new CustomError("Revisa el correo al que quieres reenviarlo", 400);
  }

  const stored = await findOrder(raw.clientTransactionId || clientTxId);
  const accessUntil = stored?.accessUntil ?? addMonths(new Date(), ACCESS_MONTHS);

  const sent = await sendAccessEmail({
    to: destino,
    name: stored?.buyerName ?? raw.optionalParameter4 ?? null,
    challenge: stored?.challenge ?? null,
    amountCents: Number(raw.amount) || 0,
    accessMonths: ACCESS_MONTHS,
    accessUntil,
    authorizationCode: raw.authorizationCode ?? null,
  });

  return { sent, email: destino, accessUntil: accessUntil.toISOString() };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (value: string): boolean => EMAIL.test(value);

/**
 * Tope de reenvíos por compra. Es en memoria, así que en serverless aplica por
 * instancia: suficiente para frenar un abuso torpe sin necesitar base de datos.
 */
const RESEND_LIMIT = 5;
const RESEND_WINDOW_MS = 15 * 60 * 1000;
const resendLog = new Map<string, number[]>();

function canResend(clientTxId: string): boolean {
  const now = Date.now();
  const previos = (resendLog.get(clientTxId) ?? []).filter((t) => now - t < RESEND_WINDOW_MS);
  if (previos.length >= RESEND_LIMIT) {
    resendLog.set(clientTxId, previos);
    return false;
  }
  previos.push(now);
  resendLog.set(clientTxId, previos);
  return true;
}

/** Datos guardados del pedido, si hay base de datos. */
async function findOrder(clientTransactionId: string) {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    return await Order.findOne({ clientTransactionId }).lean();
  } catch {
    return null;
  }
}

/** Guarda el pedido si hay base de datos. Nunca tumba la confirmación. */
async function persistOrder(data: Record<string, unknown>): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await Order.findOneAndUpdate(
      { clientTransactionId: data.clientTransactionId },
      data,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    console.error("[payphone] no se pudo guardar el pedido:", error);
  }
}
