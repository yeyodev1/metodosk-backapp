/**
 * Lo que dice el bot cuando una alumna le escribe.
 *
 * Vive acá y no dentro del servicio por la regla del proyecto: el texto es
 * configuración. Es HTML de Telegram: solo <b>, <i>, <a> y saltos de línea.
 *
 * El tono es el de Scarlett y Karen hablándole a una alumna, no el de un
 * sistema: cálido, con emojis, y cuando algo no se puede resolver solo, se
 * manda a sus Instagram, que hoy son el único canal de soporte.
 */

const IG_SCARLETT =
  (process.env.SOPORTE_IG_SCARLETT || "https://www.instagram.com/scarlettcordova9").trim();
const IG_KAREN =
  (process.env.SOPORTE_IG_KAREN || "https://www.instagram.com/nutricionistakarenlopez").trim();

/** "escríbele a Scarlett o a Karen por Instagram", con los dos enlaces. */
function soporte(): string {
  return `escríbele a <a href="${IG_SCARLETT}">Scarlett</a> o a <a href="${IG_KAREN}">Karen</a> por Instagram 💌`;
}

const FIRMA = `\n\nCon cariño,\n<b>Scarlett Córdova & Karen López</b> 💖`;

export const BOT = {
  bienvenida: (nombre: string) =>
    `¡Hola${nombre ? `, ${nombre}` : ""}! 💖 ¡Bienvenida al <b>Método SK</b>! ✨\n\n` +
    `Aquí te damos la entrada a tu grupo con <b>Scarlett Córdova</b> y <b>Karen López</b> 🏋️‍♀️🥗\n\n` +
    `Escríbeme el <b>correo con el que te inscribiste en metodosk.ec</b> 📩 y te busco en un segundo.`,

  /** Llegó con su llave desde el correo o la app: no hay que pedirle nada. */
  bienvenidaConLlave: (nombre: string) =>
    `¡Hola${nombre ? `, ${nombre}` : ""}! 💖 ¡Bienvenida al <b>Método SK</b>! ✨\n\n` +
    `Ya sé quién eres, un segundito que te busco tu entrada… 🔎`,

  ayuda:
    `Esto es lo que puedo hacer por ti 💫\n\n` +
    `📩 Busco tu compra con el correo que usaste en metodosk.ec\n` +
    `🔑 Si te toca, te mando tu <b>enlace personal</b> al grupo. Sirve una sola vez\n` +
    `💬 Si ya entraste y no lo encuentras, te digo dónde buscar el grupo\n` +
    `🚫 Si ese correo ya lo usó otra cuenta de Telegram, te aviso\n\n` +
    `Para cualquier otra cosa, ${soporte()}\n\n` +
    `Para empezar, escríbeme tu correo 👇`,

  pedirCorreo:
    `Para buscarte necesito el correo con el que compraste en metodosk.ec 📩\n\n` +
    `Escríbelo tal cual, por ejemplo: <i>maria@gmail.com</i> 😊`,

  buscando: `Un segundito, te busco… 🔎✨`,

  noEncontrado: (correo: string) =>
    `Mmm, no encontré <b>${correo}</b> entre las alumnas del reto 🥺\n\n` +
    `Revisa que sea el mismo correo con el que pagaste, a veces es otro 😉 Si estás segura de que es ese, ${soporte()} y lo resolvemos juntas.`,

  sinAcceso: (correo: string) =>
    `Encontré <b>${correo}</b>, pero su acceso al reto ya no está vigente 😔\n\n` +
    `Si crees que es un error, ${soporte()} y lo revisamos contigo.`,

  otraCuentaTelegram: (correoVinculado: string) =>
    `Esta cuenta de Telegram ya está vinculada a <b>${correoVinculado}</b> 🔗\n\n` +
    `Cada compra se vincula a una sola cuenta de Telegram. Si necesitas cambiarla, ${soporte()}.`,

  yaVinculado: (correo: string, nombre: string, fecha: string, dentro: boolean) =>
    `Ay, ya hay alguien vinculado con <b>${correo}</b> 🥺\n\n` +
    `Lo que tengo: la cuenta de Telegram <b>${nombre}</b> se vinculó el ${fecha}` +
    (dentro ? ` y ya está dentro del grupo ✅` : `, aunque todavía no ha entrado al grupo ⏳`) +
    `\n\nSi eres tú desde otra cuenta, o no reconoces a esa persona, ${soporte()} y lo revisamos contigo 🤍`,

  sinGrupos:
    `Los grupos todavía no están abiertos 🔒 En cuanto Scarlett y Karen los abran, te aviso por aquí mismo 💬✨`,

  yaDentro: (grupo: string) =>
    `¡Ya estás dentro de <b>${grupo}</b>! ✅💖 Búscalo en tus chats de Telegram y nos vemos ahí 🏋️‍♀️`,

  entrada: (grupo: string, enlace: string) =>
    `¡Te encontré! 🎉💖 Esta es tu entrada a <b>${grupo}</b>:\n\n` +
    `👉 ${enlace}\n\n` +
    `<i>Es personal y sirve para una sola entrada 🔑 No la compartas: si alguien más la usa, tú te quedas afuera.</i>\n\n` +
    `Scarlett y Karen te esperan adentro 🥰` +
    FIRMA,

  costoAparte: (grupo: string) =>
    `<b>${grupo}</b> no está incluido en tu compra 💭\n\n` +
    `Si quieres sumarte, ${soporte()} y te cuentan cómo 🤍`,

  error: `Uy, algo falló de mi lado 😓 Intenta de nuevo en un momentito, porfa 🙏`,
} as const;
