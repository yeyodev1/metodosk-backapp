import { Schema, model, Document } from "mongoose";

/**
 * Un curso de la ruta del método.
 *
 * El orden es explícito y no se deduce de la fecha de creación: la ruta la
 * decide quien arma el método, no el momento en que subió cada cosa.
 *
 * `challenge` dice para quién es. Hay material que sirve a los dos retos
 * (movilidad, la guía) y material que no: mandarle a la de volumen el plan de
 * déficit sería decirle que haga lo contrario de lo que compró.
 */

export type Audiencia = "recomposicion" | "volumen" | "ambas";
export type EstadoCurso = "borrador" | "proximamente" | "publicado";

/** Video alojado en Bunny Stream. */
export interface IVideo {
  /** GUID del video en Bunny. */
  bunnyId: string;
  title: string;
  /** Bunny procesa en background: hasta que termina, no se puede reproducir. */
  status: "subiendo" | "procesando" | "listo" | "error";
  durationSeconds: number | null;
  /** Miniatura que genera Bunny. */
  thumbnail: string | null;
}

export interface ILesson {
  title: string;
  summary: string | null;
  order: number;
  video: IVideo | null;
  /** Material descargable: PDF del plan, planilla de medidas… */
  fileUrl: string | null;
}

/**
 * Una guía en PDF, guardada en Cloudinary y entregada por páginas.
 *
 * Va por audiencia y no por curso porque el material de nutrición es distinto
 * para cada reto —déficit para recomposición, superávit para volumen— y el
 * curso que las contiene es el mismo para las dos.
 */
export interface IGuia {
  audiencia: Audiencia;
  titulo: string;
  /** public_id en Cloudinary, tipo `authenticated`. Nunca sale al navegador. */
  publicId: string;
  paginas: number;
}

export interface ICourse extends Document {
  title: string;
  slug: string;
  summary: string;
  /** Para quién es este curso. */
  challenge: Audiencia;
  /** Posición en la ruta. 1 es lo primero que ve la alumna. */
  order: number;
  /** Mes del reto en que se abre: 1, 2 o 3. */
  unlockMonth: number;
  /** El video con el que arranca el curso. */
  welcomeVideo: IVideo | null;
  lessons: ILesson[];
  /** Las guías que cuelgan de este curso, una por audiencia. */
  guias: IGuia[];
  status: EstadoCurso;
  /** Foto de portada (public_id de Cloudinary). */
  coverPhoto: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const videoSchema = new Schema<IVideo>(
  {
    bunnyId: { type: String, required: true },
    title: { type: String, default: "" },
    status: {
      type: String,
      enum: ["subiendo", "procesando", "listo", "error"],
      default: "subiendo",
    },
    durationSeconds: { type: Number, default: null },
    thumbnail: { type: String, default: null },
  },
  { _id: false },
);

const lessonSchema = new Schema<ILesson>(
  {
    title: { type: String, required: true },
    summary: { type: String, default: null },
    order: { type: Number, default: 1 },
    video: { type: videoSchema, default: null },
    fileUrl: { type: String, default: null },
  },
  { _id: true },
);

const courseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    summary: { type: String, default: "" },
    challenge: {
      type: String,
      enum: ["recomposicion", "volumen", "ambas"],
      default: "ambas",
    },
    order: { type: Number, default: 1, index: true },
    unlockMonth: { type: Number, default: 1, min: 1, max: 3 },
    welcomeVideo: { type: videoSchema, default: null },
    lessons: { type: [lessonSchema], default: [] },
    guias: {
      type: [
        {
          _id: false,
          audiencia: {
            type: String,
            enum: ["recomposicion", "volumen", "ambas"],
            required: true,
          },
          titulo: { type: String, default: "" },
          publicId: { type: String, required: true },
          paginas: { type: Number, default: 1 },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["borrador", "proximamente", "publicado"],
      default: "borrador",
      index: true,
    },
    coverPhoto: { type: String, default: null },
  },
  { timestamps: true },
);

export const Course = model<ICourse>("Course", courseSchema);
