import dotenv from "dotenv";

// En local las variables viven en .env.local (lo escribe Vercel CLI).
dotenv.config({ path: [".env.local", ".env"] });

import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { challengeDesdeTransaccion } from "../helpers/challenge.helper";
import { Guia } from "../models/Guia";
import { Order } from "../models/Order";
import { User } from "../models/User";

/**
 * Por qué a una alumna le sale "no lo tienes" sobre el reto que compró.
 *
 * La app decide qué material mostrarle por el nombre del reto guardado en su
 * cuenta. Si ese campo quedó vacío —la compra no lo trajo y el navegador
 * tampoco— la alumna aparece sin reto: ni el menú, ni la guía, ni el material.
 * Tiene acceso pagado y la app le ofrece comprar lo que ya compró.
 *
 * Este script lo mide y, con --reparar, lo rellena desde su propia orden: el
 * reto que dice la compra o, si tampoco lo trae, el que va dentro de la
 * referencia (SK-RECOMPOSICION-...). Lo que no se pueda deducir se lista para
 * mirarlo a mano; no se inventa.
 *
 *   npm run revisar-retos
 *   npm run revisar-retos -- --reparar
 */
async function main() {
  const reparar = process.argv.includes("--reparar");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const alumnas = await User.find({ role: "member" }).sort({ createdAt: 1 });
  const sinReto = alumnas.filter((u) => !u.challenges?.length && !u.challenge);

  console.log(`alumnas: ${alumnas.length} · sin reto asignado: ${sinReto.length}`);

  // Qué nombres de reto existen hoy, para detectar variantes escritas distinto.
  const nombres = new Map<string, number>();
  for (const u of alumnas) {
    for (const c of u.challenges?.length ? u.challenges : u.challenge ? [u.challenge] : []) {
      nombres.set(c, (nombres.get(c) ?? 0) + 1);
    }
  }
  console.log("\nretos guardados en las cuentas:");
  for (const [nombre, n] of [...nombres].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)} × "${nombre}"`);
  }

  await resumen(alumnas);

  if (!sinReto.length) {
    await mongoose.disconnect();
    return;
  }

  console.log("\nlas que no tienen reto:");
  let arreglables = 0;
  const cambios: Array<{ user: (typeof sinReto)[number]; reto: string; origen: string }> = [];

  for (const u of sinReto) {
    const ordenes = await Order.find({ email: u.email, status: "approved" }).sort({ createdAt: 1 });
    let reto: string | null = null;
    let origen = "";

    for (const o of ordenes) {
      if (o.challenge) {
        reto = o.challenge;
        origen = "su compra";
        break;
      }
      const deReferencia = challengeDesdeTransaccion(o.clientTransactionId);
      if (deReferencia) {
        reto = deReferencia;
        origen = `la referencia ${o.clientTransactionId}`;
        break;
      }
    }

    if (reto) {
      arreglables++;
      cambios.push({ user: u, reto, origen });
      console.log(`  ${u.email} → ${reto} (según ${origen})`);
    } else {
      console.log(`  ${u.email} → NO SE PUEDE DEDUCIR (${ordenes.length} órdenes aprobadas)`);
    }
  }

  console.log(`\ndeducibles: ${arreglables} de ${sinReto.length}`);

  if (!reparar) {
    console.log("\n(nada se tocó — corre con --reparar para aplicarlo)");
    await mongoose.disconnect();
    return;
  }

  for (const { user, reto } of cambios) {
    user.challenge = reto;
    if (!user.challenges.includes(reto)) user.challenges.push(reto);
    await user.save();
  }
  console.log(`\nreparadas ${cambios.length} cuentas`);

  await mongoose.disconnect();
}

/**
 * Cuántas alumnas ven su guía ahora mismo, y qué le falta a cada una que no.
 *
 * Son tres cosas y solo tres: tener el reto guardado, tener el acceso vigente
 * y que exista la guía de su reto. Se cuentan juntas porque la pregunta real
 * —"¿ya le aparece a todas?"— no se responde mirando una sola.
 */
async function resumen(alumnas: Array<InstanceType<typeof User>>) {
  const cargadas = new Set((await Guia.find().lean()).map((g) => g.audiencia));
  const ahora = new Date();

  let ven = 0;
  const sinRetoAun: string[] = [];
  const vencidas: string[] = [];
  const sinGuia: string[] = [];
  const nuncaEntraron: string[] = [];

  for (const u of alumnas) {
    const retos = u.challenges?.length ? u.challenges : u.challenge ? [u.challenge] : [];
    const audiencias = retos
      .map((r) =>
        r.toLowerCase().includes("volumen")
          ? "volumen"
          : r.toLowerCase().includes("recompos")
            ? "recomposicion"
            : null,
      )
      .filter((a): a is "volumen" | "recomposicion" => a !== null);

    if (!retos.length) sinRetoAun.push(u.email);
    else if (!u.accessUntil || u.accessUntil <= ahora) vencidas.push(u.email);
    else if (!audiencias.some((a) => cargadas.has(a))) sinGuia.push(u.email);
    else {
      ven++;
      if (!u.lastLoginAt) nuncaEntraron.push(u.email);
    }
  }

  console.log(`\n── ¿a quién le aparece su guía? ──`);
  console.log(`  ${ven} de ${alumnas.length} la tienen disponible`);
  if (sinRetoAun.length) console.log(`  ${sinRetoAun.length} sin reto asignado`);
  if (vencidas.length) console.log(`  ${vencidas.length} con el acceso vencido`);
  if (sinGuia.length) console.log(`  ${sinGuia.length} sin guía cargada para su reto`);
  if (nuncaEntraron.length) {
    console.log(
      `\n  ojo: ${nuncaEntraron.length} de las que la tienen disponible NUNCA han iniciado sesión.`,
    );
    console.log(`  A ellas no les "falla" nada: todavía no han entrado a la app.`);
  }
  for (const [titulo, lista] of [["sin reto", sinRetoAun], ["vencidas", vencidas], ["sin guía", sinGuia]] as const) {
    if (lista.length) console.log(`\n  ${titulo}: ${lista.join(", ")}`);
  }
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
