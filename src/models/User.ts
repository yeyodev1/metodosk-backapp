import { Schema, model, Document } from "mongoose";

/**
 * Cuentas que entran al panel. Por ahora solo administración: las compradoras
 * no tienen cuenta todavía.
 */
export interface IUser extends Document {
  email: string;
  /** Hash bcrypt. La contraseña en claro nunca se guarda. */
  password: string;
  name: string;
  role: "admin";
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
    name: { type: String, default: "Administración" },
    role: { type: String, enum: ["admin"], default: "admin" },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
