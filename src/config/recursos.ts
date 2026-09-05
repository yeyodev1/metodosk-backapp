/**
 * Lo que necesita comprar una alumna antes de empezar el reto.
 *
 * Lo definió Scarlett: en casa hacen falta mancuernas, banda y colchoneta;
 * en el gimnasio la banda basta, porque el resto ya está ahí.
 *
 * Vive en el servidor porque de acá sale el correo de compra. El frontend
 * tiene su propia copia para la vista de Recursos (ver
 * metodosk-frontapp/src/config/recursos.ts) — si cambia una, cambia la otra.
 */

export interface Recurso {
  nombre: string;
  /** Para qué sirve. Una línea: el correo no es el sitio para explayarse. */
  detalle: string;
}

export interface GrupoRecursos {
  /** Con qué frase se reconoce quien lee: "yo soy esta". */
  titulo: string;
  intro: string;
  recursos: Recurso[];
}

export const RECURSOS_CASA: GrupoRecursos = {
  titulo: "Si entrenas en casa",
  intro: "Con estas tres cosas haces el reto completo sin salir de tu sala.",
  recursos: [
    {
      nombre: "Mancuernas",
      detalle:
        "Un par. Si es tu primera vez, entre 3 y 5 kg cada una te va a servir para casi todo.",
    },
    {
      nombre: "Banda de resistencia",
      detalle: "De tela, de las que se ponen sobre el pantalón y no se enrollan.",
    },
    {
      nombre: "Mat o colchoneta",
      detalle: "Para el trabajo de piso. Mientras más gruesa, más cómodas las rodillas.",
    },
  ],
};

export const RECURSOS_GYM: GrupoRecursos = {
  titulo: "Si entrenas en el gimnasio",
  intro: "Solo tienes que llevar una cosa: el resto ya lo tienes ahí.",
  recursos: [
    {
      nombre: "Banda de resistencia",
      detalle: "De tela. Es la única que no vas a encontrar en la mayoría de gimnasios.",
    },
  ],
};

export const GRUPOS_RECURSOS = [RECURSOS_CASA, RECURSOS_GYM];

/** Dónde ve la alumna esta misma lista dentro de la plataforma. */
export function recursosUrl(): string {
  const base = (process.env.SITE_URL || "https://metodosk.ec").replace(/\/$/, "");
  return `${base}/recursos`;
}
