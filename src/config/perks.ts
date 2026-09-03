/**
 * Los beneficios de comprar en pre-venta.
 *
 * Hoy son promesas con fecha, no funciones abiertas: el reto arranca después y
 * lo que se compró es el cupo. Vive acá y no en el frontend porque el corte lo
 * decide una fecha de compra guardada en el servidor — si lo decidiera el
 * navegador, bastaría cambiar el reloj del teléfono para reclamarlo.
 */

/**
 * Hasta cuándo la compra da acceso a la comunidad masiva de Telegram.
 *
 * Quien compra después entra igual al reto, pero el grupo se le cobra aparte.
 */
const DEFAULT_TELEGRAM_DEADLINE = "2026-09-14T23:59:59-05:00";

/** Cuándo se abre lo que hoy está prometido. null = "pronto", sin fecha. */
const DEFAULT_APERTURA = "2026-09-15T00:00:00-05:00";

export function telegramDeadline(): Date {
  const parsed = new Date(process.env.TELEGRAM_DEADLINE || DEFAULT_TELEGRAM_DEADLINE);
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_TELEGRAM_DEADLINE) : parsed;
}

export function aperturaFecha(): Date {
  const parsed = new Date(process.env.APERTURA_FECHA || DEFAULT_APERTURA);
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_APERTURA) : parsed;
}

export interface Beneficios {
  /** true mientras el reto siga siendo una pre-venta y no un producto abierto. */
  enPreventa: boolean;
  /** Cuándo se abre el contenido. */
  apertura: string;
  /** Hasta cuándo comprar incluye el grupo de Telegram. */
  telegramDeadline: string;
  /** true si esta compradora entró a tiempo para el grupo de Telegram. */
  telegramIncluido: boolean;
  /** true si compró dentro de la pre-venta: le toca el grupo con Scarlet y Karen. */
  grupoPremium: boolean;
  /** Su primera compra aprobada. null si todavía no hay ninguna. */
  primeraCompra: string | null;
}

/**
 * Qué le corresponde a quien compró en esta fecha.
 *
 * Se mide contra la **primera** compra: quien entró en pre-venta y luego sumó
 * el segundo reto no pierde el beneficio por haber vuelto tarde.
 */
export function beneficiosDe(
  primeraCompra: Date | null,
  presaleDeadline: Date,
  ahora: Date = new Date(),
): Beneficios {
  const telegram = telegramDeadline();
  const apertura = aperturaFecha();

  return {
    enPreventa: ahora < apertura,
    apertura: apertura.toISOString(),
    telegramDeadline: telegram.toISOString(),
    telegramIncluido: Boolean(primeraCompra && primeraCompra <= telegram),
    grupoPremium: Boolean(primeraCompra && primeraCompra <= presaleDeadline),
    primeraCompra: primeraCompra ? primeraCompra.toISOString() : null,
  };
}
