/**
 * Copia propia (herramienta standalone, sin importar de `src/app/core/models/`)
 * del modelo jerárquico de ubicación física Espacio → Mueble de Babel.
 */
export interface Espacio {
  espacioId: string;
  nombre: string;
}

export interface Mueble {
  muebleId: string;
  espacioId: string;
  nombre: string;
}
