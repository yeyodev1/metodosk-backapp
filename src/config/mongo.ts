import mongoose from "mongoose";

/**
 * Conexión a Mongo pensada para serverless.
 *
 * Cada arranque en frío levanta un proceso nuevo, y si la petición se atiende
 * antes de que la conexión esté lista, la consulta falla. Por eso se guarda la
 * *promesa* de conexión a nivel de módulo: las invocaciones que reusan la
 * instancia esperan la misma promesa en vez de abrir otra conexión —Atlas
 * tiene un tope— y ninguna consulta corre antes de tiempo.
 *
 * Una conexión fallida no se cachea: si se guardara, la instancia quedaría
 * inservible hasta que Vercel la recicle.
 */

let promesa: Promise<typeof mongoose> | null = null;

/** 1 = conectado. */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function dbConnect(): Promise<boolean> {
  const DB_URI = process.env.DB_URI;

  if (!DB_URI) {
    console.warn("DB_URI no definida — el API arranca sin base de datos");
    return false;
  }

  if (isConnected()) return true;

  if (!promesa) {
    promesa = mongoose.connect(DB_URI, {
      // Fallar rápido y reintentar es mejor que dejar la petición colgada:
      // Vercel corta la función y la compradora ve un error sin explicación.
      serverSelectionTimeoutMS: 8000,
      // Sin buffer, una consulta lanzada antes de tiempo falla en vez de
      // quedarse esperando en silencio.
      bufferCommands: false,
    });
  }

  try {
    await promesa;
    console.log("Connected to MongoDB");
    return true;
  } catch (error) {
    // Se descarta para que el siguiente intento vuelva a conectar.
    promesa = null;
    console.error("MongoDB connection error:", error);
    return false;
  }
}
