/**
 * Configuración de descuento editorial por editorial (tech-specs.md §4.3).
 *
 * El 100% (libro propio de Le Tiende, sin consignación) es siempre una
 * opción seleccionable al catalogar cualquier libro, independientemente de
 * su editorial y de si esa editorial tiene o no una fila aquí.
 */
export interface DescuentoEditorial {
  editorial: string;
  /** Ej. 35 para la mayoría de editoriales en consignación. */
  porcentajePorDefecto: number;
  /** Alternativas propias de esa editorial (ej. editoriales independientes). */
  porcentajesDisponibles: number[];
}
