import { User } from "../models/User";
import { Order } from "../models/Order";
import { Setting } from "../models/Setting";
import { beneficiosDe } from "../config/perks";
import { presaleDeadline } from "../config/pricing";
import { botUrl, GRUPOS_TELEGRAM, chatIdDe } from "../config/telegram";
import { sendTelegramEmail } from "../helpers/email.helper";
import { tokenDe } from "./telegram.service";

/**
 * El correo de "ya se abrió tu grupo de Telegram", a todas las que les toca.
 *
 * Misma mecánica escalonada que la lista de implementos: no sale de golpe
 * porque el plan de Resend tiene tope diario y el correo de una compra nueva
 * —que lleva la contraseña— no puede quedarse sin cuota. Lo dispara la
 * administración una sola vez con un botón; desde ahí el cron manda una tanda
 * por corrida hasta vaciar la cola, y recoge a quien compre después.
 *
 * Solo va a quien tiene el grupo incluido por su fecha de compra. A quien no
 * le toca, ni se le escribe: prometerle un grupo que después se le cobra es
 * peor que no avisarle.
 */

/**
 * Cuántos por corrida y cuántos por día.
 *
 * El plan gratuito de Resend da 100 correos al día, y ya se gastó cuota con
 * otros envíos. Con 25 por hora y 50 como tope diario, el aviso nunca se
 * come más de la mitad de la cuota: la otra mitad queda para el correo de
 * una compra nueva, que lleva la contraseña y no puede esperar. Con ~90
 * alumnas el envío termina en dos días.
 */
const POR_TANDA = 25;
const TOPE_DIARIO = 50;
const PAUSA_MS = 250;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La marca de que la administración ya dio la orden de avisar. */
const CLAVE_ACTIVADO = "telegram:aviso-activado";

export async function avisoActivado(): Promise<Date | null> {
  const marca = await Setting.findOne({ key: CLAVE_ACTIVADO }).lean();
  const valor = marca?.value as { activadoEn?: string } | null;
  return valor?.activadoEn ? new Date(valor.activadoEn) : null;
}

/** La orden de avisar. Idempotente: la segunda vez no hace nada. */
export async function activarAviso(): Promise<void> {
  await Setting.findOneAndUpdate(
    { key: CLAVE_ACTIVADO },
    { $setOnInsert: { key: CLAVE_ACTIVADO, value: { activadoEn: new Date() } } },
    { upsert: true },
  );
}

/**
 * Primera compra aprobada por correo, en una sola consulta.
 *
 * Es contra lo que se mide el beneficio: quien entró a tiempo y después
 * sumó el segundo reto no lo pierde por haber vuelto tarde.
 */
async function primerasCompras(): Promise<Map<string, Date>> {
  const filas = await Order.aggregate<{ _id: string; primera: Date }>([
    { $match: { status: "approved", email: { $ne: null } } },
    { $group: { _id: "$email", primera: { $min: "$createdAt" } } },
  ]);
  return new Map(filas.map((f) => [f._id, f.primera]));
}

interface Candidata {
  usuaria: InstanceType<typeof User>;
  incluido: boolean;
}

/** Todas las alumnas con lo que les toca, ordenadas por antigüedad. */
async function candidatas(): Promise<Candidata[]> {
  const [usuarias, primeras] = await Promise.all([
    // Las cuentas de prueba del bot no son alumnas: no se les escribe.
    User.find({
      role: "member",
      email: { $ne: null },
      clientTransactionId: { $not: /^PRUEBA-TELEGRAM-BOT/ },
    }).sort({ createdAt: 1 }),
    primerasCompras(),
  ]);
  const corte = presaleDeadline();
  return usuarias.map((usuaria) => ({
    usuaria,
    incluido: beneficiosDe(primeras.get(usuaria.email) ?? null, corte).telegramIncluido,
  }));
}

export interface EstadoAviso {
  /** Cuándo la administración dio la orden. null = todavía no. */
  activadoEn: string | null;
  /** A cuántas les toca el grupo. */
  total: number;
  enviados: number;
  pendientes: number;
  /** Alumnas a las que no les toca y por eso no se les escribe. */
  sinGrupo: number;
}

export async function estadoAviso(): Promise<EstadoAviso> {
  const [activado, todas] = await Promise.all([avisoActivado(), candidatas()]);
  const elegibles = todas.filter((c) => c.incluido);
  const enviados = elegibles.filter((c) => c.usuaria.telegramAvisoEnviado).length;
  return {
    activadoEn: activado ? activado.toISOString() : null,
    total: elegibles.length,
    enviados,
    pendientes: elegibles.length - enviados,
    sinGrupo: todas.length - elegibles.length,
  };
}

export interface ResultadoAviso {
  enviados: number;
  fallidos: number;
  pendientes: number;
}

/**
 * Manda la siguiente tanda. Si la administración no ha dado la orden, no
 * hace nada: el cron corre igual cada hora y esta es su salida temprana.
 */
export async function enviarTandaDeAviso(limite = POR_TANDA): Promise<ResultadoAviso> {
  if (!(await avisoActivado())) return { enviados: 0, fallidos: 0, pendientes: 0 };

  const todas = await candidatas();
  const pendientes = todas.filter((c) => c.incluido && !c.usuaria.telegramAvisoEnviado);

  // Lo que ya salió hoy cuenta contra el tope, venga de la corrida que venga.
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);
  const hoy = todas.filter(
    (c) => c.usuaria.telegramAvisoEnviado && c.usuaria.telegramAvisoEnviado >= inicioDelDia,
  ).length;
  const cupo = Math.max(0, Math.min(limite, TOPE_DIARIO - hoy));

  let enviados = 0;
  let fallidos = 0;

  for (const { usuaria } of pendientes.slice(0, cupo)) {
    const ok = await sendTelegramEmail({
      to: usuaria.email,
      name: usuaria.name ?? null,
      botUrl: botUrl(await tokenDe(usuaria)),
    });

    if (ok) {
      usuaria.telegramAvisoEnviado = new Date();
      await usuaria.save();
      enviados++;
    } else {
      fallidos++;
    }
    await esperar(PAUSA_MS);
  }

  return { enviados, fallidos, pendientes: pendientes.length - enviados };
}

/**
 * La entrada para el correo de compra de quien acaba de pagar.
 *
 * Devuelve su enlace con llave si el grupo ya está abierto, la administración
 * ya dio la orden de avisar y a ella le toca; y la deja marcada como avisada
 * para que la tanda de la hora no le mande el mismo aviso otra vez. Si algo
 * de eso no se cumple, null: el correo de compra sale como siempre.
 *
 * Nunca lanza: un tropiezo acá no puede frenar el correo de la contraseña.
 */
export async function entradaParaCorreoDeCompra(email: string): Promise<string | null> {
  try {
    const hayGrupo = GRUPOS_TELEGRAM.some((g) => chatIdDe(g));
    if (!hayGrupo || !(await avisoActivado())) return null;

    const normalizado = email.toLowerCase().trim();
    const usuaria = await User.findOne({ email: normalizado });
    if (!usuaria) return null;

    const primera = await Order.findOne({ email: normalizado, status: "approved" })
      .sort({ createdAt: 1 })
      .lean();
    const { telegramIncluido } = beneficiosDe(primera?.createdAt ?? null, presaleDeadline());
    if (!telegramIncluido) return null;

    const enlace = botUrl(await tokenDe(usuaria));
    usuaria.telegramAvisoEnviado = new Date();
    await usuaria.save();
    return enlace;
  } catch (error) {
    console.error("[telegram] no se pudo preparar la entrada para el correo de compra:", error);
    return null;
  }
}
