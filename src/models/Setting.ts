import { Schema, model, Document } from "mongoose";

/**
 * Ajustes sueltos del sitio que no son de nadie en particular.
 *
 * Hoy guarda uno solo: el video de bienvenida (VSL). Va en la base y no en una
 * variable de entorno porque quien lo cambia es Scarlet desde el panel, y un
 * cambio de contenido no debería necesitar un despliegue.
 */
export interface ISetting extends Document {
  key: string;
  value: unknown;
  updatedAt: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const Setting = model<ISetting>("Setting", settingSchema);

/** El video que ve quien acaba de comprar. */
export const CLAVE_VSL = "vsl";

export interface VslGuardado {
  bunnyId: string;
  status: "subiendo" | "procesando" | "listo" | "error";
  durationSeconds: number | null;
  thumbnail: string | null;
}
