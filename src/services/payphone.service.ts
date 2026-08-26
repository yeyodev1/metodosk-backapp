import axios, { AxiosError } from "axios";
import mongoose from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Order } from "../models/Order";
import { AppEnvironment, resolveEnvironment } from "../config/environments";
import { ACCESS_MONTHS, isKnownAmount } from "../config/pricing";

/** Endpoint de confirmación de la Cajita de Pagos. */
const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

/** Lo que devolvemos al frontend (ver metodosk-frontapp/src/services/paymentService.ts). */
export interface PayphoneConfirmation {
  transactionStatus: "Approved" | "Canceled" | "Failed" | string;
  clientTransactionId: string;
  authorizationCode?: string;
  amount: number;
  message?: string;
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

  await persistOrder({
    clientTransactionId: raw.clientTransactionId || clientTxId,
    payphoneTransactionId: raw.transactionId != null ? String(raw.transactionId) : null,
    status,
    amountCents,
    amountVerified,
    currency: raw.currency || "USD",
    authorizationCode: raw.authorizationCode ?? null,
    environment,
    email: raw.email ?? null,
    phoneNumber: raw.phoneNumber ?? null,
    cardHolder: raw.optionalParameter4 ?? null,
    accessMonths: ACCESS_MONTHS,
    accessUntil: status === "approved" ? addMonths(new Date(), ACCESS_MONTHS) : null,
    payphoneResponse: raw,
  });

  return {
    transactionStatus:
      raw.transactionStatus ??
      (status === "approved" ? "Approved" : status === "canceled" ? "Canceled" : "Failed"),
    clientTransactionId: raw.clientTransactionId || clientTxId,
    authorizationCode: raw.authorizationCode,
    amount: amountCents,
    message: raw.message,
  };
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
