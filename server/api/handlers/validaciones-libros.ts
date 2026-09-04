import { randomUUID } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
  Handler,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import {
  escanearProyeccion,
  escanearTodo,
  guardar,
  obtenerPorClave,
  omitirCamposNulos,
} from '../services/dynamodb';
import { portadaEsInvalida, portadaUrlResponde, scrapearSitio, type SitioScraping } from '../services/scraping';

/**
 * Primer patrón asíncrono del proyecto (`docs/plan-validar-libros-async.md`,
 * ADR-012, `TODO.md` Tarea 3): revalida en bloque, contra `babel-sitios-
 * scraping`, el PVP y la portada de todo el inventario catalogado, avanzando
 * mueble por mueble para no arriesgar el timeout de Lambda sobre 3.000+
 * libros. Tres puntos de entrada en este archivo:
 *
 *   - `handlerIniciar` (`POST /api/validaciones-libros`): crea el ítem de
 *     progreso y dispara la primera invocación del worker.
 *   - `handlerWorker` (Lambda interna, SIN ruta HTTP): procesa un lote de
 *     `TAMANO_LOTE` libros y se auto-invoca hasta agotar la cola.
 *   - `handlerConsultar` (`GET /api/validaciones-libros/:validacionId`):
 *     polling del progreso desde el frontend.
 */

/** Copia local de `src/app/core/models/libro.model.ts` — mismo motivo que `libros.ts`/`metadatos.ts` (límite de `rootDir` de `server/tsconfig.json`). */
interface Libro {
  isbn: string | null;
  bookId: string;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number;
  porcentajeDescuentoEditorial: number;
  costo: number;
  utilidadCatalogo: number;
  cantidadTotal: number;
  cantidadDisponible: number;
  ubicacionId: string;
  creadoPor: string;
  creadoEn: string;
  actualizadoEn: string;
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que arriba. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

/** Copias locales de `mueble.model.ts`/`ubicacion.model.ts` — mismo motivo que `libros.ts`. Solo se necesita `Espacio` para resolver ubicaciones, no para agrupar por mueble, así que no se copia aquí. */
interface Mueble {
  muebleId: string;
  espacioId: string;
  nombre: string;
}

interface Ubicacion {
  ubicacionId: string;
  muebleId: string;
  nombre: string;
}

/** Copia local de `src/app/core/models/validacion-libros.model.ts` — mismo motivo que arriba. */
interface LimiteMueble {
  nombre: string;
  hasta: number;
}

interface PortadaPendiente {
  bookId: string;
  titulo: string;
  portadaUrl: string;
}

interface ErrorLibroValidacion {
  bookId: string;
  mensaje: string;
}

interface ValidacionLibros {
  validacionId: string;
  estado: 'en_progreso' | 'completado' | 'error';
  iniciadoPor: string;
  iniciadoEn: string;
  actualizadoEn: string;
  colaBookIds: string[];
  indiceActual: number;
  totalLibros: number;
  limitesMueble: LimiteMueble[];
  librosRevisados: number;
  pvpActualizados: number;
  portadasCorregidas: number;
  portadasPendientes: PortadaPendiente[];
  erroresLibro: ErrorLibroValidacion[];
  muebleActualNombre: string | null;
}

/** Tamaño de lote fijo por invocación del worker, independiente del tamaño del mueble que esté cruzando (`plan-validar-libros-async.md` §4.2). */
const TAMANO_LOTE = 20;

/** Antigüedad máxima de `actualizadoEn` antes de considerar una corrida `en_progreso` como abandonada (`plan-validar-libros-async.md` §6). */
const CORRIDA_ABANDONADA_MS = 10 * 60 * 1000;

/** Clave interna para agrupar libros cuya cadena `ubicacionId → Ubicacion.muebleId` está rota (dato inconsistente) — nunca se expone tal cual, se traduce a "Sin mueble asignado" en `construirColaPorMueble`. */
const SIN_MUEBLE = '__sin_mueble__';

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

function nombreTablaLibros(): string {
  const nombre = process.env['TABLA_LIBROS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_LIBROS.');
  }
  return nombre;
}

function nombreTablaUbicaciones(): string {
  const nombre = process.env['TABLA_UBICACIONES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_UBICACIONES.');
  }
  return nombre;
}

function nombreTablaMuebles(): string {
  const nombre = process.env['TABLA_MUEBLES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_MUEBLES.');
  }
  return nombre;
}

function nombreTablaSitiosScraping(): string {
  const nombre = process.env['TABLA_SITIOS_SCRAPING'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_SITIOS_SCRAPING.');
  }
  return nombre;
}

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

function nombreTablaValidaciones(): string {
  const nombre = process.env['TABLA_VALIDACIONES_LIBROS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_VALIDACIONES_LIBROS.');
  }
  return nombre;
}

// ---------------------------------------------------------------------------
// Auto-invocación (ADR-012) — compartida por handlerIniciar (primer disparo)
// y handlerWorker (continuación de la cola).
// ---------------------------------------------------------------------------

const clienteLambda = new LambdaClient({});

async function invocarWorker(validacionId: string): Promise<void> {
  const nombreFuncion = process.env['NOMBRE_FUNCION_WORKER'];
  if (!nombreFuncion) {
    throw new Error('Falta la variable de entorno NOMBRE_FUNCION_WORKER.');
  }
  await clienteLambda.send(
    new InvokeCommand({
      FunctionName: nombreFuncion,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ validacionId })),
    }),
  );
}

// ---------------------------------------------------------------------------
// Agrupación de la cola por mueble (pura, sin red/DynamoDB — exportada para tests)
// ---------------------------------------------------------------------------

/**
 * Agrupa `libros` por mueble (vía `libro.ubicacionId → Ubicacion.muebleId`),
 * ordena los grupos alfabéticamente por nombre de mueble (mismo criterio que
 * los desplegables de `PRD.md` §5.6) y ordena los libros dentro de cada
 * grupo por título (determinismo, sin depender del orden de un `Scan`).
 * Libros con `ubicacionId` roto (ubicación ya no existe) van al final, en un
 * grupo "Sin mueble asignado" — nunca se descartan.
 */
export function construirColaPorMueble(
  libros: Libro[],
  ubicaciones: Ubicacion[],
  muebles: Mueble[],
): { colaBookIds: string[]; limitesMueble: LimiteMueble[] } {
  const muebleIdPorUbicacion = new Map(ubicaciones.map((ubicacion) => [ubicacion.ubicacionId, ubicacion.muebleId]));
  const nombrePorMuebleId = new Map(muebles.map((mueble) => [mueble.muebleId, mueble.nombre]));

  const librosPorClave = new Map<string, Libro[]>();
  for (const libro of libros) {
    const muebleId = muebleIdPorUbicacion.get(libro.ubicacionId);
    const clave = muebleId && nombrePorMuebleId.has(muebleId) ? muebleId : SIN_MUEBLE;
    const grupo = librosPorClave.get(clave);
    if (grupo) {
      grupo.push(libro);
    } else {
      librosPorClave.set(clave, [libro]);
    }
  }

  const gruposConMueble = [...librosPorClave.entries()]
    .filter(([clave]) => clave !== SIN_MUEBLE)
    .sort(([claveA], [claveB]) =>
      (nombrePorMuebleId.get(claveA) ?? '').localeCompare(nombrePorMuebleId.get(claveB) ?? ''),
    );

  const grupoSinMueble = librosPorClave.get(SIN_MUEBLE);
  const gruposOrdenados = grupoSinMueble ? [...gruposConMueble, [SIN_MUEBLE, grupoSinMueble] as const] : gruposConMueble;

  const colaBookIds: string[] = [];
  const limitesMueble: LimiteMueble[] = [];
  for (const [clave, grupo] of gruposOrdenados) {
    const librosOrdenados = [...grupo].sort((a, b) => a.titulo.localeCompare(b.titulo));
    colaBookIds.push(...librosOrdenados.map((libro) => libro.bookId));
    limitesMueble.push({
      nombre: clave === SIN_MUEBLE ? 'Sin mueble asignado' : (nombrePorMuebleId.get(clave) ?? clave),
      hasta: colaBookIds.length,
    });
  }

  return { colaBookIds, limitesMueble };
}

/** `null` si `indice` ya superó el último límite (corrida terminada). Exportada para tests. */
export function nombreMuebleDesdeIndice(indice: number, limitesMueble: LimiteMueble[]): string | null {
  return limitesMueble.find((limite) => indice < limite.hasta)?.nombre ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/validaciones-libros — inicia una corrida
// ---------------------------------------------------------------------------

/**
 * Busca una corrida `en_progreso`. Si la encuentra pero lleva más de
 * `CORRIDA_ABANDONADA_MS` sin tocar `actualizadoEn` (todos los reintentos de
 * Lambda del worker se agotaron ante un fallo fatal), la marca `error` y
 * libera el slot para una corrida nueva en vez de bloquear al administrador
 * para siempre (`plan-validar-libros-async.md` §6). Usa `escanearProyeccion`
 * (solo `validacionId`/`estado`/`actualizadoEn`) para no traer la cola
 * completa de cada corrida histórica solo para este chequeo.
 */
async function buscarCorridaEnProgreso(): Promise<ValidacionLibros | undefined> {
  const resumenes = await escanearProyeccion<Pick<ValidacionLibros, 'validacionId' | 'estado' | 'actualizadoEn'>>(
    nombreTablaValidaciones(),
    ['validacionId', 'estado', 'actualizadoEn'],
  );
  const activa = resumenes.find((resumen) => resumen.estado === 'en_progreso');
  if (!activa) {
    return undefined;
  }

  const corridaCompleta = await obtenerPorClave<ValidacionLibros>(nombreTablaValidaciones(), {
    validacionId: activa.validacionId,
  });
  if (!corridaCompleta) {
    return undefined;
  }

  const antiguedadMs = Date.now() - new Date(corridaCompleta.actualizadoEn).getTime();
  if (antiguedadMs <= CORRIDA_ABANDONADA_MS) {
    return corridaCompleta;
  }

  await guardar(nombreTablaValidaciones(), {
    ...corridaCompleta,
    estado: 'error' as const,
    actualizadoEn: new Date().toISOString(),
  });
  return undefined;
}

/**
 * `POST /api/validaciones-libros` — inicia una corrida asíncrona de
 * validación de PVP/portada sobre el inventario completo. Exige rol
 * `administrador` exclusivamente (mismo criterio que otras operaciones de
 * bulk/config, CLAUDE.md A01, ADR-008). Responde `202` de inmediato — el
 * trabajo real lo hace `handlerWorker`, auto-invocado sin esperar su
 * respuesta.
 */
export const handlerIniciar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para iniciar una validación en Babel.' });
    }

    const corridaActiva = await buscarCorridaEnProgreso();
    if (corridaActiva) {
      return respuestaJson(409, {
        error: 'Ya hay una validación en curso.',
        validacionId: corridaActiva.validacionId,
      });
    }

    const [libros, ubicaciones, muebles] = await Promise.all([
      escanearTodo<Libro>(nombreTablaLibros()),
      escanearTodo<Ubicacion>(nombreTablaUbicaciones()),
      escanearTodo<Mueble>(nombreTablaMuebles()),
    ]);

    const { colaBookIds, limitesMueble } = construirColaPorMueble(libros, ubicaciones, muebles);

    const ahora = new Date().toISOString();
    const validacionId = randomUUID();
    const hayLibros = colaBookIds.length > 0;
    const validacion: ValidacionLibros = {
      validacionId,
      estado: hayLibros ? 'en_progreso' : 'completado',
      iniciadoPor: email,
      iniciadoEn: ahora,
      actualizadoEn: ahora,
      colaBookIds,
      indiceActual: hayLibros ? 0 : colaBookIds.length,
      totalLibros: colaBookIds.length,
      limitesMueble,
      librosRevisados: 0,
      pvpActualizados: 0,
      portadasCorregidas: 0,
      portadasPendientes: [],
      erroresLibro: [],
      muebleActualNombre: hayLibros ? nombreMuebleDesdeIndice(0, limitesMueble) : null,
    };

    await guardar(nombreTablaValidaciones(), validacion);

    if (hayLibros) {
      await invocarWorker(validacionId);
    }

    return respuestaJson(202, { validacionId });
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

// ---------------------------------------------------------------------------
// validarLibrosWorker — Lambda interna, sin ruta HTTP
// ---------------------------------------------------------------------------

interface ResultadoProcesarLibro {
  pvpActualizado: boolean;
  portadaCorregida: boolean;
  portadaPendiente?: PortadaPendiente;
  error?: ErrorLibroValidacion;
}

/** Techo de sanidad para el PVP (CLAUDE.md A08) — mismo valor que `libros.ts`/`scraping.ts`. */
const PVP_MAXIMO = 5_000_000;

function validarPvpConsenso(valor: number | undefined): number | undefined {
  return valor !== undefined && Number.isFinite(valor) && valor > 0 && valor <= PVP_MAXIMO ? valor : undefined;
}

/**
 * Prueba los sitios `info: true`, en orden de `prioridad` (ya ordenados por
 * el llamador), hasta encontrar una portada que pase `!portadaEsInvalida` —
 * mismo criterio de prioridad ascendente que `resolverMetadatosCompletos`
 * (`metadatos.ts`). `null` si ninguno resuelve una portada válida.
 */
async function buscarPortadaValida(
  isbn: string,
  sitiosInfoPorPrioridad: SitioScraping[],
  palabrasClaveInvalidasGlobales: string[],
): Promise<string | null> {
  const resultados = await Promise.all(
    sitiosInfoPorPrioridad.map((sitio) => scrapearSitio(sitio, isbn)),
  );
  for (const resultado of resultados) {
    if (resultado.portadaUrl && !portadaEsInvalida(resultado.portadaUrl, palabrasClaveInvalidasGlobales)) {
      return resultado.portadaUrl;
    }
  }
  return null;
}

/**
 * Procesa un libro puntual: regla de consenso de PVP (el más alto entre los
 * scrapeados, solo si difiere del vigente — libros sin ISBN se saltan esta
 * parte) + chequeo global de portada inválida (con o sin ISBN, ver
 * `plan-validar-libros-async.md` §1). Nunca lanza: cualquier fallo se
 * captura y se reporta en `erroresLibro`, sin detener el resto del lote
 * (CLAUDE.md A08, mismo criterio que `scraping.ts`/`metadatos.ts`).
 */
async function procesarLibro(
  bookId: string,
  sitiosPvp: SitioScraping[],
  sitiosInfoPorPrioridad: SitioScraping[],
  palabrasClaveInvalidasGlobales: string[],
): Promise<ResultadoProcesarLibro> {
  try {
    const libro = await obtenerPorClave<Libro>(nombreTablaLibros(), { bookId });
    if (!libro) {
      // El libro pudo eliminarse mientras esperaba su turno en la cola — no
      // es un error, se omite en silencio.
      return { pvpActualizado: false, portadaCorregida: false };
    }

    let libroActualizado = libro;
    let pvpActualizado = false;
    let portadaCorregida = false;
    let portadaPendiente: PortadaPendiente | undefined;

    if (libro.isbn !== null && sitiosPvp.length > 0) {
      const isbn = libro.isbn;
      const resultadosPvp = await Promise.all(sitiosPvp.map((sitio) => scrapearSitio(sitio, isbn)));
      const pvpsValidos = resultadosPvp
        .map((resultado) => validarPvpConsenso(resultado.pvp))
        .filter((pvp): pvp is number => pvp !== undefined);

      if (pvpsValidos.length > 0) {
        const pvpReferencia = Math.max(...pvpsValidos);
        if (pvpReferencia !== libroActualizado.pvp) {
          libroActualizado = {
            ...libroActualizado,
            pvp: pvpReferencia,
            costo: Math.round(pvpReferencia * (1 - libroActualizado.porcentajeDescuentoEditorial / 100)),
            utilidadCatalogo: Math.round(pvpReferencia * (libroActualizado.porcentajeDescuentoEditorial / 100)),
          };
          pvpActualizado = true;
        }
      }
    }

    if (libroActualizado.portadaUrl !== null) {
      const portadaInvalidaPorPalabraClave = portadaEsInvalida(libroActualizado.portadaUrl, palabrasClaveInvalidasGlobales);
      // Corto-circuito: si ya sabemos que es inválida por palabra clave, no
      // vale la pena gastar una petición HTTP adicional para confirmarlo.
      const portadaRespondeHttp = portadaInvalidaPorPalabraClave
        ? true
        : await portadaUrlResponde(libroActualizado.portadaUrl);

      if (portadaInvalidaPorPalabraClave || !portadaRespondeHttp) {
        const isbnActual = libroActualizado.isbn;
        const portadaNueva =
          isbnActual !== null ? await buscarPortadaValida(isbnActual, sitiosInfoPorPrioridad, palabrasClaveInvalidasGlobales) : null;

        if (portadaNueva) {
          libroActualizado = { ...libroActualizado, portadaUrl: portadaNueva };
          portadaCorregida = true;
        } else {
          // Nunca se borra la portada existente (CLAUDE.md A08): mejor una
          // portada dudosa que ninguna — se señala para revisión manual.
          portadaPendiente = { bookId, titulo: libroActualizado.titulo, portadaUrl: libroActualizado.portadaUrl };
        }
      }
    }

    if (pvpActualizado || portadaCorregida) {
      await guardar(
        nombreTablaLibros(),
        omitirCamposNulos({ ...libroActualizado, actualizadoEn: new Date().toISOString() }, ['isbn']),
      );
    }

    return { pvpActualizado, portadaCorregida, portadaPendiente };
  } catch (error) {
    console.error(`validarLibrosWorker: fallo inesperado procesando bookId=${bookId}`, error);
    return {
      pvpActualizado: false,
      portadaCorregida: false,
      error: { bookId, mensaje: 'Fallo inesperado al procesar este libro.' },
    };
  }
}

/**
 * Lambda interna (SIN evento `httpApi` en `serverless.yml`, se invoca por
 * `InvokeCommand`) — procesa un lote fijo de `TAMANO_LOTE` libros de la cola
 * de `validacionId` y se auto-invoca hasta agotarla (ADR-012). Idempotente
 * respecto al progreso: siempre relee `indiceActual` desde DynamoDB antes de
 * avanzar, así que un reintento automático de Lambda (`InvocationType:
 * 'Event'` reintenta hasta 2 veces ante una excepción no capturada) en el
 * peor caso reprocesa el mismo lote una vez más, sin duplicar trabajo de
 * forma indefinida. Si `estado !== 'en_progreso'` al leer el ítem, termina de
 * inmediato — protección ante una auto-invocación duplicada sobre una
 * corrida ya resuelta o abandonada.
 */
export const handlerWorker: Handler<{ validacionId: string }, void> = async (evento) => {
  const { validacionId } = evento;

  const validacion = await obtenerPorClave<ValidacionLibros>(nombreTablaValidaciones(), { validacionId });
  if (!validacion || validacion.estado !== 'en_progreso') {
    return;
  }

  const loteBookIds = validacion.colaBookIds.slice(validacion.indiceActual, validacion.indiceActual + TAMANO_LOTE);

  let sitios: SitioScraping[] = [];
  try {
    // `palabrasClaveInvalidas` puede faltar en filas guardadas antes de la
    // Tarea 2 — mismo gotcha ya documentado en `metadatos.ts`.
    sitios = (await escanearTodo<SitioScraping>(nombreTablaSitiosScraping())).map((sitio) => ({
      ...sitio,
      palabrasClaveInvalidas: sitio.palabrasClaveInvalidas ?? [],
    }));
  } catch (error) {
    console.error(`validarLibrosWorker: falló el Scan de babel-sitios-scraping, validacionId=${validacionId}`, error);
  }

  const palabrasClaveInvalidasGlobales = [
    ...new Set(sitios.filter((sitio) => sitio.info).flatMap((sitio) => sitio.palabrasClaveInvalidas)),
  ];
  const sitiosPvp = sitios.filter((sitio) => sitio.pvp);
  const sitiosInfoPorPrioridad = sitios.filter((sitio) => sitio.info).sort((a, b) => a.prioridad - b.prioridad);

  const resultados = await Promise.all(
    loteBookIds.map((bookId) => procesarLibro(bookId, sitiosPvp, sitiosInfoPorPrioridad, palabrasClaveInvalidasGlobales)),
  );

  const nuevoIndice = Math.min(validacion.indiceActual + TAMANO_LOTE, validacion.totalLibros);
  const terminada = nuevoIndice >= validacion.totalLibros;

  const actualizada: ValidacionLibros = {
    ...validacion,
    indiceActual: nuevoIndice,
    librosRevisados: validacion.librosRevisados + resultados.length,
    pvpActualizados: validacion.pvpActualizados + resultados.filter((resultado) => resultado.pvpActualizado).length,
    portadasCorregidas:
      validacion.portadasCorregidas + resultados.filter((resultado) => resultado.portadaCorregida).length,
    portadasPendientes: [
      ...validacion.portadasPendientes,
      ...resultados.flatMap((resultado) => (resultado.portadaPendiente ? [resultado.portadaPendiente] : [])),
    ],
    erroresLibro: [
      ...validacion.erroresLibro,
      ...resultados.flatMap((resultado) => (resultado.error ? [resultado.error] : [])),
    ],
    muebleActualNombre: nombreMuebleDesdeIndice(nuevoIndice, validacion.limitesMueble),
    estado: terminada ? 'completado' : 'en_progreso',
    actualizadoEn: new Date().toISOString(),
  };

  await guardar(nombreTablaValidaciones(), actualizada);

  if (!terminada) {
    await invocarWorker(validacionId);
  }
};

// ---------------------------------------------------------------------------
// GET /api/validaciones-libros/:validacionId — polling
// ---------------------------------------------------------------------------

/**
 * `GET /api/validaciones-libros/:validacionId` — polling del progreso de una
 * corrida. Exige rol `administrador` exclusivamente, mismo criterio que
 * `handlerIniciar`. Omite `colaBookIds`/`limitesMueble` de la respuesta —
 * detalle interno del worker, no algo que el frontend necesite renderizar
 * (`plan-validar-libros-async.md` §4.3).
 */
export const handlerConsultar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para consultar validaciones en Babel.' });
    }

    const validacionId = event.pathParameters?.['validacionId'];
    if (!validacionId) {
      return respuestaJson(400, { error: 'Falta el validacionId en la ruta.' });
    }

    const validacion = await obtenerPorClave<ValidacionLibros>(nombreTablaValidaciones(), { validacionId });
    if (!validacion) {
      return respuestaJson(404, { error: 'La validación no existe.' });
    }

    const { colaBookIds: _colaBookIds, limitesMueble: _limitesMueble, ...resumen } = validacion;
    return respuestaJson(200, resumen);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
