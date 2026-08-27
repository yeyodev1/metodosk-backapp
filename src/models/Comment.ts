import { Schema, model, Document, Types } from "mongoose";

/**
 * Preguntas y comentarios de las alumnas sobre un video.
 *
 * Van colgados de un video concreto (`courseId` + `lessonId`, o el VSL) y no
 * de un muro general: una duda sobre la sentadilla sirve de poco tres
 * pantallas más allá de donde se vio el ejercicio.
 *
 * Se guarda el nombre con el que se publicó, no solo la referencia a la
 * cuenta: si mañana cambia su nombre, el hilo no se reescribe solo.
 */
export interface IComment extends Document {
  user: Types.ObjectId;
  authorName: string;
  /** 'vsl' para el video de bienvenida del sitio. */
  courseId: string;
  lessonId: string;
  body: string;
  /** Respuesta de Scarlet o Karen. Se pinta distinto. */
  fromStaff: boolean;
  /** Comentario al que responde, si es una respuesta. */
  parent: Types.ObjectId | null;
  /** Oculto por la administración. No se borra: se deja de mostrar. */
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    authorName: { type: String, default: "" },
    courseId: { type: String, required: true },
    lessonId: { type: String, required: true },
    body: { type: String, required: true, maxlength: 2000 },
    fromStaff: { type: Boolean, default: false },
    parent: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Lo que más se pide: el hilo de un video, del más nuevo al más viejo.
commentSchema.index({ courseId: 1, lessonId: 1, createdAt: -1 });

export const Comment = model<IComment>("Comment", commentSchema);

export const MAX_LARGO = 2000;
