import { Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { Order } from "../models/Order";
import { presaleCents, regularCents } from "../config/pricing";

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
        challenge: o.challenge ?? null,
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
