import { Schema, model, Document } from "mongoose";

/**
 * Registro de cada intento de cobro confirmado con PayPhone.
 * Es el único rastro de quién compró, así que se guarda siempre que haya
 * base de datos configurada.
 */
export interface IOrder extends Document {
  clientTransactionId: string;
  payphoneTransactionId: string | null;
  status: "approved" | "canceled" | "failed";
  /** Monto confirmado por PayPhone, en centavos. */
  amountCents: number;
  /** false si el monto no coincide con ninguno de nuestros precios. */
  amountVerified: boolean;
  currency: string;
  authorizationCode: string | null;
  environment: "test" | "prod";
  email: string | null;
  phoneNumber: string | null;
  cardHolder: string | null;
  accessMonths: number;
  accessUntil: Date | null;
  payphoneResponse: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    clientTransactionId: { type: String, required: true, unique: true, index: true },
    payphoneTransactionId: { type: String, default: null },
    status: {
      type: String,
      enum: ["approved", "canceled", "failed"],
      required: true,
    },
    amountCents: { type: Number, required: true },
    amountVerified: { type: Boolean, default: false },
    currency: { type: String, default: "USD" },
    authorizationCode: { type: String, default: null },
    environment: { type: String, enum: ["test", "prod"], default: "prod" },
    email: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    cardHolder: { type: String, default: null },
    accessMonths: { type: Number, default: 3 },
    accessUntil: { type: Date, default: null },
    payphoneResponse: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const Order = model<IOrder>("Order", orderSchema);
