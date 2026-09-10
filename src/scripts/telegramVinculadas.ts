import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { User } from "../models/User";

/** Quiénes ya pasaron por el bot y cuándo. Solo lee. */
async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");
  const vinculadas = await User.find({ "telegram.userId": { $ne: null } })
    .sort({ "telegram.vinculadoEl": -1 })
    .select("email name telegram.userId telegram.nombre telegram.vinculadoEl telegram.enlaces")
    .lean();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_COMUNIDAD_CHAT_ID;
  for (const u of vinculadas) {
    // ¿Ya entró al grupo? Se le pregunta a Telegram, no a la base.
    let dentro = "?";
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${chatId}&user_id=${u.telegram?.userId}`).then((x) => x.json());
      dentro = ["member", "administrator", "creator"].includes(r?.result?.status) ? "DENTRO" : "todavía no entra";
    } catch {}
    const hora = u.telegram?.vinculadoEl
      ? new Date(u.telegram.vinculadoEl).toLocaleTimeString("es-EC", { timeZone: "America/Guayaquil", hour: "2-digit", minute: "2-digit" })
      : "?";
    console.log(`${hora} · ${u.name || u.email} · Telegram: ${u.telegram?.nombre ?? "?"} · ${dentro}`);
  }
  console.log(`TOTAL vinculadas: ${vinculadas.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
