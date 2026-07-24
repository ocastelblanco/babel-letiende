export type FormaDePago = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata';

/**
 * Una venta registrada (tech-specs.md §4.3).
 *
 * `porcentajeDescuentoVenta` es el descuento discrecional del vendedor al
 * momento de vender — independiente del `porcentajeDescuentoEditorial` del
 * libro (MEMORY.md ADR-006). `pvp` y `costoLibro` son una copia (snapshot)
 * unitaria de `Libro.pvp`/`Libro.costo` tomada en el momento de la venta,
 * para que un cambio posterior en la configuración de descuentos de
 * editorial no altere el costo/utilidad de ventas ya registradas. Un solo
 * registro de `Venta` representa `cantidad` ejemplares (TODO.md Tarea 2,
 * vender varios ejemplares del mismo libro en una sola transacción) —
 * `precioFinal`/`utilidad` son el TOTAL de la transacción, no el valor
 * unitario.
 */
export interface Venta {
  ventaId: string;
  bookId: string;
  isbn: string | null;
  /** Número de ejemplares vendidos en esta transacción. */
  cantidad: number;
  /** Precio unitario (snapshot de `Libro.pvp`). */
  pvp: number;
  porcentajeDescuentoVenta: number;
  /** `pvp * cantidad * (1 - porcentajeDescuentoVenta / 100)` — total de la transacción. */
  precioFinal: number;
  /** Costo unitario (snapshot de `Libro.costo`). */
  costoLibro: number;
  /** `precioFinal - costoLibro * cantidad` — total de la transacción. */
  utilidad: number;
  formaDePago: FormaDePago;
  /** Email del vendedor. */
  vendidoPor: string;
  /** Fecha ISO. */
  vendidoEn: string;
}
