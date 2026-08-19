/**
 * Progreso de una corrida del proceso asíncrono "Validar libros" (PVP +
 * portada, por mueble) — primer patrón asíncrono del proyecto (ADR-012,
 * `docs/plan-validar-libros-async.md`). Un ítem de `babel-validaciones-libros`
 * = una corrida completa, coordinada por la Lambda interna
 * `validarLibrosWorker` (auto-invocada por lotes de 20 libros) y consultada
 * por polling desde `GET /api/validaciones-libros/:validacionId`.
 *
 * `colaBookIds`/`limitesMueble` son detalle interno del worker (permiten
 * calcular `muebleActualNombre` sin releer las tablas de ubicación en cada
 * lote) — `GET /api/validaciones-libros/:validacionId` los omite de la
 * respuesta, así que este tipo completo solo aplica al ítem crudo de
 * DynamoDB; el frontend consume `ResumenValidacionLibros` (abajo).
 */
export interface ValidacionLibros {
  /** PK, uuid generado por `POST /api/validaciones-libros`. */
  validacionId: string;
  estado: 'en_progreso' | 'completado' | 'error';
  /** Email del administrador que la inició (del token verificado, nunca del body). */
  iniciadoPor: string;
  iniciadoEn: string;
  /** Se actualiza en cada lote — usado para detectar corridas colgadas (más de 10 min sin avanzar). */
  actualizadoEn: string;

  /** Cola completa de `bookId` a procesar, agrupada por mueble (orden alfabético) — se calcula una sola vez al iniciar. */
  colaBookIds: string[];
  /** Cursor: próximo índice de `colaBookIds` sin procesar. */
  indiceActual: number;
  totalLibros: number;

  /** Límites acumulados por mueble sobre `colaBookIds` (ej. `[{nombre: "Biblioteca 1", hasta: 12}, ...]`) — permite resolver `muebleActualNombre` sin releer `babel-ubicaciones`/`babel-muebles`. */
  limitesMueble: LimiteMuebleValidacion[];

  librosRevisados: number;
  /** Libros cuyo PVP se reemplazó por el consenso (el más alto entre los scrapeados). */
  pvpActualizados: number;
  /** Libros cuya portada inválida se reemplazó automáticamente por una válida. */
  portadasCorregidas: number;
  /** Portada inválida sin reemplazo automático — requiere revisión manual del administrador. Nunca se borra la portada existente. */
  portadasPendientes: PortadaPendienteValidacion[];
  /** Fallos puntuales de un libro (nunca detienen el resto de la corrida). */
  erroresLibro: ErrorLibroValidacion[];

  /** Nombre del mueble cuyos libros se están procesando ahora mismo, `null` si la corrida ya terminó. */
  muebleActualNombre: string | null;
}

export interface LimiteMuebleValidacion {
  nombre: string;
  /** Índice (exclusivo) de `colaBookIds` hasta donde llegan los libros de este mueble. */
  hasta: number;
}

export interface PortadaPendienteValidacion {
  bookId: string;
  titulo: string;
  portadaUrl: string;
}

export interface ErrorLibroValidacion {
  bookId: string;
  mensaje: string;
}

/**
 * Lo que expone `GET /api/validaciones-libros/:validacionId` al frontend —
 * `ValidacionLibros` sin `colaBookIds`/`limitesMueble` (detalle interno del
 * worker, no algo que la UI necesite renderizar).
 */
export type ResumenValidacionLibros = Omit<ValidacionLibros, 'colaBookIds' | 'limitesMueble'>;
