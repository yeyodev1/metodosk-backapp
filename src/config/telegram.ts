/**
 * Los grupos de Telegram a los que la app deja entrar sola a cada alumna.
 *
 * Hay dos prometidos en la pre-venta y cada uno tiene su propio corte: la
 * comunidad masiva es para quien compró hasta TELEGRAM_DEADLINE, y el grupo
 * chico con Scarlet y Karen solo para quien compró dentro de la pre-venta.
 * Los dos usan el mismo bot; lo que cambia es a qué chat manda.
 *
 * Un grupo sin chat id configurado no existe para la app: no se muestra ni se
 * generan enlaces. Así se puede abrir uno primero y el otro después sin tocar
 * código.
 */

export type GrupoTelegram = "comunidad" | "premium";

export interface DefinicionGrupo {
  id: GrupoTelegram;
  titulo: string;
  texto: string;
  /** Qué beneficio da derecho a entrar. */
  beneficio: "telegramIncluido" | "grupoPremium";
  envChatId: string;
}

export const GRUPOS_TELEGRAM: DefinicionGrupo[] = [
  {
    id: "comunidad",
    titulo: "Comunidad en Telegram",
    texto:
      "El grupo grande del reto: todas las alumnas, el equipo y los avisos de cada semana.",
    beneficio: "telegramIncluido",
    envChatId: "TELEGRAM_COMUNIDAD_CHAT_ID",
  },
  {
    id: "premium",
    titulo: "Grupo VIP con Scarlet y Karen",
    texto:
      "Un grupo aparte y mucho más chico, donde ellas dos responden directamente.",
    beneficio: "grupoPremium",
    envChatId: "TELEGRAM_PREMIUM_CHAT_ID",
  },
];

/** El usuario del bot, sin arroba. */
export const BOT_USERNAME = "metodosk_bot";

/**
 * El enlace que abre el bot. Con token, el bot reconoce a la alumna al
 * primer toque y no le pide el correo; sin token, se lo pide.
 */
export function botUrl(token?: string | null): string {
  return `https://t.me/${BOT_USERNAME}?start=${token || "app"}`;
}

export function telegramToken(): string | null {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  return token || null;
}

/** El chat id del grupo, o null si todavía no está abierto. */
export function chatIdDe(grupo: DefinicionGrupo): string | null {
  const id = (process.env[grupo.envChatId] || "").trim();
  return id || null;
}

export function definicionDe(id: string): DefinicionGrupo | null {
  return GRUPOS_TELEGRAM.find((g) => g.id === id) ?? null;
}
