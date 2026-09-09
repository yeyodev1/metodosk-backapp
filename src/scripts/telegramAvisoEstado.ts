import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { estadoAviso } from "../services/telegramAviso.service";

/** Cómo va el aviso de "ya se abrió tu grupo". Solo lee. */
async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");
  console.log(JSON.stringify(await estadoAviso()));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
