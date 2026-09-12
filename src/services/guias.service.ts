import type { AudienciaGuia, Guia } from "../config/guias";
import { Guia as GuiaModel } from "../models/Guia";
import { CustomError } from "../errors/customError.error";
import { User } from "../models/User";
import { dbConnect, isConnected } from "../config/mongo";

/**
 * Qué guía le toca a cada alumna.
 *
 * El reto decide: recomposición come en déficit y volumen en superávit, y
 * mandarle la contraria es decirle que haga lo opuesto a lo que compró. Quien
 * tiene los dos retos ve las dos.
 *
 * Se comprueba acá y no en el navegador porque es el material que se paga.
 */

async function requireDb(): Promise<void> {
  if (isConnected()) return;
  if (await dbConnect()) return;
  throw new CustomError(
    "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
    503,
  );
}

/** El nombre del reto, como viene de la compra, a la audiencia de la guía. */
function audienciaDe(challenge: string | null | undefined): AudienciaGuia | null {
  if (!challenge) return null;
  const texto = challenge.toLowerCase();
  if (texto.includes("volumen")) return "volumen";
  if (texto.includes("recompos")) return "recomposicion";
  return null;
}

export async function guiasDeAlumna(userId: string): Promise<Guia[]> {
  await requireDb();

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Cuenta no encontrada", 404);

  const guardadas = await GuiaModel.find().lean();
  const porAudiencia = new Map(guardadas.map((g) => [g.audiencia, g.contenido as Guia]));

  // La administración ve las dos: son las dueñas del material.
  if (user.role === "admin") return [...porAudiencia.values()];

  if (!user.accessUntil || user.accessUntil < new Date()) {
    throw new CustomError("Tu acceso al reto ya terminó", 403);
  }

  const retos = user.challenges?.length ? user.challenges : [user.challenge];
  const suyas = [...new Set(retos.map(audienciaDe).filter((a): a is AudienciaGuia => a !== null))];

  return suyas
    .map((a) => porAudiencia.get(a))
    .filter((g): g is Guia => Boolean(g));
}
