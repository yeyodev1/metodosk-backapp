/**
 * La forma de una guía de nutrición. El contenido no vive acá.
 *
 * Este repositorio es público, y las guías son el material que las alumnas
 * pagaron: una línea de menú acá quedaría legible para cualquiera en GitHub,
 * para siempre y en cada copia del repo. Así que el contenido vive en la base
 * y entra por `npm run publicar-guias`, con el JSON que se queda en la
 * máquina de quien lo corre.
 *
 * El API lo entrega solo a quien tiene el reto correspondiente.
 */

export type AudienciaGuia = "recomposicion" | "volumen";

export interface ComidaGuia {
  tipo: string;
  texto: string;
}

export interface DiaGuia {
  numero: number;
  comidas: ComidaGuia[];
}

export interface TablaGuia {
  id: string;
  titulo: string;
  intro: string | null;
  columnas: string[];
  filas: string[][];
  notas: string[];
}

export interface Guia {
  audiencia: AudienciaGuia;
  /** El reto al que pertenece, como se llama en la compra. */
  reto: string;
  titulo: string;
  intro: string[];
  comoUsar: string[];
  /** Los días en que se repite el menú por ser de pierna. */
  diasDePierna: number[];
  dias: DiaGuia[];
  snacks: Array<{ numero: number; titulo: string | null; items: string[] }>;
  condimentos: Array<{ proteina: string; items: string[]; tip: string | null }>;
  tipsCondimentos: string[];
  armaTuPlato: {
    intro: string;
    pasos: Array<{ titulo: string; texto: string; porcion: string }>;
    ejemplo: string[];
  };
  tablas: TablaGuia[];
  listaCompras: { nota: string; ayuda: string; categorias: string[] };
  mealPrep: Array<{ titulo: string; items: string[] }>;
  suplementos: Array<{
    nombre: string;
    paraQuien: string[];
    cuando: string;
    precaucion: string;
    /** Dónde se consigue: Amazon, Fybeca, Al Peso… */
    dondeComprar: string[];
    /** La página del PDF con las marcas: ahí el dato son las fotos. */
    imagenes: string[];
  }>;
  /** El recetario en video, que las comidas citan todo el tiempo. */
  recetario: string;
}

