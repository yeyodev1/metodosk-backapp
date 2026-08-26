import { Response, NextFunction } from "express";
import { dbConnect, isConnected } from "../config/mongo";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { Order } from "../models/Order";

/**
 * GET /api/admin/orders — compras registradas, la más reciente primero.
 *
 * Acepta ?status= y ?search= para filtrar por estado o por nombre/correo.
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
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (search?.trim()) {
      const rx = new RegExp(search.trim(), "i");
      query.$or = [{ email: rx }, { buyerName: rx }, { clientTransactionId: rx }];
    }

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(limit).lean();

    const aprobadas = orders.filter((o) => o.status === "approved");
    res.status(200).json({
      orders: orders.map((o) => ({
        id: String(o._id),
        clientTransactionId: o.clientTransactionId,
        status: o.status,
        amountCents: o.amountCents,
        amountVerified: o.amountVerified,
        environment: o.environment,
        buyerName: o.buyerName ?? o.cardHolder ?? null,
        email: o.email ?? null,
        phoneNumber: o.phoneNumber ?? null,
        challenge: o.challenge ?? null,
        accessUntil: o.accessUntil ?? null,
        authorizationCode: o.authorizationCode ?? null,
        createdAt: o.createdAt,
      })),
      resumen: {
        total: orders.length,
        aprobadas: aprobadas.length,
        // Solo se cuenta el dinero de producción: lo de pruebas no es real.
        recaudadoCentavos: aprobadas
          .filter((o) => o.environment === "prod")
          .reduce((sum, o) => sum + (o.amountCents || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
}
