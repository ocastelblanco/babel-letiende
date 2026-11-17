/**
 * Conocimiento de un libro para el asistente de recomendación (ADR-018,
 * `asistente-ia/PLAN.md` Fase 1): sinopsis, categorías, idioma, páginas y
 * clasificación por edad. Vive en su propia tabla (`babel-libros-conocimiento`)
 * y solo lo ve el personal: la sinopsis es texto de terceros de uso interno y
 * NUNCA se muestra en el catálogo público.
 */
export type ClasificacionEdad = 'NOT_MATURE' | 'MATURE';

/** Lo que se envía en el campo `conocimiento` de `POST`/`PUT /api/libros`. */
export interface DatosConocimiento {
  sinopsis: string | null;
  categorias: string[];
  /** ISO 639-1 en minúscula (`es`, `en`). */
  idioma: string | null;
  paginas: number | null;
  clasificacionEdad: ClasificacionEdad | null;
  /** `google-books`, `sitio:<dominio>` o `manual`; `null` si no hay sinopsis. */
  fuenteSinopsis: string | null;
}

/** Contrato de `GET /api/libros/:bookId/conocimiento`. Un libro sin conocimiento responde todo vacío y `actualizadoEn: ''`. */
export interface ConocimientoLibro extends DatosConocimiento {
  bookId: string;
  actualizadoEn: string;
}
