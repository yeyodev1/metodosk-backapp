/**
 * Cuándo se abre cada bloque del reto, contado desde la compra de cada alumna.
 *
 * El reto son 12 semanas en tres bloques de cuatro: el bloque 2 (videos y
 * menú) se abre en la semana 5 y el 3 en la semana 9. Se cuenta desde el
 * inicio de cada una y no desde una fecha común porque las compras siguen
 * entrando: la que compró ayer no puede recibir el mes 2 en su primera semana.
 *
 * Se calcula acá y no en el navegador porque es lo que se paga: antes el mes lo
 * mandaba la app en la URL, y bastaba con cambiar un número para abrirlo todo.
 */

const SEMANA_MS = 7 * 86_400_000;

/** Semanas por bloque: el bloque N se abre en la semana (N - 1) * 4 + 1. */
export const SEMANAS_POR_BLOQUE = 4;

/**
 * Quienes ya estaban dentro cuando llegó el bloque 2 lo recibieron de una.
 *
 * El material llegó el 11 de octubre de 2026 y se decidió abrírselo entero a
 * todas las que ya tenían el reto, aunque no hubieran llegado a la semana 5.
 * Desde aquí, quien entra lo recibe en su semana 5, solo.
 *
 * Es el fin del 11 de octubre en Ecuador (UTC-5).
 */
export const CORTE_BLOQUE_2 = new Date("2026-10-12T05:00:00Z");

/** El reto dura 3 meses: el inicio se deduce del final del acceso. */
export function inicioDelReto(accessUntil: Date | null | undefined): Date | null {
  if (!accessUntil) return null;
  const inicio = new Date(accessUntil);
  inicio.setMonth(inicio.getMonth() - 3);
  return inicio;
}

/** En qué semana va, de 1 a 12. */
export function semanaDelReto(accessUntil: Date | null | undefined, ahora = new Date()): number {
  const inicio = inicioDelReto(accessUntil);
  if (!inicio) return 1;
  const transcurridas = Math.floor((ahora.getTime() - inicio.getTime()) / SEMANA_MS);
  return Math.min(Math.max(transcurridas + 1, 1), 12);
}

/** Cuándo se abre el bloque `mes` para esta alumna. */
export function abreElBloque(accessUntil: Date | null | undefined, mes: number): Date | null {
  const inicio = inicioDelReto(accessUntil);
  if (!inicio) return null;
  return new Date(inicio.getTime() + (mes - 1) * SEMANAS_POR_BLOQUE * SEMANA_MS);
}

/**
 * El último bloque que tiene abierto: 1, 2 o 3.
 *
 * La administración ve los tres: tiene que poder revisar el material antes de
 * que se abra.
 */
export function bloqueAbierto(
  user: { role?: string; accessUntil?: Date | null },
  ahora = new Date(),
): number {
  if (user.role === "admin") return 3;

  const semana = semanaDelReto(user.accessUntil, ahora);
  const porSemana = Math.min(Math.ceil(semana / SEMANAS_POR_BLOQUE), 3);

  const inicio = inicioDelReto(user.accessUntil);
  const yaEstaba = Boolean(inicio && inicio < CORTE_BLOQUE_2);
  return yaEstaba ? Math.max(porSemana, 2) : porSemana;
}
