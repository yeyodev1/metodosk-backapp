import { Schema, model, Document, Types } from "mongoose";

/**
 * El muro de la comunidad.
 *
 * Es distinto de `Comment`: aquel cuelga de un video concreto porque una duda
 * sobre la sentadilla no sirve tres pantallas más allá. Este no cuelga de nada
 * — es la conversación del grupo, la que en un chat de WhatsApp pasaría
 * mezclada con todo lo demás. Por eso vive en su propia colección: no comparte
 * ni las consultas ni la moderación con los hilos de los videos.
 *
 * Se guarda el nombre y el avatar con los que se publicó, no solo la
 * referencia a la cuenta: si mañana cambia su foto, los mensajes de hace un
 * mes no se reescriben solos.
 */
export interface ICommunityPost extends Document {
  user: Types.ObjectId;
  authorName: string;
  /** Foto de perfil al momento de publicar. null = se pinta su inicial. */
  authorAvatar: string | null;
  body: string;
  /** Mensaje de Scarlet o Karen. Se pinta distinto. */
  fromStaff: boolean;
  /** Oculto por la administración. No se borra: se deja de mostrar. */
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const communityPostSchema = new Schema<ICommunityPost>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    authorName: { type: String, default: "" },
    authorAvatar: { type: String, default: null },
    body: { type: String, required: true, maxlength: 1000 },
    fromStaff: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Lo único que se pide: la última página del muro.
communityPostSchema.index({ createdAt: -1 });

export const CommunityPost = model<ICommunityPost>("CommunityPost", communityPostSchema);

/**
 * Un mensaje de chat, no un ensayo. El límite es corto a propósito: en un muro
 * compartido, un texto larguísimo entierra los diez de abajo.
 */
export const MAX_LARGO_POST = 1000;
