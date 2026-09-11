import { Resend } from "resend";
import { GRUPOS_RECURSOS, GrupoRecursos, fotoUrl, recursosUrl } from "../config/recursos";
import { BOT_USERNAME } from "../config/telegram";

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
  /**
   * Su enlace al bot de Telegram con llave, si el grupo ya está abierto y le
   * toca. Con esto el correo de compra trae la entrada al grupo de una vez,
   * en lugar de esperar el aviso escalonado.
   */
  telegramBotUrl?: string | null;
  /**
   * El acceso lo dio la administración, no una compra: el correo habla de
   * acceso exclusivo y no muestra pago ni autorización.
   */
  exclusivo?: boolean;
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
      subject: input.exclusivo
        ? "Tu acceso exclusivo a Método SK 💖"
        : `Tu acceso a ${reto} — Método SK`,
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
    i.exclusivo
      ? `Scarlet y Karen te dieron acceso exclusivo a ${i.reto}, con el grupo VIP incluido.`
      : `Tu pago quedó confirmado y ya estás dentro de ${i.reto}.`,
    "",
    `Reto: ${i.reto}`,
    i.exclusivo ? "Acceso: exclusivo · VIP" : `Pago: ${formatUsd(i.amountCents)} USD`,
    `Acceso: ${i.accessMonths} meses, hasta el ${formatDate(i.accessUntil)}`,
    i.authorizationCode && !i.exclusivo ? `Autorización: ${i.authorizationCode}` : "",
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
    i.telegramBotUrl ? "TU GRUPO DE TELEGRAM 💖" : "",
    i.telegramBotUrl ? "Ya está abierto, con Scarlett y Karen. Entra por aquí (toca Iniciar y te reconoce sola):" : "",
    i.telegramBotUrl ? i.telegramBotUrl : "",
    i.telegramBotUrl ? `Si el bot te pide el correo, escríbele este: ${i.to}` : "",
    i.telegramBotUrl ? "" : "",
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
  /**
   * Cada implemento en una fila de tabla con la foto a la izquierda.
   *
   * Tabla y no flexbox porque Outlook ignora buena parte del CSS moderno y
   * apilaría todo. El `width` va como atributo además de en el estilo por la
   * misma razón.
   *
   * La foto lleva borde y fondo blanco: vienen de una tienda, con fondos
   * claros distintos entre sí, y sin eso se ven como capturas sueltas pegadas
   * sobre el crema del correo.
   */
  const item = (r: { nombre: string; detalle: string; foto: string }) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ece4dc;">
      <tr>
        <td width="88" valign="top" style="padding:12px 12px 12px 0;width:88px;">
          <img src="${fotoUrl(r.foto)}" width="88" height="66" alt="${r.nombre}"
               style="display:block;width:88px;height:66px;object-fit:contain;border-radius:8px;background:#ffffff;border:1px solid #ece4dc;" />
        </td>
        <td valign="top" style="padding:12px 0;">
          <div style="color:#191413;font-size:14px;font-weight:600;">${r.nombre}</div>
          <div style="color:#5c534c;font-size:13px;line-height:1.5;">${r.detalle}</div>
        </td>
      </tr>
    </table>`;

  const grupo = (g: GrupoRecursos) => `
    <div style="margin-bottom:18px;">
      <div style="color:#191413;font-size:15px;font-weight:600;margin-bottom:2px;">${g.titulo}</div>
      <div style="color:#8a8078;font-size:13px;line-height:1.5;margin-bottom:6px;">${g.intro}</div>
      ${g.recursos.map(item).join("")}
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
                <div style="color:#f3d9cf;font-size:12px;letter-spacing:.12em;text-transform:uppercase;">Método SK · ${
                  i.exclusivo ? "Acceso exclusivo" : `${i.accessMonths} meses`
                }</div>
                <div style="color:#fffdfb;font-size:26px;margin-top:6px;">Ya estás dentro</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 14px;color:#191413;font-size:16px;">${i.saludo}</p>
                <p style="margin:0 0 20px;color:#5c534c;font-size:15px;line-height:1.6;">
                  ${
                    i.exclusivo
                      ? `Scarlet y Karen te dieron <strong>acceso exclusivo</strong> a <strong>${i.reto}</strong>, con el grupo VIP incluido.`
                      : `Tu pago quedó confirmado y tu cupo en <strong>${i.reto}</strong> está asegurado.`
                  }
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ece4dc;border-bottom:1px solid #ece4dc;margin-bottom:20px;">
                  ${fila("Reto", i.reto)}
                  ${i.exclusivo ? fila("Acceso", "Exclusivo · VIP") : fila("Pago", `${formatUsd(i.amountCents)} USD`)}
                  ${fila("Acceso hasta", formatDate(i.accessUntil))}
                  ${i.authorizationCode && !i.exclusivo ? fila("Autorización", i.authorizationCode) : ""}
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

                ${i.telegramBotUrl ? telegramBloqueHtml(i.to, i.telegramBotUrl) : ""}

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
            ${
              i.exclusivo
                ? "Recibes este correo porque te dieron acceso al reto en metodosk.ec"
                : "Recibes este correo porque compraste el reto en metodosk.ec"
            }
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

/* ── El grupo de Telegram ya está abierto ───────────────────────────────── */

/**
 * El bloque "ingresa a tu grupo", tal cual va dentro del correo de compra.
 * Es la versión corta del correo de aviso: el mismo botón y el mismo correo
 * exacto, sin el resto.
 */
function telegramBloqueHtml(correo: string, botUrl: string): string {
  return `
                <div style="margin:0 0 20px;padding:20px;border-radius:12px;background:#191413;">
                  <div style="color:#f3d9cf;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;">Tu grupo de Telegram 💖</div>
                  <div style="color:#fffdfb;font-size:18px;margin-bottom:8px;">Ya está abierto, con Scarlett y Karen</div>
                  <p style="margin:0 0 14px;color:rgba(255,253,251,.75);font-size:14px;line-height:1.6;">
                    Tu entrada es personal. Tocas el botón, se abre nuestro bot, tocas <strong style="color:#fffdfb;">Iniciar</strong> y te manda tu enlace. ✨
                  </p>
                  <a href="${botUrl}" style="display:block;padding:14px 20px;border-radius:999px;background:#b8455a;color:#fffdfb;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-align:center;text-decoration:none;">
                    Ingresa por aquí →
                  </a>
                  <div style="margin-top:12px;color:rgba(255,253,251,.6);font-size:12px;line-height:1.6;">
                    Si el bot te pide el correo, escríbele exactamente <strong style="color:#fffdfb;">${correo}</strong>.
                  </div>
                </div>`;
}

/**
 * Aviso de que ya puede entrar al grupo.
 *
 * Lleva su enlace con llave: al tocarlo, el bot la reconoce y le manda la
 * entrada sin pedirle nada. Igual se le dice qué correo escribir, por si
 * abre Telegram por su cuenta. Nunca lanza: una tanda no se cae por un
 * correo que rebota.
 */
export async function sendTelegramEmail(input: {
  to: string;
  name?: string | null;
  botUrl: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend || !input.to) return false;

  const firstName = (input.name || "").trim().split(/\s+/)[0] || "";
  const saludo = firstName ? `¡Hola ${firstName}!` : "¡Hola!";

  try {
    const { data, error } = await resend.emails.send({
      from: sender(),
      to: input.to,
      subject: "💖 Ya se abrió tu grupo de Telegram — Método SK",
      html: telegramHtml({ saludo, correo: input.to, botUrl: input.botUrl }),
      text: [
        saludo,
        "",
        "¡Ya se abrió tu grupo de Telegram con Scarlett y Karen! 🎉",
        "",
        "Entra por aquí (te reconoce sola, solo toca Iniciar):",
        input.botUrl,
        "",
        `Si el bot te pide el correo, escríbele este: ${input.to}`,
        "",
        `También lo tienes en la plataforma, en Recursos: ${recursosUrl()}`,
        "",
        "Tu entrada es personal y sirve una sola vez. No la compartas.",
        "",
        "Con cariño,",
        "Scarlett Córdova y Karen López",
        "Método SK",
      ].join("\n"),
    });

    if (error) {
      console.error(`[email] Resend rechazó el aviso de Telegram de ${input.to}:`, error);
      return false;
    }
    console.log(`[email] aviso de Telegram enviado a ${input.to} · resend_id=${data?.id ?? "?"}`);
    return true;
  } catch (error) {
    console.error("[email] no se pudo enviar el aviso de Telegram:", error);
    return false;
  }
}

function telegramHtml(i: { saludo: string; correo: string; botUrl: string }): string {
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
                <div style="color:#fffdfb;font-size:26px;margin-top:6px;">Ya se abrió tu grupo 🎉</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 14px;color:#191413;font-size:16px;">${i.saludo} 💖</p>
                <p style="margin:0 0 22px;color:#5c534c;font-size:15px;line-height:1.6;">
                  El grupo de Telegram del reto, con <strong>Scarlett Córdova</strong> y
                  <strong>Karen López</strong>, ya está abierto. Tu entrada es personal y
                  te está esperando: tocas el botón, Telegram abre nuestro bot, tocas
                  <strong>Iniciar</strong> y listo. ✨
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 26px;">
                  <tr>
                    <td align="center" style="background:#b8455a;border-radius:999px;">
                      <a href="${i.botUrl}" style="display:inline-block;padding:16px 34px;color:#fffdfb;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;">
                        Ingresa por aquí →
                      </a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ec;border-radius:12px;">
                  <tr>
                    <td style="padding:18px 20px;color:#5c534c;font-size:14px;line-height:1.6;">
                      <strong style="color:#191413;">Si el bot te pide el correo</strong>, escríbele exactamente este:<br />
                      <span style="display:inline-block;margin-top:6px;padding:8px 12px;background:#fffdfb;border-radius:8px;color:#191413;font-size:15px;font-weight:600;">${i.correo}</span><br />
                      <span style="display:block;margin-top:10px;font-size:13px;color:#8a8078;">Es el correo con el que compraste. Con otro no te va a encontrar.</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:22px 0 0;color:#8a8078;font-size:13px;line-height:1.6;">
                  🔑 Tu entrada sirve para una sola persona. No la compartas: si alguien más
                  la usa, tú te quedas afuera.<br />
                  📱 También la tienes en la plataforma, en <a href="${recursosUrl()}" style="color:#b8455a;">Recursos</a>.
                  Y si prefieres, busca <strong>@${BOT_USERNAME}</strong> en Telegram.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;color:#8a8078;font-size:13px;line-height:1.6;">
                Con cariño,<br />
                <strong style="color:#191413;">Scarlett Córdova &amp; Karen López</strong> 💖
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

/** Solo para mirar el correo con datos de ejemplo. No manda nada. */
export function __previewTelegram(): string {
  return telegramHtml({
    saludo: "¡Hola María!",
    correo: "maria@gmail.com",
    botUrl: "https://t.me/metodosk_bot?start=ejemplo",
  });
}

/* ── Olvidé mi contraseña ─────────────────────────────────────────────── */

/**
 * El enlace para crear una contraseña nueva. Vive una hora.
 * Nunca lanza: si el correo falla, la alumna vuelve a pedirlo.
 */
export async function sendPasswordResetEmail(input: {
  to: string;
  name?: string | null;
  url: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend || !input.to) return false;

  const firstName = (input.name || "").trim().split(/\s+/)[0] || "";
  const saludo = firstName ? `¡Hola ${firstName}!` : "¡Hola!";

  try {
    const { data, error } = await resend.emails.send({
      from: sender(),
      to: input.to,
      subject: "Crea tu nueva contraseña — Método SK",
      html: resetHtml(saludo, input.url),
      text: [
        saludo,
        "",
        "Pediste una contraseña nueva para entrar a metodosk.ec.",
        "Crea la nueva desde este enlace (sirve una hora):",
        input.url,
        "",
        "Si no fuiste tú, ignora este correo: tu contraseña sigue igual.",
        "",
        "Scarlett Córdova y Karen López",
        "Método SK",
      ].join("\n"),
    });
    if (error) {
      console.error(`[email] Resend rechazó la recuperación de ${input.to}:`, error);
      return false;
    }
    console.log(`[email] recuperación enviada a ${input.to} · resend_id=${data?.id ?? "?"}`);
    return true;
  } catch (error) {
    console.error("[email] no se pudo enviar la recuperación:", error);
    return false;
  }
}

function resetHtml(saludo: string, url: string): string {
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
                <div style="color:#fffdfb;font-size:26px;margin-top:6px;">Tu nueva contraseña 🔑</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 14px;color:#191413;font-size:16px;">${saludo}</p>
                <p style="margin:0 0 22px;color:#5c534c;font-size:15px;line-height:1.6;">
                  Pediste una contraseña nueva para entrar a metodosk.ec. Toca el botón y
                  escribe la que quieras usar. El enlace sirve durante <strong>una hora</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;">
                  <tr>
                    <td align="center" style="background:#191413;border-radius:999px;">
                      <a href="${url}" style="display:inline-block;padding:15px 32px;color:#fffdfb;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;">
                        Crear mi contraseña
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#8a8078;font-size:13px;line-height:1.6;">
                  Si no fuiste tú, ignora este correo: tu contraseña sigue igual.<br />
                  Si el botón no abre, copia este enlace: <a href="${url}" style="color:#b8455a;word-break:break-all;">${url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;color:#8a8078;font-size:13px;line-height:1.6;">
                Scarlett Córdova &amp; Karen López · Método SK
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
