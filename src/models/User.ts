import { Schema, model, Document } from "mongoose";

/**
 * Cuentas del sitio.
 *
 * - admin  : entra al panel de compras.
 * - member : compradora. La cuenta se crea sola cuando su pago se aprueba.
 */
export type UserRole = "admin" | "member";

export interface IUser extends Document {
  email: string;
  /** Hash bcrypt. La contraseña en claro nunca se guarda. */
  password: string;
  name: string;
  phone: string | null;
  role: UserRole;
  /** El último reto comprado, p. ej. "SK Volumen". */
  challenge: string | null;
  /**
   * Todos los retos que ha comprado.
   *
   * Puede tener los dos: son planes distintos, no niveles de uno solo, y nada
   * impide comprar el segundo después. `challenge` se conserva porque es el
   * que se muestra como "tu reto" y porque ya había cuentas creadas con él.
   */
  challenges: string[];
  /** Hasta cuándo tiene acceso. null = sin acceso vigente. */
  accessUntil: Date | null;
  /** Referencia de la compra que originó la cuenta. */
  clientTransactionId: string | null;
  /** true mientras siga usando la contraseña que le enviamos por correo. */
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true },
    name: { type: String, default: "" },
    phone: { type: String, default: null },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    challenge: { type: String, default: null },
    challenges: { type: [String], default: [] },
    accessUntil: { type: Date, default: null },
    clientTransactionId: { type: String, default: null },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
