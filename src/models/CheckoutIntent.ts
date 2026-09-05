import { Schema, model, Document } from "mongoose";

/**
 * Los datos que escribió la compradora, guardados ANTES de salir a PayPhone.
 *
 * El contacto viajaba solo en `sessionStorage`, que es por pestaña. PayPhone
 * se lleva a la persona fuera del sitio y los navegadores de Instagram y
 * Facebook —por donde entra casi todo el tráfico de los anuncios— la
 * devuelven en otra pestaña o en otro navegador. Ahí ese almacenamiento está
 * vacío, y la confirmación caía en el correo que PayPhone tiene registrado
 * para esa tarjeta: **otro distinto del que ella escribió**. De ahí que a
 * varias les llegaran las credenciales a un correo que no era el suyo, o que
 * no les llegara nada.
 *
 * Con esto el dato vive en el servidor desde antes del redirect, así que
 * sobrevive cualquier cosa que haga el navegador.
 */
export interface ICheckoutIntent extends Document {
  clientTransactionId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  challenge: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const checkoutIntentSchema = new Schema<ICheckoutIntent>(
  {
    clientTransactionId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: null },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    challenge: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * Se borran solos a los 30 días.
 *
 * Es un dato de paso: una vez confirmada la compra, lo que vale queda en la
 * orden y en la cuenta. Guardar correos y teléfonos de intentos que nunca se
 * completaron, para siempre, no le sirve a nadie.
 */
checkoutIntentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const CheckoutIntent = model<ICheckoutIntent>("CheckoutIntent", checkoutIntentSchema);
