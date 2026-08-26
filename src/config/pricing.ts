/**
 * Precios del reto, en CENTAVOS — deben coincidir con
 * metodosk-frontapp/src/config/payment.ts.
 *
 * Se usan para verificar que el monto que PayPhone confirmó sea uno de los
 * nuestros. Si alguien manipula el importe en el navegador, lo detectamos acá.
 */

const DEFAULT_PRESALE_CENTS = 6700;
const DEFAULT_REGULAR_CENTS = 8700;
const DEFAULT_PRESALE_DEADLINE = "2026-09-07T23:59:59-05:00";

/** Meses de acceso que otorga la compra. */
export const ACCESS_MONTHS = 3;

function centsFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function presaleCents(): number {
  return centsFromEnv(process.env.PRESALE_PRICE_CENTS, DEFAULT_PRESALE_CENTS);
}

export function regularCents(): number {
  return centsFromEnv(process.env.REGULAR_PRICE_CENTS, DEFAULT_REGULAR_CENTS);
}

export function presaleDeadline(): Date {
  const parsed = new Date(process.env.PRESALE_DEADLINE || DEFAULT_PRESALE_DEADLINE);
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_PRESALE_DEADLINE) : parsed;
}

export function isPresaleActive(now: Date = new Date()): boolean {
  return now < presaleDeadline();
}

/** Precio que corresponde cobrar ahora mismo. */
export function currentCents(now: Date = new Date()): number {
  return isPresaleActive(now) ? presaleCents() : regularCents();
}

/** ¿El monto confirmado por PayPhone es uno de nuestros precios? */
export function isKnownAmount(cents: number): boolean {
  return cents === presaleCents() || cents === regularCents();
}

export function pricingStatus() {
  return {
    presaleCents: presaleCents(),
    regularCents: regularCents(),
    currentCents: currentCents(),
    isPresale: isPresaleActive(),
    deadline: presaleDeadline().toISOString(),
    accessMonths: ACCESS_MONTHS,
  };
}
