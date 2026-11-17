import { FormControl, FormGroup, Validators } from '@angular/forms';
import type { ClasificacionEdad, DatosConocimiento } from '../../core/models/conocimiento.model';

/** Mismos topes que valida el backend (`validarConocimiento` en `server/api/handlers/libros.ts`). */
export const MAXIMO_CARACTERES_SINOPSIS = 4000;
const MAXIMO_CATEGORIAS = 10;
const MAXIMO_CARACTERES_CATEGORIA = 100;
const MAXIMO_PAGINAS = 20_000;

/** Valor del grupo de formulario: todo texto o número, tal como lo escribe la persona. */
export interface ValorConocimientoFormulario {
  sinopsis: string;
  /** Separadas por comas. */
  categorias: string;
  idioma: string;
  paginas: number | null;
  clasificacionEdad: '' | ClasificacionEdad;
}

export const CONOCIMIENTO_FORMULARIO_VACIO: ValorConocimientoFormulario = {
  sinopsis: '',
  categorias: '',
  idioma: '',
  paginas: null,
  clasificacionEdad: '',
};

export type GrupoConocimiento = ReturnType<typeof crearGrupoConocimiento>;

/** Grupo de formulario reactivo con los 5 campos editables del conocimiento. Compartido por Catalogar y Editar. */
export function crearGrupoConocimiento() {
  return new FormGroup({
    sinopsis: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(MAXIMO_CARACTERES_SINOPSIS)],
    }),
    categorias: new FormControl('', { nonNullable: true }),
    idioma: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/)],
    }),
    paginas: new FormControl<number | null>(null, {
      validators: [Validators.min(1), Validators.max(MAXIMO_PAGINAS), Validators.pattern(/^\d+$/)],
    }),
    clasificacionEdad: new FormControl<'' | ClasificacionEdad>('', { nonNullable: true }),
  });
}

/** Convierte lo guardado (o sugerido por la API) al valor del formulario. `null` → formulario vacío. */
export function aValorFormulario(datos: DatosConocimiento | null): ValorConocimientoFormulario {
  if (!datos) {
    return { ...CONOCIMIENTO_FORMULARIO_VACIO };
  }
  return {
    sinopsis: datos.sinopsis ?? '',
    categorias: (datos.categorias ?? []).join(', '),
    idioma: datos.idioma ?? '',
    paginas: datos.paginas ?? null,
    clasificacionEdad: datos.clasificacionEdad ?? '',
  };
}

/**
 * Convierte el formulario en el payload que espera el backend. Las categorías
 * se separan por comas, se limpian, se quitan repetidas y se recortan a los
 * topes del backend; el idioma va en minúscula. Sin sinopsis no hay fuente; con
 * sinopsis y sin fuente conocida, la escribió una persona (`manual`).
 */
export function aDatosConocimiento(valor: ValorConocimientoFormulario, fuente: string | null): DatosConocimiento {
  const sinopsis = valor.sinopsis.trim() === '' ? null : valor.sinopsis.trim();
  const categorias = [
    ...new Set(
      valor.categorias
        .split(',')
        .map((categoria) => categoria.trim().slice(0, MAXIMO_CARACTERES_CATEGORIA))
        .filter((categoria) => categoria !== ''),
    ),
  ].slice(0, MAXIMO_CATEGORIAS);
  const idioma = valor.idioma.trim() === '' ? null : valor.idioma.trim().toLowerCase();
  const paginas = typeof valor.paginas === 'number' && Number.isInteger(valor.paginas) ? valor.paginas : null;

  return {
    sinopsis,
    categorias,
    idioma,
    paginas,
    clasificacionEdad: valor.clasificacionEdad === '' ? null : valor.clasificacionEdad,
    fuenteSinopsis: sinopsis === null ? null : (fuente ?? 'manual'),
  };
}

/** `true` si no hay nada que guardar: Catalogar no envía `conocimiento` en ese caso. */
export function conocimientoVacio(datos: DatosConocimiento): boolean {
  return (
    datos.sinopsis === null &&
    datos.categorias.length === 0 &&
    datos.idioma === null &&
    datos.paginas === null &&
    datos.clasificacionEdad === null
  );
}

/** Nombre legible de la fuente de la sinopsis para mostrarlo bajo el campo. `''` si no hay fuente. */
export function etiquetaFuenteSinopsis(fuente: string | null): string {
  if (!fuente) {
    return '';
  }
  if (fuente === 'google-books') {
    return 'Google Books';
  }
  if (fuente === 'manual') {
    return 'escrita a mano';
  }
  if (fuente.startsWith('sitio:')) {
    return fuente.slice('sitio:'.length).replace(/^www\./, '');
  }
  return fuente;
}
