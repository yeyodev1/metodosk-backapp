import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { activarNovedad, estadoNovedad, guardarNovedad } from "../services/novedades.service";
import { telegramFetch } from "../services/telegram.service";

/**
 * El aviso de que llegó el bloque 2: rutinas nuevas y el menú del mes 2.
 *
 * Va a las que ya estaban dentro el 11 de octubre, que lo reciben abierto de
 * una (ver `config/bloques.ts`). Las que compren después no necesitan este
 * correo: a ellas se les abre solo en su semana 5.
 *
 * Igual que la novedad de la tienda: sin argumentos solo lo guarda, con
 * `--avisar` da la orden al cron (25 por hora, 50 al día) y con `--telegram`
 * además lo publica en la comunidad, que llega a todas al instante.
 *
 *   pnpm novedad-bloque-2                       # lo guarda
 *   pnpm novedad-bloque-2 --avisar --telegram   # lo manda
 */
const TITULO = "Ya tienes el bloque 2 de tu reto 💪";

const TEXTO = [
  "Ya está abierto en tu app el bloque 2: cinco rutinas nuevas, de lunes a viernes, para tus semanas 5 a 8.",
  "También tienes el menú del mes 2 de Karen, con platos nuevos y sus tablas de intercambio. Lo encuentras en tu guía, en Menú, con el botón «Mes 2». El del mes 1 sigue ahí por si quieres repetir algún plato.",
  "Si todavía no llegas a tu semana 5, no te adelantes: termina tu bloque 1 primero y sigue con el 2 cuando te toque. Lo dejamos abierto para que lo tengas a mano.",
].join("\n\n");

const SITIO = (process.env.SITE_URL || "https://metodosk.ec").replace(/\/$/, "");

const TELEGRAM = [
  "<b>Ya tienes el bloque 2 de tu reto 💪</b>",
  "",
  "En tu app ya están las <b>rutinas del bloque 2</b> (lunes a viernes, semanas 5 a 8) y el <b>menú del mes 2</b> de Karen: en tu guía, en Menú → «Mes 2».",
  "",
  "Si todavía no llegas a tu semana 5, termina tu bloque 1 primero y sigue con el 2 cuando te toque.",
  "",
  `👉 ${SITIO}/academia`,
].join("\n");

async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  await guardarNovedad({
    titulo: TITULO,
    texto: TEXTO,
    ctaTexto: "Ver mi bloque 2",
    ctaUrl: `${SITIO}/academia`,
  });

  if (process.argv.includes("--avisar")) await activarNovedad();

  if (process.argv.includes("--telegram")) {
    const chatId = process.env.TELEGRAM_COMUNIDAD_CHAT_ID;
    if (!chatId) throw new Error("Falta TELEGRAM_COMUNIDAD_CHAT_ID");
    await telegramFetch("sendMessage", {
      chat_id: chatId,
      text: TELEGRAM,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    console.log("Publicado en la comunidad de Telegram.");
  }

  const estado = await estadoNovedad();
  console.log(JSON.stringify({ ...estado, novedad: estado.novedad?.titulo }, null, 2));
  console.log(
    process.argv.includes("--avisar")
      ? "Orden dada: el cron manda la primera tanda en su próxima corrida."
      : "Guardado sin enviar. Para dar la orden: pnpm novedad-bloque-2 --avisar",
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
