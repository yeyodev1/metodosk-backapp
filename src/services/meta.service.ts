/**
 * Envío de eventos a la Conversions API de Meta.
 *
 * Por qué existe, si el pixel del navegador ya manda los mismos eventos:
 * entre bloqueadores de anuncios, iOS y la muerte de las cookies de terceros,
 * el navegador pierde una parte grande de las conversiones. El servidor manda
 * la misma conversión con el mismo `event_id` y Meta se queda con una sola
 * (deduplicación). Lo que se gana es la compra que el navegador no reportó.
 *
 * Regla de oro: NADA de acá puede lanzar. Un fallo de medición jamás puede
 * romper una confirmación de pago. Todo error se registra y se sigue.
 */
import axios from "axios";
import { createHash } from "crypto";
import {
  isMetaEnabled,
  metaEventsUrl,
  metaTestEventCode,
  metaToken,
} from "../config/meta";

/** Nombres estándar de Meta que usa este sitio. */
export type MetaEventName =
  | "PageView"
  | "ViewContent"
  | "InitiateCheckout"
  | "AddPaymentInfo"
  | "Lead"
  | "CompleteRegistration"
  | "Purchase";

/** Datos de la persona. Se hashean todos menos fbp/fbc/IP/user-agent. */
export interface MetaContact {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** Cookie _fbp del navegador. */
  fbp?: string | null;
  /** Cookie _fbc, o la derivada del parámetro fbclid. */
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  /** Identificador estable nuestro (correo hasheado, id de usuario…). */
  externalId?: string | null;
}

export interface MetaEventInput {
  eventName: MetaEventName;
  /**
   * El MISMO id que usó el navegador para este evento. Es lo único que evita
   * que Meta cuente la conversión dos veces.
   */
  eventId: string;
  eventSourceUrl?: string | null;
  contact?: MetaContact;
  value?: number;
  currency?: string;
  contentIds?: string[];
  contentName?: string | null;
  contentType?: string;
  /** Unix en segundos. Meta rechaza eventos de más de 7 días. */
  eventTime?: number;
}

const SHA256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Meta exige minúsculas y sin espacios antes de hashear. */
function hashText(value?: string | null): string | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized ? SHA256(normalized) : undefined;
}

/**
 * Teléfono: solo dígitos, con código de país y sin el "+".
 * Un +593 99 525 4965 tiene que llegar como 593995254965 o no cruza con nadie.
 */
function hashPhone(value?: string | null): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? SHA256(digits) : undefined;
}

/**
 * Nombre y apellido van por separado. Se parte por el primer espacio: es una
 * aproximación, pero un "María Fernanda Pérez" cruza mejor con fn=maría que
 * sin nada.
 */
function splitName(value?: string | null): { fn?: string; ln?: string } {
  const partes = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return {};
  if (partes.length === 1) return { fn: hashText(partes[0]) };
  return {
    fn: hashText(partes[0]),
    ln: hashText(partes.slice(1).join(" ")),
  };
}

function buildUserData(contact: MetaContact = {}): Record<string, unknown> {
  const { fn, ln } = splitName(contact.name);

  const data: Record<string, unknown> = {
    em: hashText(contact.email),
    ph: hashPhone(contact.phone),
    fn,
    ln,
    // Ecuador: subir el país mejora el cruce y no identifica a nadie de más.
    country: hashText("ec"),
    external_id: contact.externalId
      ? hashText(contact.externalId)
      : hashText(contact.email),
    fbp: contact.fbp || undefined,
    fbc: contact.fbc || undefined,
    client_ip_address: contact.clientIp || undefined,
    client_user_agent: contact.userAgent || undefined,
  };

  // Meta penaliza la calidad del cruce si se mandan claves vacías.
  for (const clave of Object.keys(data)) {
    if (data[clave] === undefined || data[clave] === null || data[clave] === "") {
      delete data[clave];
    }
  }

  return data;
}

function buildCustomData(input: MetaEventInput): Record<string, unknown> | undefined {
  const custom: Record<string, unknown> = {};

  if (typeof input.value === "number" && Number.isFinite(input.value)) {
    custom.value = Number(input.value.toFixed(2));
    custom.currency = input.currency || "USD";
  }
  if (input.contentIds?.length) {
    custom.content_ids = input.contentIds;
    custom.content_type = input.contentType || "product";
  }
  if (input.contentName) custom.content_name = input.contentName;

  return Object.keys(custom).length ? custom : undefined;
}

/**
 * Manda un evento y devuelve si Meta lo aceptó.
 *
 * No se espera en el camino crítico: quien confirma un pago no puede esperar
 * a Facebook. Se llama sin await desde el flujo de compra.
 */
export async function sendMetaEvent(input: MetaEventInput): Promise<boolean> {
  if (!isMetaEnabled()) return false;

  const evento: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    // "website": la persona está en la web, aunque el evento salga del servidor.
    action_source: "website",
    event_source_url: input.eventSourceUrl || "https://metodosk.ec/",
    user_data: buildUserData(input.contact),
  };

  const custom = buildCustomData(input);
  if (custom) evento.custom_data = custom;

  const payload: Record<string, unknown> = {
    data: [evento],
    access_token: metaToken(),
  };

  const testCode = metaTestEventCode();
  if (testCode) payload.test_event_code = testCode;

  try {
    const { data } = await axios.post(metaEventsUrl(), payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 8000,
    });
    console.log(
      `[meta] ${input.eventName} enviado (${input.eventId}) — recibidos: ${
        (data as { events_received?: number })?.events_received ?? "?"
      }`,
    );
    return true;
  } catch (error) {
    const detalle =
      (error as { response?: { data?: unknown } })?.response?.data ??
      (error as Error).message;
    console.error(`[meta] falló ${input.eventName} (${input.eventId}):`, detalle);
    return false;
  }
}

/**
 * Dispara sin bloquear. En serverless la invocación puede terminar antes de
 * que la promesa resuelva, así que en el flujo de compra —donde el evento
 * importa de verdad— se usa `await sendMetaEvent`.
 */
export function fireMetaEvent(input: MetaEventInput): void {
  void sendMetaEvent(input).catch(() => undefined);
}

/**
 * El id del evento de compra sale de la transacción, no de un aleatorio.
 *
 * Así el navegador y el servidor llegan al mismo id sin tener que pasárselo,
 * y Meta deduplica aunque la compradora recargue la página de resultado.
 * La misma fórmula está en metodosk-frontapp/src/config/meta.ts.
 */
export function purchaseEventId(clientTransactionId: string): string {
  return `purchase-${clientTransactionId}`;
}
