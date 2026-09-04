/**
 * Recuperar el reto comprado cuando el navegador no lo mandó.
 *
 * El reto viaja en `sessionStorage` mientras PayPhone se lleva a la compradora
 * fuera del sitio, y ese almacenamiento no siempre sobrevive el regreso: los
 * navegadores dentro de Instagram y Facebook —por donde entra casi todo el
 * tráfico de los anuncios— suelen devolver a la persona en otra pestaña o
 * incluso en otro navegador, y ahí ya no hay nada guardado.
 *
 * Pero el `clientTransactionId` que armamos antes de salir lleva el reto
 * dentro: `SK-RECOMPOSICION-1757012345678-A1B2C3`. Ese id sí lo devuelve
 * PayPhone y sí queda guardado, así que sirve de respaldo.
 */

/** Los ids de reto que usa el front, con el nombre que se muestra. */
const NOMBRES: Record<string, string> = {
  RECOMPOSICION: "SK Recomposición",
  VOLUMEN: "SK Volumen",
};

/**
 * El reto que corresponde a esta transacción, o null si el id no lo dice.
 *
 * Solo se usa como respaldo: si la compradora nos mandó el reto, ese manda.
 */
export function challengeDesdeTransaccion(clientTransactionId?: string | null): string | null {
  if (!clientTransactionId) return null;
  const partes = clientTransactionId.split("-");
  // SK-<RETO>-<timestamp>-<aleatorio>
  if (partes.length < 2 || partes[0] !== "SK") return null;
  return NOMBRES[partes[1]!.toUpperCase()] ?? null;
}

/** El reto que mandó el navegador, y si no, el que dice la referencia. */
export function resolverChallenge(
  delNavegador: string | null | undefined,
  clientTransactionId: string | null | undefined,
): string | null {
  return delNavegador?.trim() || challengeDesdeTransaccion(clientTransactionId);
}
