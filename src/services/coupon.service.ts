import { CustomError } from "../errors/customError.error";
import { dbConnect, isConnected } from "../config/mongo";
import { Coupon, type ICoupon } from "../models/Coupon";
import { Order } from "../models/Order";
import { currentCents } from "../config/pricing";

/**
 * Cupones de descuento.
 *
 * El precio con descuento SIEMPRE se calcula acá. El navegador lo muestra,
 * pero el que vale es el que el servidor deja anotado en el CheckoutIntent
 * antes de salir a PayPhone: al confirmar, el monto cobrado tiene que ser
 * exactamente ese. Si alguien toca el importe en el navegador, la orden cae
 * en "por revisar" igual que antes de que existieran los cupones.
 */

export type EstadoCupon = "activo" | "programado" | "vencido" | "pausado" | "agotado";

const CODIGO = /^[A-Za-z0-9_-]{3,32}$/;
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 90;

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

export const claveDe = (code: string) => code.trim().toUpperCase();

/** Precio final con el descuento, en centavos enteros (PayPhone no acepta fracciones). */
export function precioConDescuento(baseCents: number, percent: number): number {
  return Math.round((baseCents * (100 - percent)) / 100);
}

/** Ventas reales (aprobadas, en producción) hechas con cada código. */
async function ventasPorCodigo(keys?: string[]): Promise<Map<string, { ventas: number; centavos: number }>> {
  const match: Record<string, unknown> = {
    status: "approved",
    environment: "prod",
    couponCode: keys ? { $in: keys } : { $ne: null },
  };
  const filas = await Order.aggregate<{ _id: string; ventas: number; centavos: number }>([
    { $match: match },
    { $group: { _id: "$couponCode", ventas: { $sum: 1 }, centavos: { $sum: "$amountCents" } } },
  ]);
  return new Map(filas.map((f) => [f._id, { ventas: f.ventas, centavos: f.centavos }]));
}

function estadoDe(c: Pick<ICoupon, "active" | "startsAt" | "endsAt" | "maxUses">, ventas: number, now = new Date()): EstadoCupon {
  if (!c.active) return "pausado";
  if (c.endsAt && c.endsAt <= now) return "vencido";
  if (c.startsAt > now) return "programado";
  if (c.maxUses != null && ventas >= c.maxUses) return "agotado";
  return "activo";
}

/** Por qué un cupón no se puede usar, dicho para la compradora. */
const MENSAJE_NO_VALE: Record<Exclude<EstadoCupon, "activo">, string> = {
  pausado: "Este cupón ya no está disponible.",
  vencido: "Este cupón ya venció.",
  programado: "Este cupón todavía no está activo.",
  agotado: "Este cupón ya alcanzó su límite de usos.",
};

function vistaAdmin(c: ICoupon, uso: { ventas: number; centavos: number } | undefined) {
  const ventas = uso?.ventas ?? 0;
  const base = currentCents();
  return {
    id: String(c._id),
    code: c.code,
    percent: c.percent,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    maxUses: c.maxUses,
    active: c.active,
    note: c.note,
    estado: estadoDe(c, ventas),
    ventas,
    recaudadoCents: uso?.centavos ?? 0,
    baseCents: base,
    finalCents: precioConDescuento(base, c.percent),
    createdAt: c.createdAt,
  };
}

/* ─────────────── Público ─────────────── */

/**
 * Lo que necesita el checkout para pintar el descuento.
 * Lanza 404 con un mensaje legible si el cupón no se puede usar.
 */
export async function validarCupon(code: string) {
  if (!code?.trim()) throw new CustomError("Escribe un cupón", 400);
  await requireDb();

  const cupon = await Coupon.findOne({ codeKey: claveDe(code) });
  if (!cupon) throw new CustomError("Ese cupón no existe. Revisa cómo lo escribiste.", 404);

  const uso = cupon.maxUses != null ? (await ventasPorCodigo([cupon.codeKey])).get(cupon.codeKey) : undefined;
  const estado = estadoDe(cupon, uso?.ventas ?? 0);
  if (estado !== "activo") throw new CustomError(MENSAJE_NO_VALE[estado], 410);

  const base = currentCents();
  return {
    code: cupon.code,
    percent: cupon.percent,
    endsAt: cupon.endsAt,
    baseCents: base,
    finalCents: precioConDescuento(base, cupon.percent),
  };
}

/**
 * Versión que no lanza, para el intent: si el cupón dejó de valer entre que
 * se pintó y que se pagó, la compra sigue a precio normal en vez de caerse.
 */
export async function cuponParaCobro(code: unknown) {
  if (typeof code !== "string" || !code.trim()) return null;
  try {
    return await validarCupon(code);
  } catch {
    return null;
  }
}

/* ─────────────── Administración ─────────────── */

export async function listarCupones() {
  await requireDb();
  const cupones = await Coupon.find().sort({ createdAt: -1 });
  const usos = await ventasPorCodigo(cupones.map((c) => c.codeKey));
  return { cupones: cupones.map((c) => vistaAdmin(c, usos.get(c.codeKey))), baseCents: currentCents() };
}

interface DatosCupon {
  code?: unknown;
  percent?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  maxUses?: unknown;
  note?: unknown;
  active?: unknown;
}

function leerPorcentaje(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_PERCENT || n > MAX_PERCENT) {
    throw new CustomError(`El descuento tiene que ser un número entero entre ${MIN_PERCENT}% y ${MAX_PERCENT}%`, 400);
  }
  return n;
}

function leerFecha(v: unknown, campo: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new CustomError(`La fecha de ${campo} no es válida`, 400);
  return d;
}

function leerTope(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new CustomError("El límite de usos tiene que ser un número entero mayor a 0", 400);
  return n;
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 140) : null);

export async function crearCupon(datos: DatosCupon, autor: string | null) {
  await requireDb();

  const code = typeof datos.code === "string" ? datos.code.trim() : "";
  if (!CODIGO.test(code)) {
    throw new CustomError("El código lleva de 3 a 32 caracteres: letras, números, guion o guion bajo, sin espacios", 400);
  }
  if (await Coupon.exists({ codeKey: claveDe(code) })) {
    throw new CustomError(`Ya existe un cupón con el código ${code}`, 409);
  }

  const startsAt = leerFecha(datos.startsAt, "inicio") ?? new Date();
  const endsAt = leerFecha(datos.endsAt, "vencimiento");
  if (endsAt && endsAt <= startsAt) throw new CustomError("El vencimiento tiene que ser después del inicio", 400);

  const cupon = await Coupon.create({
    code,
    codeKey: claveDe(code),
    percent: leerPorcentaje(datos.percent),
    startsAt,
    endsAt,
    maxUses: leerTope(datos.maxUses),
    note: texto(datos.note),
    active: true,
    createdBy: autor,
  });

  return vistaAdmin(cupon, undefined);
}

/**
 * Edita un cupón. El código no se cambia: ya puede estar circulando en links
 * y anuncios, y renombrarlo dejaría esos links rotos sin aviso.
 */
export async function editarCupon(id: string, datos: DatosCupon) {
  await requireDb();
  const cupon = await Coupon.findById(id).catch(() => null);
  if (!cupon) throw new CustomError("Ese cupón ya no existe", 404);

  if (datos.percent !== undefined) cupon.percent = leerPorcentaje(datos.percent);
  if (datos.startsAt !== undefined) cupon.startsAt = leerFecha(datos.startsAt, "inicio") ?? cupon.startsAt;
  if (datos.endsAt !== undefined) cupon.endsAt = leerFecha(datos.endsAt, "vencimiento");
  if (datos.maxUses !== undefined) cupon.maxUses = leerTope(datos.maxUses);
  if (datos.note !== undefined) cupon.note = texto(datos.note);
  if (datos.active !== undefined) cupon.active = Boolean(datos.active);

  if (cupon.endsAt && cupon.endsAt <= cupon.startsAt) {
    throw new CustomError("El vencimiento tiene que ser después del inicio", 400);
  }

  await cupon.save();
  const usos = await ventasPorCodigo([cupon.codeKey]);
  return vistaAdmin(cupon, usos.get(cupon.codeKey));
}

/**
 * Borra el cupón. Las órdenes que lo usaron conservan el código: el historial
 * de cuánto se vendió con él no se pierde.
 */
export async function eliminarCupon(id: string) {
  await requireDb();
  const borrado = await Coupon.findByIdAndDelete(id).catch(() => null);
  if (!borrado) throw new CustomError("Ese cupón ya no existe", 404);
  return { eliminado: true };
}
