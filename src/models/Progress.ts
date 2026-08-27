import { Schema, model, Document, Types } from "mongoose";

/**
 * Dónde va cada alumna en cada video.
 *
 * Una fila por alumna y video, no un documento por alumna con todo dentro:
 * guardar el avance cada pocos segundos sobre un documento que crece con cada
 * curso terminaría reescribiendo el historial completo en cada latido.
 *
 * `lessonId` guarda el id de la clase, o "welcome" para el video de
 * bienvenida del curso. El VSL usa el curso especial "vsl".
 */
export interface IProgress extends Document {
  user: Types.ObjectId;
  courseId: string;
  lessonId: string;
  /** Último segundo visto. */
  seconds: number;
  /** Duración del video según el reproductor. */
  duration: number | null;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

const progressSchema = new Schema<IProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    courseId: { type: String, required: true },
    lessonId: { type: String, required: true },
    seconds: { type: Number, default: 0 },
    duration: { type: Number, default: null },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Una sola fila por alumna y video: el avance se actualiza, no se acumula.
progressSchema.index({ user: 1, courseId: 1, lessonId: 1 }, { unique: true });

export const Progress = model<IProgress>("Progress", progressSchema);

/** Se da por vista a partir de acá: los créditos finales no cuentan. */
export const UMBRAL_COMPLETADO = 0.92;
