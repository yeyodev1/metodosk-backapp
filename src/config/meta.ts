/**
 * Meta — Conversions API (CAPI).
 * https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * El token es de "usuario del sistema" y no caduca: da acceso de escritura al
 * dataset del pixel, así que vive SOLO acá. Nunca puede llevar prefijo VITE_
 * ni viajar al navegador — con él cualquiera podría inyectar conversiones
 * falsas en la cuenta publicitaria y arruinar la optimización de la campaña.
 *
 * Sin las dos variables el API funciona igual: los eventos simplemente no se
 * envían. Una integración de medición nunca puede tumbar un cobro.
 */

/** Versión de la Graph API contra la que se envían los eventos. */
export const META_API_VERSION = "v23.0";

export function metaPixelId(): string {
  return (process.env.META_PIXEL_ID || "").trim();
}

export function metaToken(): string {
  return (process.env.META_CAPI_TOKEN || "").trim();
}

/**
 * Código de "Eventos de prueba" del Administrador de eventos.
 *
 * Con él los eventos aparecen en la pestaña de pruebas y NO cuentan como
 * conversiones reales. Se deja vacío en producción: si se olvida puesto, la
 * campaña deja de recibir las compras.
 */
export function metaTestEventCode(): string | undefined {
  const code = (process.env.META_TEST_EVENT_CODE || "").trim();
  return code || undefined;
}

export function isMetaEnabled(): boolean {
  return Boolean(metaPixelId() && metaToken());
}

export function metaEventsUrl(): string {
  return `https://graph.facebook.com/${META_API_VERSION}/${metaPixelId()}/events`;
}
