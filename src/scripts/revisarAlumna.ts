import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Guia } from "../models/Guia";
import { Order } from "../models/Order";
import { User } from "../models/User";

/**
 * Por qué esta alumna no ve lo que debería ver.
 *
 * Busca por correo o por nombre —da igual el trozo— y muestra de un vistazo
 * las tres cosas que deciden qué material le aparece: si tiene cuenta, si su
 * acceso sigue vigente y qué reto tiene guardado. Casi siempre el problema es
 * una de esas tres, y sin verlas juntas se adivina.
 *
 * No cambia nada.
 *
 *   npm run revisar-alumna -- katya
 *   npm run revisar-alumna -- correo@ejemplo.com
 */
const fecha = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—";

async function main() {
  const busqueda = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!busqueda) throw new Error("Uso: revisar-alumna <correo o nombre>");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const re = new RegExp(busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const usuarias = await User.find({ $or: [{ email: re }, { name: re }] });
  const ordenes = await Order.find({
    $or: [{ email: re }, { buyerName: re }],
  }).sort({ createdAt: 1 });

  console.log(`\nBuscando "${busqueda}" — ${usuarias.length} cuenta(s), ${ordenes.length} orden(es)\n`);

  if (!usuarias.length && !ordenes.length) {
    console.log("No aparece ni como cuenta ni como compra.");
    console.log("Puede haber comprado con otro correo, o con el nombre escrito distinto.");
  }

  const guias = await Guia.find().lean();
  const hayGuia = new Set(guias.map((g) => g.audiencia));

  for (const u of usuarias) {
    const retos = u.challenges?.length ? u.challenges : u.challenge ? [u.challenge] : [];
    const vigente = Boolean(u.accessUntil && u.accessUntil > new Date());
    const audiencias = retos
      .map((r) => (r.toLowerCase().includes("volumen") ? "volumen" : r.toLowerCase().includes("recompos") ? "recomposicion" : null))
      .filter(Boolean) as string[];

    console.log("─".repeat(60));
    console.log(`CUENTA   ${u.email}`);
    console.log(`nombre   ${u.name || "(sin nombre)"}`);
    console.log(`rol      ${u.role}`);
    console.log(`retos    ${retos.length ? retos.join(", ") : "NINGUNO ← por esto no ve su material"}`);
    console.log(`acceso   hasta ${fecha(u.accessUntil)} ${vigente ? "(vigente)" : "← VENCIDO o sin fecha"}`);
    console.log(`clave    ${u.mustChangePassword ? "todavía usa la que le mandamos por correo" : "ya creó la suya"}`);
    console.log(`entró    ${u.lastLoginAt ? `por última vez el ${fecha(u.lastLoginAt)}` : "NUNCA ← no ha iniciado sesión"}`);
    console.log(`creada   ${fecha(u.createdAt)}`);

    const veGuia = vigente && audiencias.some((a) => hayGuia.has(a));
    console.log(`\n¿ve su guía? ${veGuia ? "SÍ" : "NO"}`);
    if (!veGuia) {
      if (!retos.length) console.log("   falta: su reto (se arregla con revisar-retos --reparar)");
      else if (!vigente) console.log("   falta: acceso vigente");
      else console.log(`   falta: la guía de ${audiencias.join(", ")} no está cargada`);
    }
  }

  if (ordenes.length) {
    console.log("\n" + "─".repeat(60));
    console.log("COMPRAS");
    for (const o of ordenes) {
      console.log(
        `  ${fecha(o.createdAt)} · ${o.status.padEnd(8)} · ${(o.challenge || "sin reto").padEnd(18)}` +
          ` · $${(o.amountCents / 100).toFixed(2)} · ${o.email ?? "sin correo"}`,
      );
      console.log(`      ${o.clientTransactionId}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
