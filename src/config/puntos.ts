/**
 * Los puntos del reto: qué suma, cuánto y hasta dónde.
 *
 * Se premia lo que hace avanzar el reto —ver las clases, registrar el avance—
 * y lo que hace viva la comunidad —contar un logro, responder, animar a otra—.
 * Cada acción tiene tope diario: sin tope, el ranking lo gana quien publica
 * "hola" cuarenta veces, y eso mata la comunidad en vez de animarla.
 *
 * Vive acá y no en la app: la app lo muestra, pero la cuenta la hace el
 * servidor con lo que está guardado. Un número que calculara el navegador se
 * podría inflar desde la consola.
 */

export type AccionPuntos =
  | "video"
  | "publicacion"
  | "comentario"
  | "reaccion"
  | "fotos"
  | "medidas";

export const PUNTOS: Record<
  AccionPuntos,
  { puntos: number; topeDiario: number | null; titulo: string; detalle: string; icono: string }
> = {
  video: {
    puntos: 10,
    topeDiario: null,
    titulo: "Termina una clase",
    detalle: "Cada video que ves completo o marcas como visto.",
    icono: "circle-play",
  },
  fotos: {
    puntos: 25,
    topeDiario: 1,
    titulo: "Sube tus fotos de avance",
    detalle: "Una vez por día: tus fotos de frente, lado o espalda.",
    icono: "camera",
  },
  medidas: {
    puntos: 15,
    topeDiario: 1,
    titulo: "Registra tus medidas",
    detalle: "Una vez por día: peso, cintura, cadera…",
    icono: "ruler",
  },
  publicacion: {
    puntos: 8,
    topeDiario: 3,
    titulo: "Comparte en la comunidad",
    detalle: "Un logro, una receta, una duda. Hasta 3 por día suman.",
    icono: "comments",
  },
  comentario: {
    puntos: 3,
    topeDiario: 5,
    titulo: "Comenta una clase",
    detalle: "Preguntas y respuestas bajo cada video. Hasta 5 por día.",
    icono: "comment",
  },
  reaccion: {
    puntos: 1,
    topeDiario: 20,
    titulo: "Recibe reacciones",
    detalle: "Cuando otra reacciona a lo que compartes. Hasta 20 por día.",
    icono: "fire",
  },
};

/**
 * Los niveles: la recompensa que se ve en todo momento, junto a su nombre en
 * cada publicación. Se cuentan sobre el total del reto, no del mes: subir de
 * nivel no se pierde.
 */
export const NIVELES = [
  { nivel: 1, nombre: "Arrancando", desde: 0 },
  { nivel: 2, nombre: "Constante", desde: 100 },
  { nivel: 3, nombre: "Enfocada", desde: 250 },
  { nivel: 4, nombre: "Imparable", desde: 500 },
  { nivel: 5, nombre: "Inspiración SK", desde: 900 },
  { nivel: 6, nombre: "Leyenda SK", desde: 1400 },
] as const;

export function nivelDe(total: number) {
  const actual = [...NIVELES].reverse().find((n) => total >= n.desde) ?? NIVELES[0];
  const siguiente = NIVELES.find((n) => n.desde > total) ?? null;
  return {
    nivel: actual.nivel,
    nombre: actual.nombre,
    desde: actual.desde,
    siguiente: siguiente ? { nivel: siguiente.nivel, nombre: siguiente.nombre, desde: siguiente.desde } : null,
  };
}

/** Lo que se cuenta de cada alumna para dar insignias. */
export interface Conteo {
  videos: number;
  publicaciones: number;
  logros: number;
  comentarios: number;
  reacciones: number;
  tomasFotos: number;
  tomasMedidas: number;
  diasActivos: number;
}

/** Las insignias: metas concretas, cada una con su "cómo se gana" a la vista. */
export const INSIGNIAS: Array<{
  id: string;
  nombre: string;
  como: string;
  icono: string;
  ganada: (c: Conteo) => boolean;
}> = [
  { id: "primer-paso", nombre: "Primer paso", como: "Termina tu primera clase", icono: "shoe-prints", ganada: (c) => c.videos >= 1 },
  { id: "semana-completa", nombre: "Semana completa", como: "Termina 5 clases", icono: "calendar-check", ganada: (c) => c.videos >= 5 },
  { id: "bloque-dominado", nombre: "Bloque dominado", como: "Termina 15 clases", icono: "dumbbell", ganada: (c) => c.videos >= 15 },
  { id: "punto-cero", nombre: "Punto cero", como: "Sube tus fotos de avance", icono: "camera", ganada: (c) => c.tomasFotos >= 1 },
  { id: "medida-a-medida", nombre: "Medida a medida", como: "Registra tus medidas 3 veces", icono: "ruler", ganada: (c) => c.tomasMedidas >= 3 },
  { id: "me-presento", nombre: "Me presento", como: "Publica por primera vez en la comunidad", icono: "hand", ganada: (c) => c.publicaciones >= 1 },
  { id: "lo-logre", nombre: "¡Lo logré!", como: "Comparte tu primer logro", icono: "trophy", ganada: (c) => c.logros >= 1 },
  { id: "voz-de-la-comunidad", nombre: "Voz de la comunidad", como: "Comenta 10 veces", icono: "comments", ganada: (c) => c.comentarios >= 10 },
  { id: "inspiras", nombre: "Inspiras", como: "Recibe 25 reacciones", icono: "fire", ganada: (c) => c.reacciones >= 25 },
  { id: "constancia", nombre: "Constancia", como: "Suma puntos en 10 días distintos", icono: "bolt", ganada: (c) => c.diasActivos >= 10 },
];

/**
 * El premio del mes.
 *
 * Las tres con más puntos del mes salen destacadas arriba de la comunidad. El
 * premio concreto lo deciden Scarlet y Karen: se cambia esta línea y listo.
 */
export const PREMIO_DEL_MES =
  "Las 3 con más puntos del mes salen destacadas en la comunidad y reciben un reconocimiento de Scarlet y Karen.";
