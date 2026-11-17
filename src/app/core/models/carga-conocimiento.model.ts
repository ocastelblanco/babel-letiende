/**
 * Progreso y cobertura de la carga retroactiva del conocimiento del asistente
 * (T-0013, ADR-018). Solo cifras agregadas: nunca lleva el texto de una sinopsis.
 * Contrato de `GET /api/carga-conocimiento/:cargaId` (sin `colaBookIds`).
 */
export interface ConteoCobertura {
  total: number;
  /** Con sinopsis de al menos 200 caracteres. */
  utiles: number;
}

export interface ResumenCargaConocimiento {
  cargaId: string;
  estado: 'en_progreso' | 'completado' | 'error';
  iniciadoPor: string;
  iniciadoEn: string;
  actualizadoEn: string;
  indiceActual: number;
  totalLibros: number;
  librosRevisados: number;
  guardados: number;
  yaTenian: number;
  sinIsbn: number;
  sinDatos: number;
  errores: number;
  conSinopsisUtil: number;
  conSinopsisCorta: number;
  sinSinopsis: number;
  porIdioma: Record<string, ConteoCobertura>;
  porFuente: Record<string, ConteoCobertura>;
}
