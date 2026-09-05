import { Schema, model, Document } from "mongoose";

/**
 * Cuentas del sitio.
 *
 * - admin  : entra al panel de compras.
 * - member : compradora. La cuenta se crea sola cuando su pago se aprueba.
 */
export type UserRole = "admin" | "member";

export interface IUser extends Document {
  email: string;
  /** Hash bcrypt. La contraseña en claro nunca se guarda. */
  password: string;
  name: string;
  phone: string | null;
  role: UserRole;
  /** El último reto comprado, p. ej. "SK Volumen". */
  challenge: string | null;
  /**
   * Todos los retos que ha comprado.
   *
   * Puede tener los dos: son planes distintos, no niveles de uno solo, y nada
   * impide comprar el segundo después. `challenge` se conserva porque es el
   * que se muestra como "tu reto" y porque ya había cuentas creadas con él.
   */
  challenges: string[];
  /** Hasta cuándo tiene acceso. null = sin acceso vigente. */
  accessUntil: Date | null;
  /**
   * Cuándo se le mandó la lista de implementos. null = todavía no.
   *
   * Es la marca que hace el envío escalonado reanudable: el plan gratuito de
   * Resend no deja mandarlos todos de golpe, así que salen por tandas y esto
   * es lo que impide que alguien lo reciba dos veces.
   */
  recursosEnviados: Date | null;
  /** Referencia de la compra que originó la cuenta. */
  clientTransactionId: string | null;
  /** true mientras siga usando la contraseña que le enviamos por correo. */
  mustChangePassword: boolean;
  /**
   * Los primeros pasos, después de comprar.
   *
   * `videoSeen` lo marca ella, no el reproductor: se le pregunta si lo vio.
   * Un reproductor puede quedarse abierto solo; una respuesta suya es lo único
   * que de verdad significa que lo vio.
   *
   * `skipped` deja constancia de que prefirió hacerlo después. Se guarda
   * porque un onboarding sin salida se abandona, y hay que poder distinguir a
   * quien lo pospuso de quien nunca llegó.
   */
  onboarding: {
    videoSeen: boolean;
    photosUploaded: boolean;
    skipped: boolean;
    completedAt: Date | null;
  };
  /** Fotos de avance, privadas. Solo ella y la administración las ven. */
  progressPhotos: Array<{
    angulo: "frente" | "lado" | "espalda";
    publicId: string;
    createdAt: Date;
  }>;
  /**
   * Sus medidas, una toma por fecha.
   *
   * Se guarda el histórico entero por la misma razón que las fotos: el número
   * de hoy no dice nada solo, y la cintura baja cuando la balanza no se mueve.
   * Todos los campos son opcionales — se apunta lo que se midió, no se exige
   * una toma completa para poder guardar.
   */
  measurements: Array<{
    pesoKg: number | null;
    cinturaCm: number | null;
    caderaCm: number | null;
    pechoCm: number | null;
    brazoCm: number | null;
    piernaCm: number | null;
    nota: string;
    createdAt: Date;
  }>;
  /**
   * Su foto de perfil de la comunidad. Pública, a diferencia de las de avance:
   * es la que ella elige mostrarle al resto, y va en cada mensaje del muro.
   * null = se pinta su inicial.
   */
  avatarPublicId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true },
    name: { type: String, default: "" },
    phone: { type: String, default: null },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    challenge: { type: String, default: null },
    challenges: { type: [String], default: [] },
    accessUntil: { type: Date, default: null },
    recursosEnviados: { type: Date, default: null },
    clientTransactionId: { type: String, default: null },
    mustChangePassword: { type: Boolean, default: false },
    onboarding: {
      videoSeen: { type: Boolean, default: false },
      photosUploaded: { type: Boolean, default: false },
      skipped: { type: Boolean, default: false },
      completedAt: { type: Date, default: null },
    },
    progressPhotos: {
      type: [
        {
          _id: false,
          angulo: { type: String, enum: ["frente", "lado", "espalda"], required: true },
          publicId: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    measurements: {
      type: [
        {
          _id: false,
          pesoKg: { type: Number, default: null },
          cinturaCm: { type: Number, default: null },
          caderaCm: { type: Number, default: null },
          pechoCm: { type: Number, default: null },
          brazoCm: { type: Number, default: null },
          piernaCm: { type: Number, default: null },
          nota: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    avatarPublicId: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
