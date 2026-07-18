/**
 * Un libro catalogado (tech-specs.md §4.3).
 *
 * `porcentajeDescuentoEditorial` es el margen que Le Tiende retiene sobre el
 * `pvp` en libros que la editorial deja en consignación (típico 35%); vale
 * 100 cuando el libro es propiedad de Le Tiende y no está en consignación
 * con ninguna editorial (MEMORY.md ADR-006). `costo` y `utilidadCatalogo` se
 * derivan de esos dos campos al catalogar, no se recalculan después.
 */
export interface Libro {
  /** `null` si el libro no tiene ISBN. */
  isbn: string | null;
  /** Identificador interno (uuid) — clave primaria si no hay ISBN. */
  bookId: string;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  /** Precio de venta al público, en pesos colombianos. */
  pvp: number;
  porcentajeDescuentoEditorial: number;
  /** `pvp * (1 - porcentajeDescuentoEditorial / 100)`. */
  costo: number;
  /** `pvp * (porcentajeDescuentoEditorial / 100)` — utilidad de referencia sin descuento de venta. */
  utilidadCatalogo: number;
  cantidadTotal: number;
  cantidadDisponible: number;
  estanteId: string;
  /** Email del vendedor/administrador que catalogó el libro. */
  creadoPor: string;
  /** Fecha ISO. */
  creadoEn: string;
  /** Fecha ISO. */
  actualizadoEn: string;
}
