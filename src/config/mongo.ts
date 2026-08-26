import mongoose from "mongoose";

/**
 * Conexión a Mongo. Es OPCIONAL: sin DB_URI el API arranca igual y la
 * confirmación de pagos sigue funcionando; solo deja de guardar el pedido.
 */
export async function dbConnect(): Promise<boolean> {
  const DB_URI = process.env.DB_URI;

  if (!DB_URI) {
    console.warn("DB_URI no definida — el API arranca sin base de datos");
    return false;
  }

  try {
    await mongoose.connect(DB_URI);
    console.log("Connected to MongoDB");
    return true;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    return false;
  }
}
