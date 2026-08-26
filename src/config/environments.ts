/**
 * Resolución de entorno y CORS a partir del Origin de la petición.
 *
 * test -> localhost y túneles de desarrollo: credenciales PayPhone de pruebas.
 * prod -> metodosk.ec y cualquier origin desconocido: credenciales reales.
 *
 * Producción es el default a propósito: un origin que no reconocemos nunca
 * recibe credenciales de prueba.
 */

export type AppEnvironment = "test" | "prod";

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://localhost:8100",
  "http://localhost:8101",
];

/** Hostnames fijos del túnel cloudflared de desarrollo. */
const TUNNEL_ORIGINS = [
  "https://dev-project-front.bakano.ec",
  "https://dev-project-back.bakano.ec",
];

const PROD_ORIGINS = ["https://metodosk.ec", "https://www.metodosk.ec"];

/** Previews de Vercel y túneles: permitidos, pero en entorno de pruebas. */
const TEST_PATTERNS: RegExp[] = [
  /localhost/i,
  /127\.0\.0\.1/,
  /\.trycloudflare\.com$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/dev-project-(front|back)\.bakano\.ec$/i,
];

const ALLOWED_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
];

function extraOrigins(): string[] {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string): boolean {
  const list = [...LOCAL_ORIGINS, ...TUNNEL_ORIGINS, ...PROD_ORIGINS, ...extraOrigins()];
  if (list.includes(origin)) return true;
  return ALLOWED_PATTERNS.some((p) => p.test(origin));
}

export function resolveEnvironment(origin?: string): AppEnvironment {
  if (!origin) return "prod";
  if (PROD_ORIGINS.includes(origin)) return "prod";
  return TEST_PATTERNS.some((p) => p.test(origin)) ? "test" : "prod";
}
