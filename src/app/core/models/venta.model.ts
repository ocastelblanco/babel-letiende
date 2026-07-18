export type FormaDePago = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata';

/**
 * Una venta registrada (tech-specs.md §4.3).
 *
 * `porcentajeDescuentoVenta` es el descuento discrecional del vendedor al
 * momento de vender — independiente del `porcentajeDescuentoEditorial` del
 * libro (MEMORY.md ADR-006). `pvp` y `costoLibro` son una copia (snapshot)
 * de `Libro.pvp`/`Libro.costo` tomada en el momento de la venta, para que un
 * cambio posterior en la configuración de descuentos de editorial no altere
 * el costo/utilidad de ventas ya registradas.
 */
export interface Venta {
  ventaId: string;
  bookId: string;
  isbn: string | null;
  pvp: number;
  porcentajeDescuentoVenta: number;
  /** `pvp * (1 - porcentajeDescuentoVenta / 100)`. */
  precioFinal: number;
  costoLibro: number;
  /** `precioFinal - costoLibro`. */
  utilidad: number;
  formaDePago: FormaDePago;
  /** Email del vendedor. */
  vendidoPor: string;
  /** Fecha ISO. */
  vendidoEn: string;
}
