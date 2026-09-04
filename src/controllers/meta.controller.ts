import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { isMetaEnabled } from "../config/meta";
import { resolveEnvironment } from "../config/environments";
import { currentCents, presaleCents, regularCents } from "../config/pricing";
import { sendMetaEvent, type MetaEventName } from "../services/meta.service";

/**
 * Espejo servidor de los eventos del pixel.
 *
 * El navegador ya los manda, pero un tercio largo de las visitas los pierde
 * (bloqueadores, iOS, modo incógnito). Acá llega el mismo evento con el mismo
 * `event_id` y Meta se queda con uno solo. Lo que se recupera es la conversión
 * que el pixel nunca reportó.
 *
 * Purchase NO está en esta lista a propósito: lo dispara el propio servidor
 * al confirmar el cobro con PayPhone, con el monto real. Si se aceptara por
 * acá, cualquiera podría inyectar compras falsas de $10.000 y desviar la
 * optimización de la campaña.
 */
const EVENTOS_PERMITIDOS: MetaEventName[] = [
  "PageView",
  "ViewContent",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Lead",
  "CompleteRegistration",
];

/** Eventos a los que sí les corresponde un monto, y cuál. */
const CON_VALOR: MetaEventName[] = ["ViewContent", "InitiateCheckout", "AddPaymentInfo", "Lead"];

/**
 * Detrás de Vercel el socket siempre es el proxy: la IP real viene en la
 * cabecera. Sin ella, todos los eventos saldrían con la misma IP y Meta
 * castigaría la calidad del cruce.
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const cadena = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const primera = (cadena || "").split(",")[0]?.trim();
  return primera || req.socket?.remoteAddress || null;
}

/**
 * Freno simple por IP, en memoria (mismo criterio que el tope de reenvíos de
 * PayPhone): en serverless aplica por instancia, y alcanza para que nadie use
 * este endpoint abierto como manguera contra el dataset.
 */
const LIMITE = 80;
const VENTANA_MS = 5 * 60 * 1000;
const registro = new Map<string, number[]>();

function dentroDelLimite(ip: string): boolean {
  const ahora = Date.now();
  const previos = (registro.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length >= LIMITE) {
    registro.set(ip, previos);
    return false;
  }
  previos.push(ahora);
  registro.set(ip, previos);
  // El mapa no crece para siempre: una instancia larga acumularía cada IP.
  if (registro.size > 5000) registro.clear();
  return true;
}

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() ? valor.trim() : null;

/** El monto del navegador vale solo si coincide con un precio real nuestro. */
function montoPermitido(valor: unknown): number | undefined {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return undefined;
  const centavos = Math.round(valor * 100);
  return centavos === presaleCents() || centavos === regularCents() ? valor : undefined;
}

/** POST /api/meta/event */
export async function track(req: Request, res: Response, next: NextFunction) {
  try {
    // Sin credenciales configuradas se responde 200: el navegador no tiene
    // por qué enterarse ni reintentar de que la medición está apagada.
    if (!isMetaEnabled()) {
      res.status(200).json({ sent: false, reason: "meta-disabled" });
      return;
    }

    // Mismo criterio que el cobro: lo que venga de un preview o un túnel no
    // entra al dataset. Un embudo de pruebas desviaría la optimización de una
    // campaña real, y eso no se puede deshacer después.
    const origen = req.headers.origin || req.headers.referer;
    if (resolveEnvironment(typeof origen === "string" ? origen : undefined) !== "prod") {
      res.status(200).json({ sent: false, reason: "entorno-de-pruebas" });
      return;
    }

    const ip = clientIp(req) ?? "desconocida";
    if (!dentroDelLimite(ip)) {
      res.status(200).json({ sent: false, reason: "rate-limited" });
      return;
    }

    const { eventName, eventId, eventSourceUrl, fbp, fbc, contact, contentIds, contentName, value } =
      req.body ?? {};

    const nombre = texto(eventName) as MetaEventName | null;
    if (!nombre || !EVENTOS_PERMITIDOS.includes(nombre)) {
      throw new CustomError("Evento no permitido", 400);
    }
    if (!texto(eventId)) {
      throw new CustomError("Falta eventId", 400);
    }

    // El monto se acepta del navegador solo si es uno de nuestros precios;
    // cualquier otra cosa se reemplaza por el vigente. Así el evento lleva el
    // importe que de verdad se está por cobrar, y nadie puede inyectar un
    // "InitiateCheckout de $10.000" que desvíe la optimización de la campaña.
    const valor = CON_VALOR.includes(nombre)
      ? montoPermitido(value) ?? currentCents() / 100
      : undefined;

    const sent = await sendMetaEvent({
      eventName: nombre,
      eventId: String(eventId),
      eventSourceUrl: texto(eventSourceUrl),
      value: valor,
      currency: "USD",
      contentIds: Array.isArray(contentIds)
        ? contentIds.filter((c: unknown) => typeof c === "string").slice(0, 4)
        : undefined,
      contentName: texto(contentName),
      contact: {
        email: texto(contact?.email),
        phone: texto(contact?.phone),
        name: texto(contact?.name),
        fbp: texto(fbp),
        fbc: texto(fbc),
        clientIp: ip,
        userAgent: texto(req.headers["user-agent"]),
      },
    });

    res.status(200).json({ sent });
  } catch (error) {
    next(error);
  }
}
