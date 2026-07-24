/**
 * Primer nivel del modelo jerárquico de ubicación física Espacio → Mueble →
 * Ubicación (`TODO.md` Tarea 2), que eventualmente reemplaza a `Estante`
 * (`estante.model.ts`). Ej. "Espacio principal", "Exhibidor terraza".
 */
export interface Espacio {
  espacioId: string;
  nombre: string;
}
