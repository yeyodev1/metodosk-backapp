/**
 * Con qué nombre puede salir un comentario del equipo sobre el avance.
 *
 * `corto` es como se nombra en el asunto del correo ("Karen comentó tu
 * avance"); `nombre` y `rol` van en la tarjeta de quien firma.
 */
export const FIRMAS = {
  karen: { nombre: "Karen López", corto: "Karen", rol: "Nutrición", inicial: "K" },
  scarlett: { nombre: "Scarlett Córdova", corto: "Scarlett", rol: "Entrenamiento", inicial: "S" },
  equipo: { nombre: "Equipo Método SK", corto: "El equipo de Método SK", rol: "Método SK", inicial: "SK" },
} as const;

export type Firma = keyof typeof FIRMAS;

export function esFirma(valor: unknown): valor is Firma {
  return typeof valor === "string" && valor in FIRMAS;
}
