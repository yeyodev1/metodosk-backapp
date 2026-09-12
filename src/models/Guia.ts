import { Schema, model, Document } from "mongoose";
import type { Guia as ContenidoGuia } from "../config/guias";

/**
 * La guía de nutrición de cada reto, guardada entera.
 *
 * Vive en la base y no en el repositorio porque los repos son públicos y esto
 * es el material que las alumnas pagaron. Entra por `npm run publicar-guias`
 * desde la máquina de quien lo corre, con el JSON que no se versiona.
 *
 * El contenido se guarda tal cual, sin desarmar en colecciones: nadie consulta
 * "todos los desayunos del día 3", se lee la guía completa de una. Desarmarla
 * sería inventar una estructura que ninguna pantalla necesita.
 */
export interface IGuia extends Document {
  /** "recomposicion" | "volumen" — el reto al que pertenece. */
  audiencia: string;
  contenido: ContenidoGuia;
  createdAt: Date;
  updatedAt: Date;
}

const guiaSchema = new Schema<IGuia>(
  {
    audiencia: {
      type: String,
      enum: ["recomposicion", "volumen"],
      required: true,
      unique: true,
      index: true,
    },
    contenido: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

export const Guia = model<IGuia>("Guia", guiaSchema);
