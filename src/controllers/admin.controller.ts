import { Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { Order } from "../models/Order";
import { presaleCents, regularCents } from "../config/pricing";
import { resolverChallenge } from "../helpers/challenge.helper";
import { consultarEstado } from "../services/payphone.service";

/** Un grupo del resumen: cuántas compras y cuánto dinero suman. */
interface Bucket {
  compras: number;
  centavos: number;
}

const vacio = (): Bucket => ({ compras: 0, centavos: 0 });

/**
 * A qué grupo pertenece una compra. Los cuatro grupos son excluyentes entre
 * sí y cubren todos los casos, así que sumados dan el total registrado y
 * ningún dólar se cuenta dos veces.
 */
type Grupo = "entro" | "porRevisar" | "pruebas" | "noEntro";

function grupoDe(o: {
  status: string;
  environment: string;
  amountVerified: boolean;
}): Grupo {
  // Cancelada o fallida = nunca se cobró, sin importar el entorno.
  if (o.status !== "approved") return "noEntro";
  // Aprobada en el entorno de pruebas: PayPhone no movió dinero real.
  if (o.environment !== "prod") return "pruebas";
  // Aprobada y real, pero por un monto que no es ninguno de nuestros precios.
  if (!o.amountVerified) return "porRevisar";
  return "entro";
}

/**
 * GET /api/admin/orders — compras registradas, la más reciente primero.
 *
 * Acepta ?status= y ?search= para filtrar por estado o por nombre/correo.
 *
 * El resumen se calcula aparte, sobre TODAS las compras (solo lo acota la
 * búsqueda), no sobre la página que devuelve la tabla: si se sumara lo
 * listado, el recaudado cambiaría al filtrar por estado o al pasar de 100
 * compras, y sería un número distinto cada vez que se toca un filtro.
 */
export async function listOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const { status, search } = req.query as { status?: string; search?: string };

    // Base del resumen: solo la búsqueda, para poder cuadrar a una persona.
    const base: Record<string, unknown> = {};
    if (search?.trim()) {
      const rx = new RegExp(search.trim(), "i");
      base.$or = [{ email: rx }, { buyerName: rx }, { clientTransactionId: rx }];
    }

    // Lo que se lista sí respeta además el filtro de estado.
    const query = status ? { ...base, status } : base;

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const [orders, grupos] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
      Order.aggregate<{
        _id: { status: string; environment: string; amountVerified: boolean };
        compras: number;
        centavos: number;
      }>([
        { $match: base },
        {
          $group: {
            _id: {
              status: "$status",
              environment: "$environment",
              amountVerified: "$amountVerified",
            },
            compras: { $sum: 1 },
            centavos: { $sum: "$amountCents" },
          },
        },
      ]),
    ]);

    const resumen = {
      entro: vacio(),
      porRevisar: vacio(),
      pruebas: vacio(),
      noEntro: vacio(),
    };

    for (const g of grupos) {
      const destino = resumen[grupoDe({
        status: g._id.status,
        environment: g._id.environment ?? "prod",
        amountVerified: Boolean(g._id.amountVerified),
      })];
      destino.compras += g.compras;
      destino.centavos += g.centavos;
    }

    const registradas =
      resumen.entro.compras +
      resumen.porRevisar.compras +
      resumen.pruebas.compras +
      resumen.noEntro.compras;

    res.status(200).json({
      orders: orders.map((o) => ({
        id: String(o._id),
        clientTransactionId: o.clientTransactionId,
        payphoneTransactionId: o.payphoneTransactionId ?? null,
        status: o.status,
        grupo: grupoDe({
          status: o.status,
          environment: o.environment ?? "prod",
          amountVerified: Boolean(o.amountVerified),
        }),
        amountCents: o.amountCents,
        amountVerified: Boolean(o.amountVerified),
        currency: o.currency ?? "USD",
        environment: o.environment ?? "prod",
        buyerName: o.buyerName ?? o.cardHolder ?? null,
        cardHolder: o.cardHolder ?? null,
        email: o.email ?? null,
        phoneNumber: o.phoneNumber ?? null,
        // Las compras viejas se guardaron sin reto: se deduce del id.
        challenge: resolverChallenge(o.challenge, o.clientTransactionId),
        accessMonths: o.accessMonths ?? null,
        accessUntil: o.accessUntil ?? null,
        authorizationCode: o.authorizationCode ?? null,
        createdAt: o.createdAt,
      })),
      resumen: {
        // Cuántas compras devolvió la tabla, frente a cuántas hay en total.
        mostradas: orders.length,
        registradas,
        ...resumen,
      },
      precios: {
        preventaCentavos: presaleCents(),
        regularCentavos: regularCents(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/admin/orders/:id/prueba — body: { esPrueba: boolean }
 *
 * Mueve una compra al entorno de pruebas y de vuelta. Es lo que hay que usar
 * para sacar del recaudado los cobros que se hicieron probando: el monto sale
 * de "Sí entró" y pasa a "Pruebas", pero el registro sigue ahí. Si mañana
 * resulta que era una clienta de verdad, se revierte con el mismo botón.
 */
export async function marcarPrueba(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const { esPrueba } = req.body ?? {};
    if (typeof esPrueba !== "boolean") {
      throw new CustomError("Falta esPrueba (true o false)", 400);
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { environment: esPrueba ? "test" : "prod" },
      { new: true },
    ).lean();
    if (!order) throw new CustomError("Esa compra ya no existe", 404);

    res.status(200).json({
      id: String(order._id),
      environment: order.environment,
      mensaje: esPrueba
        ? "Marcada como prueba: ya no cuenta como dinero recibido."
        : "Devuelta a producción: vuelve a contar como dinero recibido.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/admin/orders/:id — borra el registro para siempre.
 *
 * No hay vuelta atrás y la orden es el único rastro de quién compró, así que
 * casi siempre lo correcto es marcarla como prueba en vez de borrarla. Se
 * expone igual para poder limpiar basura real de las pruebas de desarrollo.
 */
export async function eliminarOrden(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const order = await Order.findByIdAndDelete(req.params.id).lean();
    if (!order) throw new CustomError("Esa compra ya no existe", 404);

    // Queda en los logs de Vercel por si hubo que borrarla por error.
    console.warn(
      `[admin] compra borrada: ${order.clientTransactionId} · ${order.email ?? "sin correo"} · ${order.amountCents} centavos`,
    );

    res.status(200).json({ id: String(order._id), mensaje: "Compra borrada." });
  } catch (error) {
    next(error);
  }
}

/** Cuántas transacciones se consultan a la vez contra PayPhone. */
const LOTE = 5;

/**
 * POST /api/admin/orders/conciliar — le pregunta a PayPhone en qué quedó cada
 * compra y corrige las que cambiaron.
 *
 * Confirmar una compra deja una foto del momento y nada más. Si después
 * PayPhone reversa el cobro o el banco lo devuelve, nadie nos avisa: su
 * notificación externa solo manda transacciones aprobadas. Por eso el
 * recaudado puede alejarse del panel de PayPhone con el tiempo, y por eso
 * hace falta volver a preguntar.
 *
 * Solo se tocan las de producción: las marcadas a mano como prueba se quedan
 * donde están, que para eso se marcaron.
 */
export async function conciliar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError(
        "No pudimos conectarnos en este momento. Intenta de nuevo en unos segundos.",
        503,
      );
    }

    const orders = await Order.find({ environment: "prod" }).sort({ createdAt: -1 }).lean();

    const cambios: {
      id: string;
      clientTransactionId: string;
      buyerName: string | null;
      email: string | null;
      antes: string;
      ahora: string;
      centavos: number;
    }[] = [];
    let revisadas = 0;
    let sinRespuesta = 0;

    // De a pocas: son decenas de peticiones a un servicio ajeno.
    for (let i = 0; i < orders.length; i += LOTE) {
      const tanda = orders.slice(i, i + LOTE);
      const estados = await Promise.all(
        tanda.map((o) => consultarEstado(o.clientTransactionId, "prod")),
      );

      for (let j = 0; j < tanda.length; j++) {
        const orden = tanda[j]!;
        const estado = estados[j]!;

        // No pudimos preguntar: se deja como está. No saber no es una razón
        // para mover dinero de sitio.
        if (!estado) {
          sinRespuesta++;
          continue;
        }
        revisadas++;
        if (!estado.encontrada || estado.status === orden.status) continue;

        await Order.findByIdAndUpdate(orden._id, { status: estado.status });
        cambios.push({
          id: String(orden._id),
          clientTransactionId: orden.clientTransactionId,
          buyerName: orden.buyerName ?? orden.cardHolder ?? null,
          email: orden.email ?? null,
          antes: orden.status,
          ahora: estado.status,
          centavos: orden.amountCents,
        });
      }
    }

    res.status(200).json({
      revisadas,
      sinRespuesta,
      cambios,
      mensaje: cambios.length
        ? `${cambios.length} ${cambios.length === 1 ? "compra cambió" : "compras cambiaron"} de estado en PayPhone.`
        : "Todo cuadra con PayPhone: ninguna compra cambió de estado.",
    });
  } catch (error) {
    next(error);
  }
}
