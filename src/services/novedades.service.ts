import crypto from "crypto";
import { Setting } from "../models/Setting";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { sendNovedadEmail } from "../helpers/email.helper";

/**
 * El aviso de "hay algo nuevo en tu reto", a todas las alumnas.
 *
 * Misma mecánica escalonada que la lista de implementos y el aviso del grupo,
 * y por la misma razón: el plan de Resend tiene tope diario y el correo de una
 * compra nueva —que lleva la contraseña— no puede quedarse sin cuota. Con 25
 * por hora y 50 al día, un aviso a ~90 alumnas termina en dos días y nunca se
 * come más de la mitad del cupo.
 *
 * Por eso tampoco se dispara con un despliegue: se escribe, se revisa y se da
 * la orden desde el panel. Un aviso atado al push saldría otra vez en cada
 * despliegue del día, y un texto equivocado no se puede recoger.
 */

const POR_TANDA = 25;
const TOPE_DIARIO = 50;
const PAUSA_MS = 250;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La novedad que está en curso. Solo hay una a la vez. */
const CLAVE = "novedad:actual";

export interface Novedad {
  /** Cambia con cada novedad nueva: es lo que marca quién ya la recibió. */
  id: string;
  titulo: string;
  texto: string;
  ctaTexto: string | null;
  ctaUrl: string | null;
  creadaEn: string;
  /** Cuándo se dio la orden de enviarla. null = escrita pero sin enviar. */
  activadaEn: string | null;
}

export async function novedadActual(): Promise<Novedad | null> {
  const fila = await Setting.findOne({ key: CLAVE }).lean();
  return (fila?.value as Novedad | undefined) ?? null;
}

/**
 * Guarda el texto del aviso, sin mandarlo.
 *
 * Escribir y enviar son dos pasos a propósito: así se puede revisar el correo
 * —y que lo lea Karen— antes de que salga a noventa personas.
 *
 * Cambiar el texto de una novedad que ya se activó crea una novedad nueva: el
 * id cambia, y quien recibió la anterior vuelve a entrar en la cola. Si no
 * fuera así, corregir una palabra dejaría a media lista con el texto viejo.
 */
export async function guardarNovedad(input: {
  titulo: string;
  texto: string;
  ctaTexto?: string | null;
  ctaUrl?: string | null;
}): Promise<Novedad> {
  const titulo = input.titulo?.trim();
  const texto = input.texto?.trim();
  if (!titulo || !texto) throw new CustomError("Escribe el título y el texto", 400);

  const actual = await novedadActual();
  // Mientras no se haya activado, se sigue editando la misma.
  const id = actual && !actual.activadaEn ? actual.id : crypto.randomBytes(6).toString("hex");

  const novedad: Novedad = {
    id,
    titulo,
    texto,
    ctaTexto: input.ctaTexto?.trim() || null,
    ctaUrl: input.ctaUrl?.trim() || null,
    creadaEn: actual && actual.id === id ? actual.creadaEn : new Date().toISOString(),
    activadaEn: null,
  };

  await Setting.findOneAndUpdate(
    { key: CLAVE },
    { key: CLAVE, value: novedad },
    { upsert: true },
  );
  return novedad;
}

/** La orden de mandarla. Idempotente: la segunda vez no reinicia nada. */
export async function activarNovedad(): Promise<Novedad> {
  const novedad = await novedadActual();
  if (!novedad) throw new CustomError("No hay ninguna novedad escrita", 400);
  if (novedad.activadaEn) return novedad;

  const activada = { ...novedad, activadaEn: new Date().toISOString() };
  await Setting.findOneAndUpdate({ key: CLAVE }, { key: CLAVE, value: activada });
  return activada;
}

/**
 * Las alumnas a las que les toca.
 *
 * Todas las compradoras con acceso vigente: una novedad del reto no tiene los
 * cortes por fecha que sí tiene el grupo de Telegram. Las cuentas de prueba
 * del bot no son alumnas y no se les escribe.
 */
async function alumnas() {
  return User.find({
    role: "member",
    email: { $ne: null },
    clientTransactionId: { $not: /^PRUEBA-TELEGRAM-BOT/ },
  }).sort({ createdAt: 1 });
}

export interface EstadoNovedad {
  novedad: Novedad | null;
  total: number;
  enviados: number;
  pendientes: number;
  /** Cuántos salieron hoy: el tope diario se mide sobre esto. */
  hoy: number;
  topeDiario: number;
}

export async function estadoNovedad(): Promise<EstadoNovedad> {
  const novedad = await novedadActual();
  const todas = await alumnas();
  if (!novedad) {
    return { novedad: null, total: todas.length, enviados: 0, pendientes: 0, hoy: 0, topeDiario: TOPE_DIARIO };
  }

  const recibidas = todas.filter((u) => u.novedades?.some((n) => n.id === novedad.id));
  return {
    novedad,
    total: todas.length,
    enviados: recibidas.length,
    pendientes: todas.length - recibidas.length,
    hoy: enviadasHoy(todas),
    topeDiario: TOPE_DIARIO,
  };
}

/** Lo que ya salió hoy cuenta contra el tope, venga de la corrida que venga. */
function enviadasHoy(todas: Array<InstanceType<typeof User>>): number {
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);
  return todas.filter((u) => u.novedades?.some((n) => n.enviadoEl >= inicioDelDia)).length;
}

export interface ResultadoNovedad {
  enviados: number;
  fallidos: number;
  pendientes: number;
}

/**
 * Manda la siguiente tanda. Si no hay novedad activada, no hace nada: el cron
 * corre igual cada hora y esta es su salida temprana.
 */
export async function enviarTandaDeNovedad(limite = POR_TANDA): Promise<ResultadoNovedad> {
  const novedad = await novedadActual();
  if (!novedad?.activadaEn) return { enviados: 0, fallidos: 0, pendientes: 0 };

  const todas = await alumnas();
  const pendientes = todas.filter((u) => !u.novedades?.some((n) => n.id === novedad.id));
  const cupo = Math.max(0, Math.min(limite, TOPE_DIARIO - enviadasHoy(todas)));

  let enviados = 0;
  let fallidos = 0;

  for (const usuaria of pendientes.slice(0, cupo)) {
    const ok = await sendNovedadEmail({
      to: usuaria.email,
      name: usuaria.name ?? null,
      titulo: novedad.titulo,
      texto: novedad.texto,
      ctaTexto: novedad.ctaTexto,
      ctaUrl: novedad.ctaUrl,
    });

    if (ok) {
      usuaria.novedades.push({ id: novedad.id, enviadoEl: new Date() });
      await usuaria.save();
      enviados++;
    } else {
      fallidos++;
    }
    await esperar(PAUSA_MS);
  }

  return { enviados, fallidos, pendientes: pendientes.length - enviados };
}
