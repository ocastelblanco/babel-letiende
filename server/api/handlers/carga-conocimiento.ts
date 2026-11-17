import { randomUUID } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2, Handler } from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { escanearProyeccion, guardar, obtenerPorClave } from '../services/dynamodb';
import { resolverMetadatosCompletos } from './metadatos';

/**
 * Carga retroactiva del conocimiento del asistente (`asistente-ia/PLAN.md`,
 * T-0013, ADR-018): recorre el inventario ya catalogado y llena
 * `babel-libros-conocimiento` (sinopsis, categorías, idioma, páginas,
 * clasificación por edad) con las mismas fuentes que `GET /api/metadatos/:isbn`.
 * Mismo patrón asíncrono que "Validar libros" (ADR-012):
 *
 *   - `handlerIniciar` (`POST /api/carga-conocimiento`): crea el ítem de progreso
 *     con la cola de `bookId` y dispara el worker. Solo administrador.
 *   - `handlerWorker` (Lambda interna, SIN ruta HTTP): procesa un lote y se
 *     auto-invoca hasta agotar la cola.
 *   - `handlerConsultar` (`GET /api/carga-conocimiento/:cargaId`): progreso y
 *     reporte de cobertura. Solo administrador.
 *
 * Reglas: nunca pisa una sinopsis ya guardada (ni la escrita a mano); un libro sin
 * ISBN se omite; un fallo en un libro no detiene el lote; y el reporte solo lleva
 * cifras agregadas, jamás el texto de una sinopsis.
 */

/** Copias locales de los modelos — mismo motivo que `validaciones-libros.ts` (límite de `rootDir`). */
interface Libro {
  bookId: string;
  isbn: string | null;
}

interface Usuario {
  email: string;
  rol: 'administrador' | 'vendedor';
}

export interface ConocimientoGuardado {
  bookId: string;
  sinopsis: string | null;
  categorias: string[];
  idioma: string | null;
  paginas: number | null;
  clasificacionEdad: 'NOT_MATURE' | 'MATURE' | null;
  fuenteSinopsis: string | null;
  actualizadoEn: string;
}

/** Cobertura: una sinopsis de al menos este largo cuenta como útil para recomendar (`PLAN.md` T-0013). */
export const MINIMO_SINOPSIS_UTIL = 200;

const CLAVE_SIN_IDIOMA = 'desconocido';
const CLAVE_SIN_SINOPSIS = 'sin-sinopsis';

export interface Conteo {
  total: number;
  utiles: number;
}

export interface CargaConocimiento {
  cargaId: string;
  estado: 'en_progreso' | 'completado' | 'error';
  iniciadoPor: string;
  iniciadoEn: string;
  actualizadoEn: string;
  colaBookIds: string[];
  indiceActual: number;
  totalLibros: number;
  librosRevisados: number;
  /** Libros a los que se les escribió conocimiento nuevo en esta corrida. */
  guardados: number;
  /** Libros que ya tenían sinopsis y no se tocaron. */
  yaTenian: number;
  sinIsbn: number;
  /** Con ISBN, pero ninguna fuente devolvió nada. */
  sinDatos: number;
  errores: number;
  /** Cobertura final de los libros revisados (la nueva y la que ya había). */
  conSinopsisUtil: number;
  conSinopsisCorta: number;
  sinSinopsis: number;
  porIdioma: Record<string, Conteo>;
  porFuente: Record<string, Conteo>;
}

/** Libros por invocación y cuántos se consultan a la vez: acota la presión sobre los sitios (cada libro toca hasta 6 sitios y Google Books). */
const TAMANO_LOTE = 9;
const CONCURRENCIA = 3;
const PAUSA_ENTRE_RONDAS_MS = 500;
const CARGA_ABANDONADA_MS = 10 * 60 * 1000;

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) };
}

function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}

const clienteLambda = new LambdaClient({});

async function invocarWorker(cargaId: string): Promise<void> {
  await clienteLambda.send(
    new InvokeCommand({
      FunctionName: variable('NOMBRE_FUNCION_WORKER'),
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ cargaId })),
    }),
  );
}

// ---------------------------------------------------------------------------
// Lógica pura (exportada para pruebas)
// ---------------------------------------------------------------------------

export type ResultadoLibro =
  | { tipo: 'guardado'; conocimiento: ConocimientoGuardado }
  | { tipo: 'yaTenia'; conocimiento: ConocimientoGuardado }
  | { tipo: 'sinIsbn'; conocimiento: ConocimientoGuardado | null }
  | { tipo: 'sinDatos'; conocimiento: ConocimientoGuardado | null }
  | { tipo: 'omitido' }
  | { tipo: 'error' };

function largoSinopsis(conocimiento: ConocimientoGuardado | null): number {
  return conocimiento?.sinopsis?.length ?? 0;
}

function sumar(mapa: Record<string, Conteo>, clave: string, util: boolean): Record<string, Conteo> {
  const actual = mapa[clave] ?? { total: 0, utiles: 0 };
  return { ...mapa, [clave]: { total: actual.total + 1, utiles: actual.utiles + (util ? 1 : 0) } };
}

/** Suma el resultado de un libro a los contadores de la corrida. Pura: devuelve una copia. */
export function acumularResultado(carga: CargaConocimiento, resultado: ResultadoLibro): CargaConocimiento {
  if (resultado.tipo === 'omitido') {
    // El libro se eliminó mientras esperaba su turno: no cuenta como revisado.
    return carga;
  }
  const siguiente: CargaConocimiento = { ...carga, librosRevisados: carga.librosRevisados + 1 };
  if (resultado.tipo === 'error') {
    return { ...siguiente, errores: siguiente.errores + 1 };
  }
  if (resultado.tipo === 'guardado') {
    siguiente.guardados += 1;
  } else if (resultado.tipo === 'yaTenia') {
    siguiente.yaTenian += 1;
  } else if (resultado.tipo === 'sinIsbn') {
    siguiente.sinIsbn += 1;
  } else {
    siguiente.sinDatos += 1;
  }

  const conocimiento = resultado.conocimiento;
  const largo = largoSinopsis(conocimiento);
  const util = largo >= MINIMO_SINOPSIS_UTIL;
  if (largo === 0) {
    siguiente.sinSinopsis += 1;
  } else if (util) {
    siguiente.conSinopsisUtil += 1;
  } else {
    siguiente.conSinopsisCorta += 1;
  }
  siguiente.porIdioma = sumar(siguiente.porIdioma, conocimiento?.idioma ?? CLAVE_SIN_IDIOMA, util);
  siguiente.porFuente = sumar(
    siguiente.porFuente,
    largo === 0 ? CLAVE_SIN_SINOPSIS : (conocimiento?.fuenteSinopsis ?? CLAVE_SIN_SINOPSIS),
    util,
  );
  return siguiente;
}

/**
 * Combina lo que ya había con lo recién encontrado sin pisar nada: un campo con valor
 * se conserva; solo se llenan los vacíos. La sinopsis y su fuente van siempre juntas.
 */
export function combinarConocimiento(
  bookId: string,
  existente: ConocimientoGuardado | null,
  nuevo: Omit<ConocimientoGuardado, 'bookId' | 'actualizadoEn'>,
  ahora: string,
): ConocimientoGuardado {
  const sinopsisPropia = existente?.sinopsis ? { sinopsis: existente.sinopsis, fuenteSinopsis: existente.fuenteSinopsis } : null;
  return {
    bookId,
    sinopsis: sinopsisPropia?.sinopsis ?? nuevo.sinopsis,
    fuenteSinopsis: sinopsisPropia ? sinopsisPropia.fuenteSinopsis : nuevo.sinopsis ? nuevo.fuenteSinopsis : null,
    categorias: existente && existente.categorias.length > 0 ? existente.categorias : nuevo.categorias,
    idioma: existente?.idioma ?? nuevo.idioma,
    paginas: existente?.paginas ?? nuevo.paginas,
    clasificacionEdad: existente?.clasificacionEdad ?? nuevo.clasificacionEdad,
    actualizadoEn: ahora,
  };
}

function tieneAlgo(datos: Omit<ConocimientoGuardado, 'bookId' | 'actualizadoEn'>): boolean {
  return Boolean(
    datos.sinopsis || datos.categorias.length > 0 || datos.idioma || datos.paginas !== null || datos.clasificacionEdad,
  );
}

/** Procesa un libro. Nunca lanza: un fallo se cuenta como `error` y el lote sigue. */
export async function procesarLibro(bookId: string): Promise<ResultadoLibro> {
  try {
    const libro = await obtenerPorClave<Libro>(variable('TABLA_LIBROS'), { bookId });
    if (!libro) {
      return { tipo: 'omitido' };
    }
    const existente = (await obtenerPorClave<ConocimientoGuardado>(variable('TABLA_CONOCIMIENTO'), { bookId })) ?? null;
    if (existente?.sinopsis) {
      return { tipo: 'yaTenia', conocimiento: existente };
    }
    if (!libro.isbn) {
      return { tipo: 'sinIsbn', conocimiento: existente };
    }

    const metadatos = await resolverMetadatosCompletos(libro.isbn, { conPvp: false });
    const encontrado = {
      sinopsis: metadatos.sinopsis,
      categorias: metadatos.categorias,
      idioma: metadatos.idioma,
      paginas: metadatos.paginas,
      clasificacionEdad: metadatos.clasificacionEdad as ConocimientoGuardado['clasificacionEdad'],
      fuenteSinopsis: metadatos.sinopsis ? metadatos.fuenteSinopsis : null,
    };
    if (!tieneAlgo(encontrado)) {
      return { tipo: 'sinDatos', conocimiento: existente };
    }
    const conocimiento = combinarConocimiento(bookId, existente, encontrado, new Date().toISOString());
    await guardar(variable('TABLA_CONOCIMIENTO'), conocimiento);
    return { tipo: 'guardado', conocimiento };
  } catch (error) {
    console.error(`cargaConocimientoWorker: fallo procesando bookId=${bookId}`, error);
    return { tipo: 'error' };
  }
}

const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------
// POST /api/carga-conocimiento
// ---------------------------------------------------------------------------

async function buscarCargaEnProgreso(): Promise<CargaConocimiento | undefined> {
  const resumenes = await escanearProyeccion<Pick<CargaConocimiento, 'cargaId' | 'estado' | 'actualizadoEn'>>(
    variable('TABLA_CARGA_CONOCIMIENTO'),
    ['cargaId', 'estado', 'actualizadoEn'],
  );
  const activa = resumenes.find((resumen) => resumen.estado === 'en_progreso');
  if (!activa) {
    return undefined;
  }
  const completa = await obtenerPorClave<CargaConocimiento>(variable('TABLA_CARGA_CONOCIMIENTO'), { cargaId: activa.cargaId });
  if (!completa) {
    return undefined;
  }
  if (Date.now() - new Date(completa.actualizadoEn).getTime() <= CARGA_ABANDONADA_MS) {
    return completa;
  }
  await guardar(variable('TABLA_CARGA_CONOCIMIENTO'), {
    ...completa,
    estado: 'error' as const,
    actualizadoEn: new Date().toISOString(),
  });
  return undefined;
}

export const handlerIniciar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);
    const usuario = await obtenerPorClave<Usuario>(variable('TABLA_USUARIOS'), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para iniciar la carga del asistente en Babel.' });
    }

    const activa = await buscarCargaEnProgreso();
    if (activa) {
      return respuestaJson(409, { error: 'Ya hay una carga en curso.', cargaId: activa.cargaId });
    }

    const libros = await escanearProyeccion<Libro>(variable('TABLA_LIBROS'), ['bookId']);
    const colaBookIds = libros.map((libro) => libro.bookId).sort();
    const ahora = new Date().toISOString();
    const hayLibros = colaBookIds.length > 0;
    const carga: CargaConocimiento = {
      cargaId: randomUUID(),
      estado: hayLibros ? 'en_progreso' : 'completado',
      iniciadoPor: email,
      iniciadoEn: ahora,
      actualizadoEn: ahora,
      colaBookIds,
      indiceActual: 0,
      totalLibros: colaBookIds.length,
      librosRevisados: 0,
      guardados: 0,
      yaTenian: 0,
      sinIsbn: 0,
      sinDatos: 0,
      errores: 0,
      conSinopsisUtil: 0,
      conSinopsisCorta: 0,
      sinSinopsis: 0,
      porIdioma: {},
      porFuente: {},
    };
    await guardar(variable('TABLA_CARGA_CONOCIMIENTO'), carga);
    if (hayLibros) {
      await invocarWorker(carga.cargaId);
    }
    return respuestaJson(202, { cargaId: carga.cargaId });
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

// ---------------------------------------------------------------------------
// Worker (Lambda interna)
// ---------------------------------------------------------------------------

/**
 * Procesa un lote de `TAMANO_LOTE` libros de a `CONCURRENCIA` a la vez, con una pausa
 * entre rondas para no martillar los sitios, y se auto-invoca hasta agotar la cola.
 * Relee el progreso de DynamoDB al empezar, así que un reintento de Lambda reprocesa a
 * lo sumo un lote (y `procesarLibro` no pisa sinopsis, por lo que repetirlo es inocuo).
 */
export const handlerWorker: Handler<{ cargaId: string }, void> = async (evento) => {
  const { cargaId } = evento;
  const carga = await obtenerPorClave<CargaConocimiento>(variable('TABLA_CARGA_CONOCIMIENTO'), { cargaId });
  if (!carga || carga.estado !== 'en_progreso') {
    return;
  }

  const lote = carga.colaBookIds.slice(carga.indiceActual, carga.indiceActual + TAMANO_LOTE);
  let actualizada = carga;
  for (let inicio = 0; inicio < lote.length; inicio += CONCURRENCIA) {
    if (inicio > 0) {
      await esperar(PAUSA_ENTRE_RONDAS_MS);
    }
    const resultados = await Promise.all(lote.slice(inicio, inicio + CONCURRENCIA).map((bookId) => procesarLibro(bookId)));
    for (const resultado of resultados) {
      actualizada = acumularResultado(actualizada, resultado);
    }
  }

  const nuevoIndice = Math.min(carga.indiceActual + TAMANO_LOTE, carga.totalLibros);
  const terminada = nuevoIndice >= carga.totalLibros;
  await guardar(variable('TABLA_CARGA_CONOCIMIENTO'), {
    ...actualizada,
    indiceActual: nuevoIndice,
    estado: terminada ? ('completado' as const) : ('en_progreso' as const),
    actualizadoEn: new Date().toISOString(),
  });
  if (!terminada) {
    await invocarWorker(cargaId);
  }
};

// ---------------------------------------------------------------------------
// GET /api/carga-conocimiento/:cargaId
// ---------------------------------------------------------------------------

export const handlerConsultar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);
    const usuario = await obtenerPorClave<Usuario>(variable('TABLA_USUARIOS'), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para consultar la carga del asistente en Babel.' });
    }
    const cargaId = event.pathParameters?.['cargaId'];
    if (!cargaId) {
      return respuestaJson(400, { error: 'Falta el cargaId en la ruta.' });
    }
    const carga = await obtenerPorClave<CargaConocimiento>(variable('TABLA_CARGA_CONOCIMIENTO'), { cargaId });
    if (!carga) {
      return respuestaJson(404, { error: 'La carga no existe.' });
    }
    const { colaBookIds: _cola, ...resumen } = carga;
    return respuestaJson(200, resumen);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
