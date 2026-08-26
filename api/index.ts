import "dotenv/config";
import { dbConnect } from "../src/config/mongo";
import { createApp } from "../src/app";
import { seedAdmin } from "../src/services/auth.service";
import type { Express } from "express";

/**
 * Entrada para Vercel. La app se construye una sola vez por instancia y se
 * reutiliza entre invocaciones.
 */
let app: Express | null = null;

async function ensureApp(): Promise<Express> {
  if (app) return app;
  await dbConnect();
  await seedAdmin();
  const { app: created } = createApp();
  app = created;
  return app;
}

export default async function handler(req: any, res: any) {
  const application = await ensureApp();
  application(req, res);
}
