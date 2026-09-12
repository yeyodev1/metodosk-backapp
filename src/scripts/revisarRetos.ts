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
 * Que a cada alumna le aparezca lo que compró. Todo lo que compró.
 *
 * La app decide qué material mostrar por los retos guardados en la cuenta. Si
 * ese campo quedó vacío —hubo compras que no lo trajeron— la alumna aparece
 * sin reto: no ve su menú ni su guía, y encima la app le ofrece comprar lo que
 * ya pagó. Y si compró los dos pero solo se guardó uno, le falta la mitad del
 * material.
 *
 * Acá se reconstruye desde sus propias compras: el reto que dice cada orden
 * aprobada o, si no lo trae, el que va dentro de la referencia
 * (SK-RECOMPOSICION-...). Solo suma; nunca le quita un reto a nadie, porque
 * hay accesos que se dieron a mano y no tienen una orden que los respalde.
 *
 *   npm run revisar-retos
 *   npm run revisar-retos -- --reparar
 */

type Audiencia = "recomposicion" | "volumen";

const audienciaDe = (reto: string): Audiencia | null => {
  const t = reto.toLowerCase();
  if (t.includes("volumen")) return "volumen";
  if (t.includes("recompos")) return "recomposicion";
  return null;
};

const retosGuardados = (u: InstanceType<typeof User>): string[] =>
  u.challenges?.length ? u.challenges : u.challenge ? [u.challenge] : [];

/** Todos los retos que respaldan sus compras aprobadas, sin repetir. */
function retosComprados(ordenes: Array<InstanceType<typeof Order>>): string[] {
  const retos = new Set<string>();
  for (const o of ordenes) {
    const reto = o.challenge || challengeDesdeTransaccion(o.clientTransactionId);
    if (reto) retos.add(reto);
  }
  return [...retos];
}

async function main() {
  const reparar = process.argv.includes("--reparar");
  if (!(await dbConnect())) throw new Error("Sin base de datos");

  const alumnas = await User.find({ role: "member" }).sort({ createdAt: 1 });
  const aprobadas = await Order.find({ status: "approved" }).sort({ createdAt: 1 });

  const porCorreo = new Map<string, Array<InstanceType<typeof Order>>>();
  for (const o of aprobadas) {
    if (!o.email) continue;
    const correo = o.email.toLowerCase();
    porCorreo.set(correo, [...(porCorreo.get(correo) ?? []), o]);
  }

  const faltantes: Array<{ u: InstanceType<typeof User>; suma: string[]; tiene: string[] }> = [];
  const sinRespaldo: string[] = [];

  for (const u of alumnas) {
    const tiene = retosGuardados(u);
    const comprados = retosComprados(porCorreo.get(u.email.toLowerCase()) ?? []);
    const suma = comprados.filter((r) => !tiene.includes(r));

    if (suma.length) faltantes.push({ u, suma, tiene });
    else if (!tiene.length) sinRespaldo.push(u.email);
  }

  console.log(`alumnas: ${alumnas.length}`);
  console.log(`a las que les falta algún reto de su compra: ${faltantes.length}`);

  for (const { u, suma, tiene } of faltantes) {
    const antes = tiene.length ? tiene.join(" + ") : "nada";
    console.log(`  ${u.email}: tenía ${antes} → le suma ${suma.join(" + ")}`);
  }

  if (sinRespaldo.length) {
    console.log(`\nsin reto y sin compra que lo diga (mirar a mano): ${sinRespaldo.length}`);
    for (const correo of sinRespaldo) console.log(`  ${correo}`);
  }

  if (reparar && faltantes.length) {
    for (const { u, suma } of faltantes) {
      for (const reto of suma) {
        if (!u.challenges.includes(reto)) u.challenges.push(reto);
      }
      // `challenge` es el que la app enseña como "tu reto": el último comprado.
      u.challenge = u.challenges[u.challenges.length - 1] ?? u.challenge;
      await u.save();
    }
    console.log(`\nreparadas ${faltantes.length} cuentas`);
  } else if (faltantes.length) {
    console.log("\n(nada se tocó — corre con --reparar para aplicarlo)");
  }

  await resumen(reparar ? await User.find({ role: "member" }) : alumnas);
  await mongoose.disconnect();
}

/**
 * Cuántas alumnas ven su guía ahora mismo, y qué le falta a cada una que no.
 *
 * Son tres cosas y solo tres: tener el reto guardado, tener el acceso vigente
 * y que exista la guía de ese reto. Se cuentan juntas porque la pregunta real
 * —"¿ya le aparece a todas?"— no se responde mirando una sola.
 */
async function resumen(alumnas: Array<InstanceType<typeof User>>) {
  const cargadas = new Set((await Guia.find().lean()).map((g) => g.audiencia));
  const ahora = new Date();

  let ven = 0;
  let conLasDos = 0;
  const sinReto: string[] = [];
  const vencidas: string[] = [];
  const sinGuia: string[] = [];
  const nuncaEntraron: string[] = [];

  for (const u of alumnas) {
    const retos = retosGuardados(u);
    const audiencias = [
      ...new Set(retos.map(audienciaDe).filter((a): a is Audiencia => a !== null)),
    ];

    if (!retos.length) sinReto.push(u.email);
    else if (!u.accessUntil || u.accessUntil <= ahora) vencidas.push(u.email);
    else if (!audiencias.some((a) => cargadas.has(a))) sinGuia.push(u.email);
    else {
      ven++;
      if (audiencias.length > 1) conLasDos++;
      if (!u.lastLoginAt) nuncaEntraron.push(u.email);
    }
  }

  console.log(`\n── ¿a quién le aparece su guía? ──`);
  console.log(`  ${ven} de ${alumnas.length} la tienen disponible`);
  console.log(`  ${conLasDos} de ellas ven las dos guías, por tener los dos retos`);
  if (sinReto.length) console.log(`  ${sinReto.length} sin reto asignado`);
  if (vencidas.length) console.log(`  ${vencidas.length} con el acceso vencido`);
  if (sinGuia.length) console.log(`  ${sinGuia.length} sin guía cargada para su reto`);

  if (nuncaEntraron.length) {
    console.log(
      `\n  ojo: ${nuncaEntraron.length} de las que la tienen disponible nunca han iniciado sesión.`,
    );
    console.log(`  A ellas no les falla nada: todavía no han entrado a la app.`);
  }

  for (const [titulo, lista] of [
    ["sin reto", sinReto],
    ["vencidas", vencidas],
    ["sin guía", sinGuia],
  ] as const) {
    if (lista.length) console.log(`\n  ${titulo}: ${lista.join(", ")}`);
  }
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
