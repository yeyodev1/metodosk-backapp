import { Order } from "../models/Order";
import { statusFrom } from "./payphone.service";

/**
 * Devuelve cada compra al estado que PayPhone reportó al confirmarla.
 *
 * Cada orden guarda esa respuesta entera en `payphoneResponse`, tal como
 * llegó el día de la compra, y de ahí salió su estado la primera vez. Volver
 * a leerla reconstruye exactamente lo que había: no consulta a nadie, no
 * depende de la red, y correrlo dos veces da el mismo resultado.
 *
 * Existe porque una conciliación mal hecha interpretó la respuesta de otro
 * endpoint de PayPhone y marcó todas las compras como fallidas.
 */
export interface ResultadoRestauracion {
  revisadas: number;
  /** Sin respuesta original guardada: se dejan intactas antes que inventar. */
  sinRespaldo: number;
  corregidas: { buyerName: string | null; antes: string; ahora: string }[];
}

export async function restaurarDesdeRespuestaOriginal(): Promise<ResultadoRestauracion> {
  const orders = await Order.find({}).lean();
  const corregidas: ResultadoRestauracion["corregidas"] = [];
  let sinRespaldo = 0;

  for (const orden of orders) {
    if (!orden.payphoneResponse || typeof orden.payphoneResponse !== "object") {
      sinRespaldo++;
      continue;
    }

    const original = statusFrom(orden.payphoneResponse as Record<string, never>);
    if (original === orden.status) continue;

    await Order.findByIdAndUpdate(orden._id, { status: original });
    corregidas.push({
      buyerName: orden.buyerName ?? orden.cardHolder ?? null,
      antes: orden.status,
      ahora: original,
    });
  }

  return { revisadas: orders.length, sinRespaldo, corregidas };
}
