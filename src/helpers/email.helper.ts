import { Resend } from "resend";
import { GRUPOS_RECURSOS, GrupoRecursos, recursosUrl } from "../config/recursos";

/**
 * Correos transaccionales del reto, vía Resend.
 *
 * El dominio metodosk.ec ya tiene DKIM y SPF configurados, así que se envía
 * desde una dirección propia y no desde el dominio compartido de pruebas.
 */

const DEFAULT_FROM = "Método SK <hola@metodosk.ec>";

let client: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

function sender(): string {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface AccessEmailInput {
  to: string;
  name?: string | null;
  /** Nombre del reto comprado, p. ej. "SK Recomposición". */
  challenge?: string | null;
  amountCents: number;
  accessMonths: number;
  accessUntil: Date;
  authorizationCode?: string | null;
  /** Contraseña recién generada. Solo va en el correo de la primera compra. */
  password?: string | null;
}

/** Dónde entra la compradora. */
function loginUrl(): string {
  const base = (process.env.SITE_URL || "https://metodosk.ec").replace(/\/$/, "");
  return `${base}/login`;
}

/**
 * Confirmación de compra con el acceso al reto.
 *
 * Nunca lanza: un fallo de correo no puede tumbar la confirmación del pago,
 * porque PayPhone reversa la transacción si no respondemos a tiempo.
 */
export async function sendAccessEmail(input: AccessEmailInput): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY no definida — no se envía el correo");
    return false;
  }
  if (!input.to) {
    console.warn("[email] la transacción no trae correo — no se envía");
    return false;
  }

  const firstName = (input.name || "").trim().split(/\s+/)[0] || "";
  const saludo = firstName ? `¡Hola ${firstName}!` : "¡Hola!";
  const reto = input.challenge || "el reto";

  try {
    const { data, error } = await resend.emails.send({
      from: sender(),
      to: input.to,
      subject: `Tu acceso a ${reto} — Método SK`,
      html: accessHtml({ ...input, saludo, reto }),
      text: accessText({ ...input, saludo, reto }),
    });

    if (error) {
      console.error("[email] Resend rechazó el envío:", error);
      return false;
    }

    // Dejar rastro del envío: sin esto no hay forma de auditar después si el
    // correo de una compra salió o no.
    console.log(`[email] acceso enviado a ${input.to} · resend_id=${data?.id ?? "?"}`);
    return true;
  } catch (error) {
    console.error("[email] no se pudo enviar la confirmación:", error);
    return false;
  }
}

function accessText(i: AccessEmailInput & { saludo: string; reto: string }): string {
  return [
    i.saludo,
    "",
    `Tu pago quedó confirmado y ya estás dentro de ${i.reto}.`,
    "",
    `Reto: ${i.reto}`,
    `Pago: ${formatUsd(i.amountCents)} USD`,
    `Acceso: ${i.accessMonths} meses, hasta el ${formatDate(i.accessUntil)}`,
    i.authorizationCode ? `Autorización: ${i.authorizationCode}` : "",
    "",
    "TUS DATOS PARA ENTRAR",
    `Entra aquí: ${loginUrl()}`,
    `Usuario: ${i.to}`,
    i.password ? `Contraseña: ${i.password}` : "Contraseña: la que ya creaste",
    i.password ? "Cámbiala cuando entres." : "",
    "",
    "LO QUE VAS A NECESITAR",
    recursosText(),
    "",
    "En las próximas horas te escribimos por WhatsApp para darte la bienvenida",
    "y entregarte el plan de entrenamiento y nutrición.",
    "",
    "Scarlet Córdova y Karen López",
    "Método SK",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Los implementos que hay que conseguir antes de empezar.
 *
 * Van los dos casos —casa y gimnasio— en el mismo bloque porque al momento de
 * comprar todavía no sabemos dónde entrena cada quien, y preguntarlo costaría
 * un paso más en el checkout. Dos listas cortas se leen de un vistazo.
 */
/** La misma lista, para el texto plano. */
function recursosText(): string {
  return GRUPOS_RECURSOS.map(
    (g) =>
      `${g.titulo}: ${g.intro}\n` +
      g.recursos.map((r) => `  - ${r.nombre}. ${r.detalle}`).join("\n"),
  ).join("\n\n");
}

function recursosHtml(): string {
  const grupo = (g: GrupoRecursos) => `
    <div style="margin-bottom:16px;">
      <div style="color:#191413;font-size:14px;font-weight:600;margin-bottom:2px;">${g.titulo}</div>
      <div style="color:#8a8078;font-size:13px;line-height:1.5;margin-bottom:8px;">${g.intro}</div>
      ${g.recursos
        .map(
          (r) => `
        <div style="padding:8px 0;border-top:1px solid #ece4dc;">
          <div style="color:#191413;font-size:14px;font-weight:600;">${r.nombre}</div>
          <div style="color:#5c534c;font-size:13px;line-height:1.5;">${r.detalle}</div>
        </div>`,
        )
        .join("")}
    </div>`;

  return `
    <div style="margin:0 0 20px;padding:18px 20px;border-radius:12px;background:#f6f1ec;">
      <div style="color:#8a8078;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;">Lo que vas a necesitar</div>
      ${GRUPOS_RECURSOS.map(grupo).join("")}
      <a href="${recursosUrl()}" style="display:block;margin-top:4px;padding:12px 20px;border-radius:999px;border:1px solid #d9cec4;color:#191413;font-size:13px;font-weight:600;text-align:center;text-decoration:none;">
        Ver la lista completa
      </a>
    </div>`;
}

function accessHtml(i: AccessEmailInput & { saludo: string; reto: string }): string {
  const fila = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 0;color:#8a8078;font-size:13px;">${label}</td>
      <td style="padding:10px 0;color:#191413;font-size:15px;text-align:right;font-weight:600;">${value}</td>
    </tr>`;

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f6f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ec;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdfb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#191413;padding:28px 32px;">
                <div style="color:#f3d9cf;font-size:12px;letter-spacing:.12em;text-transform:uppercase;">Método SK · ${i.accessMonths} meses</div>
                <div style="color:#fffdfb;font-size:26px;margin-top:6px;">Ya estás dentro</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 14px;color:#191413;font-size:16px;">${i.saludo}</p>
                <p style="margin:0 0 20px;color:#5c534c;font-size:15px;line-height:1.6;">
                  Tu pago quedó confirmado y tu cupo en <strong>${i.reto}</strong> está asegurado.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ece4dc;border-bottom:1px solid #ece4dc;margin-bottom:20px;">
                  ${fila("Reto", i.reto)}
                  ${fila("Pago", `${formatUsd(i.amountCents)} USD`)}
                  ${fila("Acceso hasta", formatDate(i.accessUntil))}
                  ${i.authorizationCode ? fila("Autorización", i.authorizationCode) : ""}
                </table>

                <div style="margin:0 0 20px;padding:18px 20px;border-radius:12px;background:#f6f1ec;">
                  <div style="color:#8a8078;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">Tus datos para entrar</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:4px 0;color:#8a8078;font-size:13px;">Usuario</td>
                      <td style="padding:4px 0;color:#191413;font-size:14px;text-align:right;font-weight:600;">${i.to}</td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;color:#8a8078;font-size:13px;">Contraseña</td>
                      <td style="padding:4px 0;color:#191413;font-size:14px;text-align:right;font-weight:600;font-family:ui-monospace,Menlo,monospace;">${
                        i.password ?? "la que ya creaste"
                      }</td>
                    </tr>
                  </table>
                  <a href="${loginUrl()}" style="display:block;margin-top:14px;padding:13px 20px;border-radius:999px;background:#191413;color:#fffdfb;font-size:14px;font-weight:600;text-align:center;text-decoration:none;">
                    Entrar a mi cuenta
                  </a>
                  ${
                    i.password
                      ? '<div style="margin-top:10px;color:#8a8078;font-size:12px;text-align:center;">Cámbiala cuando entres.</div>'
                      : ""
                  }
                </div>

                ${recursosHtml()}

                <p style="margin:0 0 8px;color:#5c534c;font-size:15px;line-height:1.6;">
                  En las próximas horas te escribimos por WhatsApp para darte la bienvenida y
                  entregarte tu plan de entrenamiento y nutrición.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;color:#8a8078;font-size:13px;line-height:1.6;">
                Scarlet Córdova · entrenamiento<br />
                Karen López · nutrición
              </td>
            </tr>
          </table>
          <div style="max-width:520px;margin-top:16px;color:#a39a92;font-size:12px;">
            Recibes este correo porque compraste el reto en metodosk.ec
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * La lista de implementos, sola, para quienes compraron antes de que el correo
 * de acceso la incluyera.
 *
 * Es un envío de una sola vez por alumna: `recursosEnviados` en User marca a
 * quién ya le llegó, para que nadie lo reciba dos veces.
 */
export async function sendResourcesEmail(input: {
  to: string;
  name?: string | null;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend || !input.to) return false;

  const firstName = (input.name || "").trim().split(/\s+/)[0] || "";
  const saludo = firstName ? `¡Hola ${firstName}!` : "¡Hola!";

  try {
    const { data, error } = await resend.emails.send({
      from: sender(),
      to: input.to,
      subject: "Lo que necesitas para empezar tu reto — Método SK",
      html: resourcesHtml(saludo),
      text: [
        saludo,
        "",
        "Antes de arrancar, esto es todo lo que vas a necesitar.",
        "",
        recursosText(),
        "",
        `Lo tienes siempre a mano acá: ${recursosUrl()}`,
        "",
        "Scarlet Córdova y Karen López",
        "Método SK",
      ].join("\n"),
    });

    if (error) {
      console.error(`[email] Resend rechazó los recursos de ${input.to}:`, error);
      return false;
    }
    console.log(`[email] recursos enviados a ${input.to} · resend_id=${data?.id ?? "?"}`);
    return true;
  } catch (error) {
    console.error("[email] no se pudieron enviar los recursos:", error);
    return false;
  }
}

function resourcesHtml(saludo: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f6f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ec;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdfb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#191413;padding:28px 32px;">
                <div style="color:#f3d9cf;font-size:12px;letter-spacing:.12em;text-transform:uppercase;">Método SK</div>
                <div style="color:#fffdfb;font-size:26px;margin-top:6px;">Prepara tu equipo</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 14px;color:#191413;font-size:16px;">${saludo}</p>
                <p style="margin:0 0 20px;color:#5c534c;font-size:15px;line-height:1.6;">
                  Antes de que arranquemos, ten esto listo. No necesitas nada más:
                  el reto está diseñado para que funcione con lo mínimo.
                </p>
                ${recursosHtml()}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;color:#8a8078;font-size:13px;line-height:1.6;">
                Scarlet Córdova · entrenamiento<br />
                Karen López · nutrición
              </td>
            </tr>
          </table>
          <div style="max-width:520px;margin-top:16px;color:#a39a92;font-size:12px;">
            Recibes este correo porque compraste el reto en metodosk.ec
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
