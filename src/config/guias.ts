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
  /**
   * Los menús de los bloques siguientes: el del mes 2, el del mes 3.
   *
   * Karen entrega cada mes un menú nuevo con sus propias porciones de
   * intercambio; lo demás (snacks, condimentos, compras, suplementos) sigue
   * siendo el de la guía. El de arriba es el menú del mes 1 y no se reemplaza:
   * la que todavía no llega al mes 2 lo sigue necesitando.
   *
   * El API manda solo los que la alumna ya tiene abiertos.
   */
  menus?: MenuGuia[];
}

export interface MenuGuia {
  /** El bloque al que pertenece: 2 o 3. Se abre en la semana (mes - 1) * 4 + 1. */
  mes: number;
  titulo: string;
  comoUsar: string[];
  diasDePierna: number[];
  dias: DiaGuia[];
  /** Las tablas de intercambio de este menú: las porciones cambian de mes a mes. */
  tablas: TablaGuia[];
  recetario: string;
}

