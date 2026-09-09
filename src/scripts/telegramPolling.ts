import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });
import { dbConnect } from "../config/mongo";
import { procesarUpdate } from "../services/telegram.service";

/**
 * El bot en la máquina de desarrollo, sin webhook.
 *
 * En producción Telegram nos llama por webhook. Acá, en vez de abrir un túnel,
 * se le pregunta a Telegram cada segundo si hay mensajes nuevos y se pasan por
 * el mismo `procesarUpdate`. Mientras esto corre, el webhook de producción
 * queda desactivado: Telegram solo entrega por uno de los dos caminos, así que
 * al terminar hay que volver a registrarlo (ver README).
 *
 *   npx ts-node-dev --transpile-only src/scripts/telegramPolling.ts
 */
const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  await dbConnect();

  await fetch(`${API}/deleteWebhook`, { method: "POST" });
  console.log("[telegram] escuchando por polling. Ctrl+C para salir.");

  let offset = 0;
  for (;;) {
    // Un corte de red no tumba el bot: se espera y se vuelve a preguntar.
    const respuesta = await fetch(`${API}/getUpdates?timeout=25&offset=${offset}`)
      .then((r) => r.json())
      .catch((error) => {
        console.warn("[telegram] sin conexión, reintento en 5 s:", error.message);
        return new Promise((resolve) => setTimeout(() => resolve(null), 5000));
      });
    for (const update of respuesta?.result ?? []) {
      offset = update.update_id + 1;
      const texto = update.message?.text;
      if (texto) console.log(`[telegram] ${update.message.from?.first_name}: ${texto}`);
      await procesarUpdate(update);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
