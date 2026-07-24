/**
 * Segundo nivel del modelo jerárquico de ubicación física Espacio → Mueble →
 * Ubicación (`TODO.md` Tarea 2). Cada mueble pertenece a un `Espacio`
 * existente. Ej. "Biblioteca 1", "Mesa de descuentos".
 */
export interface Mueble {
  muebleId: string;
  espacioId: string;
  nombre: string;
}
