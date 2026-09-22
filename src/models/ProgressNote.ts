import { Schema, model, Document, Types } from "mongoose";
import { FIRMAS, Firma } from "../config/firmas";

/**
 * La conversación privada sobre el avance de una alumna.
 *
 * Karen o Scarlett miran sus fotos y le dejan una recomendación; ella puede
 * contestar. No va en el modelo `Comment`: aquellos cuelgan de un video y los
 * lee todo el reto; estos hablan de su cuerpo y solo los ven ella y la
 * administración.
 *
 * Una fila por mensaje y no un arreglo dentro de `User`: el usuario ya carga
 * fotos, medidas y Telegram, y cada respuesta reescribiría el documento entero.
 */
export interface IProgressNote extends Document {
  /** La alumna dueña de la conversación. */
  alumna: Types.ObjectId;
  /** Quién lo escribió: una cuenta admin, o ella misma. */
  autor: Types.ObjectId;
  fromStaff: boolean;
  /**
   * Con qué nombre sale el mensaje del equipo.
   *
   * Se elige al escribir y no se deduce de la cuenta: el panel se usa desde
   * una sola cuenta de administración, y la recomendación de nutrición tiene
   * que llegar firmada por Karen aunque la haya escrito alguien del equipo.
   */
  firma: Firma | null;
  body: string;
  /** La toma de fotos que se estaba mirando al escribir. null en sus respuestas. */
  tomaDel: Date | null;
  /**
   * Cuándo lo leyó la otra parte: ella, si es del equipo; el equipo, si es
   * suyo. Es lo que pinta "Nuevo" en cada lado.
   */
  leidaEl: Date | null;
  /** Cuándo salió el correo de aviso. null = pendiente (lo reintenta el cron). */
  avisoEnviadoEl: Date | null;
  /** Intentos fallidos de aviso: a los tres se deja de insistir. */
  avisoIntentos: number;
  createdAt: Date;
  updatedAt: Date;
}

const progressNoteSchema = new Schema<IProgressNote>(
  {
    alumna: { type: Schema.Types.ObjectId, ref: "User", required: true },
    autor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromStaff: { type: Boolean, required: true },
    firma: { type: String, enum: [...Object.keys(FIRMAS), null], default: null },
    body: { type: String, required: true, maxlength: 3000 },
    tomaDel: { type: Date, default: null },
    leidaEl: { type: Date, default: null },
    avisoEnviadoEl: { type: Date, default: null },
    avisoIntentos: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// La conversación de una alumna, en orden.
progressNoteSchema.index({ alumna: 1, createdAt: 1 });
// Lo que busca el cron: avisos del equipo que no salieron.
progressNoteSchema.index({ fromStaff: 1, avisoEnviadoEl: 1, createdAt: -1 });

export const ProgressNote = model<IProgressNote>("ProgressNote", progressNoteSchema);

export const MAX_LARGO_NOTA = 3000;
