import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { activarNovedad, estadoNovedad, guardarNovedad } from "../services/novedades.service";
import { TIENDA } from "../config/tienda";

/**
 * Deja escrito el aviso de la tienda de Scarlett, para que salga a todas.
 *
 * Escribir y activar son dos pasos, igual que en el panel: sin argumento solo
 * lo guarda —se puede leer y corregir—, y con `--avisar` da la orden. El envío
 * no sale de acá en ningún caso: lo hace el cron de producción, 25 por hora y
 * máximo 50 al día, para no dejar sin cuota al correo de una compra nueva.
 *
 *   pnpm novedad-tienda              # lo guarda
 *   pnpm novedad-tienda --avisar     # da la orden de mandarlo
 */
const TITULO = "Ya puedes comprar todo lo que usa Scarlett 🛍️";

const TEXTO = [
  "Nos preguntan todos los días lo mismo: qué mancuernas usa Scarlett, de dónde es su banda, cuál es esa botella, qué se pone para entrenar.",
  "Ahora está todo junto en un solo lugar. Scarlett abrió su tienda en Amazon con lo que de verdad usa: lo del reto —mancuernas, banda de tela, mat— y también lo de su día a día, la cocina, el meal prep y lo que le preguntan en Instagram.",
  "No necesitas comprar nada para hacer el reto: con lo mínimo funciona igual, y eso no cambia. Pero si ibas a comprarlo de todas formas, ahora sabes exactamente cuál es cuál.",
  `${TIENDA.nota} También lo dejamos fijo en tu app, en Recursos, para cuando lo necesites.`,
].join("\n\n");

async function main() {
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  await guardarNovedad({
    titulo: TITULO,
    texto: TEXTO,
    ctaTexto: TIENDA.cta,
    ctaUrl: TIENDA.url,
  });

  if (process.argv.includes("--avisar")) await activarNovedad();

  const estado = await estadoNovedad();
  console.log(JSON.stringify(estado, null, 2));
  console.log(
    process.argv.includes("--avisar")
      ? "Orden dada: el cron manda la primera tanda en su próxima corrida."
      : "Guardado sin enviar. Para dar la orden: pnpm novedad-tienda --avisar",
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
