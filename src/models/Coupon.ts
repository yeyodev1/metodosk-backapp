import { Schema, model, Document } from "mongoose";

/**
 * Un cupón de descuento sobre el precio del reto.
 *
 * El código se guarda dos veces: `code` tal como lo escribió la
 * administración (es el que sale en el link y en el checkout, con sus
 * mayúsculas) y `codeKey` en mayúsculas, que es contra el que se busca. Así
 * "primermessk1000" escrito a mano en el checkout encuentra "PrimerMesSk1000".
 *
 * Las ventas no se cuentan acá: se cuentan en las órdenes (`couponCode`). Un
 * contador propio se descuadraría con cada confirmación repetida o reversada,
 * y las órdenes ya son la fuente de verdad de quién pagó.
 */
export interface ICoupon extends Document {
  code: string;
  codeKey: string;
  /** Porcentaje de descuento, entero entre 1 y 90. */
  percent: number;
  /** Desde cuándo vale. */
  startsAt: Date;
  /** Hasta cuándo vale; null = sin vencimiento. */
  endsAt: Date | null;
  /** Tope de ventas con el cupón; null = sin tope. */
  maxUses: number | null;
  /** false = pausado a mano. */
  active: boolean;
  /** Para qué se creó, p. ej. "Campaña octubre". */
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, trim: true },
    codeKey: { type: String, required: true, unique: true, index: true },
    percent: { type: Number, required: true, min: 1, max: 90 },
    startsAt: { type: Date, required: true, default: () => new Date() },
    endsAt: { type: Date, default: null },
    maxUses: { type: Number, default: null },
    active: { type: Boolean, default: true },
    note: { type: String, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true },
);

export const Coupon = model<ICoupon>("Coupon", couponSchema);
