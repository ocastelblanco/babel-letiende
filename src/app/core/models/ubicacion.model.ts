/**
 * Tercer nivel del modelo jerárquico de ubicación física Espacio → Mueble →
 * Ubicación (`TODO.md` Tarea 2). Cada ubicación pertenece a un `Mueble`
 * existente. Ej. "Estante 1".
 */
export interface Ubicacion {
  ubicacionId: string;
  muebleId: string;
  nombre: string;
}
