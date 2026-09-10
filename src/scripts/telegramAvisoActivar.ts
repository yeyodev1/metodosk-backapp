import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { activarAviso, estadoAviso } from "../services/telegramAviso.service";

/**
 * Da la orden de avisar, igual que el botón del panel. No manda nada desde
 * acá: el cron de producción recoge la orden en su próxima corrida.
 */
async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");
  await activarAviso();
  console.log(JSON.stringify(await estadoAviso()));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
