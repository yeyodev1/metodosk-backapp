import { CustomError } from "../errors/customError.error";
import { User, IUser } from "../models/User";
import { Order } from "../models/Order";
import { beneficiosDe, Beneficios } from "../config/perks";
import { presaleDeadline } from "../config/pricing";
import { dbConnect, isConnected } from "../config/mongo";
import { BOT } from "../config/telegramBot";
import {
  GRUPOS_TELEGRAM,
  GrupoTelegram,
  DefinicionGrupo,
  chatIdDe,
  telegramToken,
} from "../config/telegram";

/**
 * Telegram — la entrada automática a los grupos, conversando con el bot.
 *
 * La alumna le escribe al bot el correo con el que compró. Si existe y le
 * toca, el bot **vincula esa cuenta de Telegram al correo** y le manda un
 * enlace personal de un solo uso. Si el correo ya está vinculado a otra
 * cuenta, no da entrada: avisa quién lo usó y manda a soporte. Nadie aprueba
 * nada a mano.
 *
 * El enlace principal del grupo no se reparte nunca. Los que genera el bot
 * sirven para una sola persona, y pedir uno nuevo revoca el anterior.
 *
 * Telegram nos avisa de cada mensaje por webhook (`procesarUpdate`); el
 * resto son llamadas salientes.
 */

const API = "https://api.telegram.org";

async function telegramFetch(metodo: string, body: Record<string, unknown>): Promise<any> {
  const token = telegramToken();
  if (!token) throw new CustomError("Falta configurar TELEGRAM_BOT_TOKEN.", 503);

  const respuesta = await fetch(`${API}/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !data?.ok) {
    console.error(`[telegram] ${metodo} → ${respuesta.status}`, data?.description);
    throw new CustomError(
      "Telegram no respondió. Revisa que el bot sea administrador del grupo.",
      502,
    );
  }
  return data.result;
}

/* ── Llamadas salientes ─────────────────────────────────────────────────── */

/**
 * Un enlace para una sola persona.
 *
 * `member_limit: 1` es lo que lo vuelve personal: en cuanto alguien entra con
 * él, deja de servir. Lleva el correo como nombre para reconocerlo en el
 * panel de Telegram si hace falta.
 */
async function crearEnlace(chatId: string, nombre: string): Promise<string> {
  const resultado = await telegramFetch("createChatInviteLink", {
    chat_id: chatId,
    member_limit: 1,
    name: nombre.slice(0, 32),
  });
  return resultado.invite_link as string;
}

/** Revocar uno perdido: si alguien lo tenía, ya no le sirve. */
async function revocarEnlace(chatId: string, enlace: string): Promise<void> {
  try {
    await telegramFetch("revokeChatInviteLink", { chat_id: chatId, invite_link: enlace });
  } catch (error) {
    // Un enlace ya usado o ya revocado no impide generar el nuevo.
    console.warn("[telegram] no se pudo revocar", (error as Error).message);
  }
}

/** Si esta cuenta de Telegram ya está adentro del grupo. */
async function estaEnGrupo(chatId: string, telegramUserId: number): Promise<boolean> {
  try {
    const miembro = await telegramFetch("getChatMember", {
      chat_id: chatId,
      user_id: telegramUserId,
    });
    return ["member", "administrator", "creator", "restricted"].includes(miembro?.status);
  } catch {
    return false;
  }
}

async function enviar(chatId: number, texto: string): Promise<void> {
  await telegramFetch("sendMessage", {
    chat_id: chatId,
    text: texto,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/* ── Lo que sabe la app ─────────────────────────────────────────────────── */

/** Solo los grupos que ya están abiertos (con chat id): el resto no existe aún. */
function gruposAbiertos(): DefinicionGrupo[] {
  return GRUPOS_TELEGRAM.filter((g) => chatIdDe(g));
}

async function beneficiosDe_(user: IUser): Promise<Beneficios> {
  const primera = await Order.findOne({ email: user.email, status: "approved" })
    .sort({ createdAt: 1 })
    .lean();
  return beneficiosDe(primera?.createdAt ?? null, presaleDeadline());
}

export interface EstadoGrupo {
  id: GrupoTelegram;
  titulo: string;
  texto: string;
  /** true si a esta alumna le toca por la fecha en que compró. */
  incluido: boolean;
}

export interface EstadoTelegram {
  /** El nombre de la cuenta de Telegram vinculada, si ya pasó por el bot. */
  vinculado: string | null;
  grupos: EstadoGrupo[];
}

/** Qué grupos están abiertos, cuáles le tocan, y si ya se vinculó. */
export async function estado(userId: string): Promise<EstadoTelegram> {
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);
  const beneficios = await beneficiosDe_(user);

  return {
    vinculado: user.telegram?.userId
      ? user.telegram.nombre || user.telegram.username || "tu cuenta"
      : null,
    grupos: gruposAbiertos().map((grupo) => ({
      id: grupo.id,
      titulo: grupo.titulo,
      texto: grupo.texto,
      incluido: beneficios[grupo.beneficio],
    })),
  };
}

/* ── La conversación con el bot ─────────────────────────────────────────── */

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: TelegramUser;
  };
}

const CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nombreDe(from: TelegramUser): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
}

function fechaLarga(fecha: Date): string {
  return fecha.toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Guayaquil",
  });
}

/**
 * Un mensaje que llegó al bot.
 *
 * Nunca lanza: Telegram reintenta el webhook mientras no reciba 200, y un
 * error nuestro repetido diez veces no ayuda a nadie. Lo que falla se loguea
 * y a la alumna se le dice que intente de nuevo.
 */
export async function procesarUpdate(update: TelegramUpdate): Promise<void> {
  const mensaje = update.message;
  const from = mensaje?.from;
  if (!mensaje || !from || mensaje.chat.type !== "private" || !mensaje.text) return;

  const chatId = mensaje.chat.id;
  const texto = mensaje.text.trim();

  try {
    if (texto.startsWith("/start")) {
      await enviar(chatId, BOT.bienvenida(escapar(from.first_name || "")));
      return;
    }
    if (texto.startsWith("/ayuda") || texto.startsWith("/help")) {
      await enviar(chatId, BOT.ayuda);
      return;
    }

    const encontrado = texto.match(CORREO);
    if (!encontrado) {
      await enviar(chatId, BOT.pedirCorreo);
      return;
    }
    const correo = encontrado[0].toLowerCase();

    if (!isConnected() && !(await dbConnect())) {
      await enviar(chatId, BOT.error);
      return;
    }

    await responderCorreo(chatId, from, correo);
  } catch (error) {
    console.error("[telegram] bot:", (error as Error).message);
    await enviar(chatId, BOT.error).catch(() => {});
  }
}

async function responderCorreo(chatId: number, from: TelegramUser, correo: string) {
  const user = await User.findOne({ email: correo });
  if (!user) {
    await enviar(chatId, BOT.noEncontrado(escapar(correo)));
    return;
  }

  // Esta cuenta de Telegram ya es de otro correo: una cuenta, una compra.
  const otra = await User.findOne({ "telegram.userId": from.id, _id: { $ne: user._id } })
    .select("email")
    .lean();
  if (otra) {
    await enviar(chatId, BOT.otraCuentaTelegram(escapar(otra.email)));
    return;
  }

  const grupos = gruposAbiertos();
  if (!grupos.length) {
    await enviar(chatId, BOT.sinGrupos);
    return;
  }

  // El correo ya lo reclamó otra cuenta de Telegram: no se da entrada, se
  // cuenta lo que sabemos y se manda a soporte, que es quien puede decidir.
  if (user.telegram?.userId && user.telegram.userId !== from.id) {
    const chatPrincipal = chatIdDe(grupos[0])!;
    const dentro = await estaEnGrupo(chatPrincipal, user.telegram.userId);
    await enviar(
      chatId,
      BOT.yaVinculado(
        escapar(correo),
        escapar(user.telegram.nombre || user.telegram.username || "sin nombre"),
        fechaLarga(user.telegram.vinculadoEl || user.updatedAt),
        dentro,
      ),
    );
    return;
  }

  if (user.accessUntil && user.accessUntil < new Date()) {
    await enviar(chatId, BOT.sinAcceso(escapar(correo)));
    return;
  }

  const beneficios = await beneficiosDe_(user);

  // Primera vez: se vincula. Las siguientes solo se refrescan nombre y usuario.
  user.set("telegram.userId", from.id);
  user.set("telegram.nombre", nombreDe(from) || null);
  user.set("telegram.username", from.username || null);
  if (!user.telegram?.vinculadoEl) user.set("telegram.vinculadoEl", new Date());

  for (const grupo of grupos) {
    const telegramChatId = chatIdDe(grupo)!;

    if (!beneficios[grupo.beneficio]) {
      await enviar(chatId, BOT.costoAparte(grupo.titulo));
      continue;
    }

    if (await estaEnGrupo(telegramChatId, from.id)) {
      await enviar(chatId, BOT.yaDentro(grupo.titulo));
      continue;
    }

    const anterior = user.telegram?.enlaces?.[grupo.id]?.enlace;
    if (anterior) await revocarEnlace(telegramChatId, anterior);

    const enlace = await crearEnlace(telegramChatId, user.email);
    user.set(`telegram.enlaces.${grupo.id}`, { enlace, createdAt: new Date() });
    await enviar(chatId, BOT.entrada(grupo.titulo, enlace));
  }

  await user.save();
}
