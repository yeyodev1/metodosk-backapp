import { User } from "../models/User";
import { sendResourcesEmail } from "../helpers/email.helper";

/**
 * Envío escalonado de la lista de implementos a quienes ya compraron.
 *
 * Las alumnas nuevas la reciben dentro del correo de acceso; esto es solo
 * para las que compraron antes de que existiera. Va por tandas porque el plan
 * gratuito de Resend tiene tope diario: mandar 50 de golpe hoy y otras 50
 * mañana quemaría la cuota y el correo de una compra nueva —que sí es
 * urgente, porque lleva la contraseña— se quedaría sin enviar.
 */

/**
 * Cuántos correos por corrida diaria.
 *
 * El plan gratuito de Resend permite 100 al día. Se usan 40 para que siempre
 * queden 60 libres: si la cuota se agota, el correo de una compra nueva no
 * sale, y ese lleva la contraseña de la alumna.
 */
const POR_TANDA = 40;

/** Entre correo y correo. El límite de Resend son 10 por segundo. */
const PAUSA_MS = 250;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResultadoEnvio {
  enviados: number;
  fallidos: number;
  /** Cuántas quedan para las próximas corridas. */
  pendientes: number;
  detalle: { email: string; ok: boolean }[];
}

/** A quién le falta todavía. */
export async function pendientesDeRecursos(): Promise<number> {
  return User.countDocuments({ recursosEnviados: null, email: { $ne: null } });
}

/**
 * Manda la siguiente tanda y marca a quién le llegó.
 *
 * La marca se escribe solo si Resend aceptó el correo: si falló, esa alumna
 * queda pendiente y entra en la próxima corrida.
 */
export async function enviarTandaDeRecursos(limite = POR_TANDA): Promise<ResultadoEnvio> {
  const usuarias = await User.find({ recursosEnviados: null, email: { $ne: null } })
    .sort({ createdAt: 1 })
    .limit(limite);

  const detalle: { email: string; ok: boolean }[] = [];
  let enviados = 0;
  let fallidos = 0;

  for (const usuaria of usuarias) {
    const ok = await sendResourcesEmail({ to: usuaria.email, name: usuaria.name ?? null });
    detalle.push({ email: usuaria.email, ok });

    if (ok) {
      usuaria.recursosEnviados = new Date();
      await usuaria.save();
      enviados++;
    } else {
      fallidos++;
    }

    await esperar(PAUSA_MS);
  }

  return { enviados, fallidos, pendientes: await pendientesDeRecursos(), detalle };
}
