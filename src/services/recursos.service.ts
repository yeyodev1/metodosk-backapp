import { User } from "../models/User";
import { Setting } from "../models/Setting";
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
 * Cuántos correos por corrida.
 *
 * Resend permite 100 al día en el plan gratuito y hay ~50 pendientes, así que
 * con 60 el grupo entero se vacía en una sola corrida. Se eligió ese número
 * porque no sabemos con qué frecuencia corre el cron —depende del plan de
 * Vercel—: si resultara ser una vez al día, con 40 el envío tardaría dos días
 * y con 60 termina hoy.
 *
 * No sube más para dejar 40 libres: si la cuota se agota, el correo de una
 * compra nueva no sale, y ese lleva la contraseña de la alumna.
 */
const POR_TANDA = 60;

/** Entre correo y correo. El límite de Resend son 10 por segundo. */
const PAUSA_MS = 250;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cuándo empezó a salir el correo con las fotos de los implementos.
 *
 * Las fotos se desplegaron a las 10:52 del 5 de septiembre. La tanda de las
 * 10:00 —unas 40 alumnas— salió antes, con las listas correctas pero sin
 * imágenes. A quien lo recibió antes de este corte se le vuelve a mandar.
 */
const CORTE_FOTOS = new Date("2026-09-05T11:00:00-05:00");

/** Marca en la base de que el reenvío ya se programó. Solo ocurre una vez. */
const CLAVE_REENVIO = "recursos:reenvio-con-fotos";

/**
 * Vuelve a poner en cola a quienes recibieron la versión sin fotos.
 *
 * No manda nada por su cuenta: solo les borra la marca de "ya enviado" para
 * que la tanda normal las recoja. Así el reenvío usa el mismo camino, el
 * mismo ritmo y el mismo tope que el envío original, en vez de ser un
 * proceso aparte que haya que vigilar.
 *
 * Se ejecuta una sola vez: la marca en `Setting` es lo que impide que cada
 * corrida del cron reencole a las mismas y les mande el correo en bucle.
 */
async function programarReenvioConFotos(): Promise<number> {
  const yaHecho = await Setting.findOne({ key: CLAVE_REENVIO }).lean();
  if (yaHecho) return 0;

  // La marca va ANTES de reencolar. Si algo falla a mitad, el peor caso es
  // que alguien no reciba el reenvío; el peor caso al revés sería un bucle
  // de correos, y eso no se puede deshacer.
  await Setting.findOneAndUpdate(
    { key: CLAVE_REENVIO },
    { key: CLAVE_REENVIO, value: { programadoEn: new Date(), corte: CORTE_FOTOS } },
    { upsert: true },
  );

  const { modifiedCount } = await User.updateMany(
    { recursosEnviados: { $ne: null, $lt: CORTE_FOTOS } },
    { $set: { recursosEnviados: null } },
  );

  if (modifiedCount) {
    console.log(`[recursos] ${modifiedCount} alumnas reencoladas para el correo con fotos`);
  }
  return modifiedCount;
}

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
  // La primera corrida reencola a quienes recibieron la versión sin fotos.
  // Después de esa vez no hace nada, y esta llamada sale gratis.
  await programarReenvioConFotos();

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
