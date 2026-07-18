/** Ubicación física de un libro dentro de la librería (tech-specs.md §4.3). */
export interface Estante {
  estanteId: string;
  /** Ej. "Espacio principal", "Exhibidor terraza", "Salón VIP". */
  espacio: string;
  /** Ej. "Biblioteca 1", "Mesa de descuentos". */
  mueble: string;
  /** Ej. "Estante 1". */
  ubicacion: string;
}
