import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Order } from "../models/Order";
import { User } from "../models/User";
import { ensureMember } from "../services/auth.service";

/**
 * Una alumna de prueba para el bot de Telegram, y su borrado.
 *
 * Crea la cuenta por el mismo camino que una compra real (`ensureMember`) y
 * una orden aprobada marcada como `test`, para que los beneficios salgan
 * como los de cualquier compradora. No manda correo ni toca a nadie más.
 *
 *   npm run alumna-prueba crear [correo]
 *   npm run alumna-prueba borrar [correo]
 */
/** Se puede pasar otro correo como tercer argumento para tener varias. */
const EMAIL = (process.argv[3] || "prueba-telegram@bakano.ec").toLowerCase();
const TX = `PRUEBA-TELEGRAM-BOT-${EMAIL}`;

async function main() {
  const accion = process.argv[2];
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  if (accion === "crear") {
    const accessUntil = new Date();
    accessUntil.setMonth(accessUntil.getMonth() + 3);

    if (!(await Order.findOne({ clientTransactionId: TX }))) {
      await Order.create({
        clientTransactionId: TX,
        status: "approved",
        amountCents: 0,
        amountVerified: false,
        environment: "test",
        email: EMAIL,
        buyerName: "Prueba Telegram",
        challenge: "SK Recomposición",
        accessMonths: 3,
        accessUntil,
      });
    }
    const cuenta = await ensureMember({
      email: EMAIL,
      name: "Prueba Telegram",
      challenge: "SK Recomposición",
      accessUntil,
      clientTransactionId: TX,
    });
    console.log(`creada: ${cuenta.created} · contraseña: ${cuenta.password ?? "(ya existía)"}`);
  } else if (accion === "borrar") {
    const o = await Order.deleteMany({ email: EMAIL, clientTransactionId: /^PRUEBA-TELEGRAM-BOT/ });
    const u = await User.deleteMany({ email: EMAIL });
    console.log(`borradas ${o.deletedCount} órdenes y ${u.deletedCount} cuentas`);
  } else {
    throw new Error("Uso: crear | borrar");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
