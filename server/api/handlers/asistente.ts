import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { crearAlmacenS3, type AlmacenIndice } from '../lib/almacen-indice';
import {
  CANDIDATOS_DEL_INDICE,
  ESQUEMA_SALIDA,
  ErrorPeticion,
  ErrorRespuestaInvalida,
  MAXIMO_CARACTERES_CUERPO,
  TEXTO_BLOQUEADO,
  TEXTO_DEMORA,
  TEXTO_SIN_RESULTADOS,
  cargarPrompt,
  filtroDelIndice,
  libroParaModelo,
  mensajesParaModelo,
  seleccionarCandidatos,
  textoDeConsulta,
  validarPeticion,
  validarRespuesta,
  type ConocimientoDeLibro,
  type FiltrosAsistente,
  type LibroDeInventario,
  type LibroParaModelo,
  type PeticionAsistente,
  type PromptAsistente,
} from '../lib/asistente';
import { crearProveedorLlm } from '../lib/gemini';
import {
  HERRAMIENTAS,
  MAXIMO_LLAMADAS_POR_RONDA,
  MAXIMO_RONDAS,
  buscarPolitica,
  cargarPoliticas,
  validarLlamada,
  type TemaPolitica,
} from '../lib/herramientas-asistente';
import {
  buscarSimilares,
  deserializarIndice,
  type IndiceVectorial,
} from '../lib/indice-vectorial';
import {
  ErrorProveedorLlm,
  type LlamadaHerramienta,
  type ProveedorLlm,
  type ResultadoGeneracion,
  type RondaHerramientas,
} from '../lib/proveedor-llm';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { obtenerPorClave } from '../services/dynamodb';

/**
 * `POST /api/asistente` — asistente de recomendación (`asistente-ia/PLAN.md` Fase 2, T-0023).
 *
 * Conversación SIN estado en el servidor: el cliente envía los últimos mensajes y el
 * servidor valida sus límites. Por cada petición: embedding de la consulta → índice en S3
 * (filtros de idioma y edad) → existencias y precio en `babel-libros` → los pocos libros
 * resultantes, con su sinopsis, al modelo → validador que descarta todo `bookId` que no
 * sea de esa lista.
 *
 * Acceso: por ahora SOLO personal (vendedor o administrador). Un chat público con una
 * clave que cuesta dinero necesita topes de gasto y de tasa (Fase 6); se abre en las
 * fases 6 y 7. Además hay un interruptor (`ASISTENTE_ACTIVO`) apagado en producción.
 *
 * La sinopsis (texto de terceros, ADR-018) solo viaja al modelo; al cliente nunca.
 */

export interface DependenciasAsistente {
  proveedor: ProveedorLlm;
  /** `null` si todavía no hay índice. */
  cargarIndice(): Promise<IndiceVectorial | null>;
  leerLibro(bookId: string): Promise<LibroDeInventario | null>;
  leerConocimiento(bookId: string): Promise<ConocimientoDeLibro | null>;
  /** Espacio, mueble y ubicación donde está un libro, o `null` si no se puede resolver. */
  leerUbicacion(ubicacionId: string): Promise<UbicacionFisica | null>;
  /** Temas de `asistente-ia/conocimiento/politicas-libreria.md` que ya tienen contenido. */
  politicas: TemaPolitica[];
  prompt: PromptAsistente;
  ahora?: () => number;
}

export interface UbicacionFisica {
  espacio: string;
  mueble: string;
  ubicacion: string;
}

export interface RecomendacionPublica {
  bookId: string;
  titulo: string;
  autor: string;
  pvp: number;
  portadaUrl: string | null;
  motivo: string;
}

export interface RespuestaAsistente {
  texto: string;
  recomendaciones: RecomendacionPublica[];
  sinResultados: boolean;
  meta: {
    versionPrompt: string;
    modelo: string | null;
    candidatos: number;
    descartados: number;
    tokensEntrada: number;
    tokensSalida: number;
    bloqueado: boolean;
    latenciaMs: number;
    /** Vueltas de herramientas que hubo antes de la respuesta final. */
    rondas: number;
    /** Nombre de cada herramienta que el modelo pidió, en orden. */
    herramientas: string[];
    /** Llamadas de herramienta rechazadas por argumentos inválidos o que fallaron al ejecutarse. */
    fallosHerramientas: number;
    /** Se cortó la cadena de herramientas por tiempo y se respondió con el aviso de demora. */
    tiempoAgotado: boolean;
  };
}

/** Todavía no hay un índice utilizable (no se ha construido, o es de otro modelo de embeddings). */
export class IndiceNoDisponibleError extends Error {}

const MAXIMO_TOKENS_SALIDA = 1024;
/**
 * API Gateway corta a los 30 s y cada llamada al modelo puede tardar 5 a 13 s (medido contra la API real,
 * 18/11/2026). Una vuelta más de herramientas solo se intenta si queda tiempo para ella y para la respuesta.
 */
const LIMITE_PARA_OTRA_VUELTA_MS = 14_000;

interface Busqueda {
  candidatos: LibroDeInventario[];
  tokensEntrada: number;
}

/** Consulta → vector → índice con filtros → existencias y precio contra la base de datos. */
async function buscarCandidatos(
  dependencias: DependenciasAsistente,
  indice: IndiceVectorial,
  consulta: string,
  filtros: FiltrosAsistente,
): Promise<Busqueda> {
  const incrustacion = await dependencias.proveedor.incrustarConsulta(consulta);
  const similares = buscarSimilares(indice, incrustacion.vectores[0], {
    k: CANDIDATOS_DEL_INDICE,
    filtro: filtroDelIndice(filtros),
  });
  const inventario = new Map<string, LibroDeInventario>();
  await Promise.all(
    similares.map(async ({ bookId }) => {
      const libro = await dependencias.leerLibro(bookId);
      if (libro) {
        inventario.set(bookId, libro);
      }
    }),
  );
  return {
    candidatos: seleccionarCandidatos(similares, inventario, filtros),
    tokensEntrada: incrustacion.tokensEntrada,
  };
}

async function paraModelo(
  dependencias: DependenciasAsistente,
  libros: LibroDeInventario[],
): Promise<LibroParaModelo[]> {
  return Promise.all(
    libros.map(async (libro) => libroParaModelo(libro, await dependencias.leerConocimiento(libro.bookId))),
  );
}

/** Estado de una petición que las herramientas van enriqueciendo. */
interface Sesion {
  indice: IndiceVectorial;
  /** Todo libro con existencias que el modelo ha visto en esta petición. Solo estos pueden recomendarse. */
  vistos: Map<string, LibroDeInventario>;
  tokensEntradaEmbeddings: number;
}

/** Ejecuta una llamada del modelo. Nunca lanza: un fallo se convierte en un resultado de error que el modelo puede explicar. */
async function ejecutarLlamada(
  dependencias: DependenciasAsistente,
  sesion: Sesion,
  llamada: LlamadaHerramienta,
): Promise<{ contenido: string; fallo: boolean }> {
  const validada = validarLlamada(llamada.nombre, llamada.argumentos);
  if (!validada.ok) {
    return { contenido: JSON.stringify({ error: validada.error }), fallo: true };
  }
  try {
    switch (validada.nombre) {
      case 'buscar_libros': {
        const { candidatos, tokensEntrada } = await buscarCandidatos(
          dependencias,
          sesion.indice,
          validada.consulta,
          validada.filtros,
        );
        sesion.tokensEntradaEmbeddings += tokensEntrada;
        candidatos.forEach((libro) => sesion.vistos.set(libro.bookId, libro));
        return { contenido: JSON.stringify({ libros: await paraModelo(dependencias, candidatos) }), fallo: false };
      }
      case 'consultar_disponibilidad': {
        const libros = await Promise.all(
          validada.bookIds.map(async (bookId) => {
            const libro = await dependencias.leerLibro(bookId);
            if (!libro) {
              return { bookId, existe: false };
            }
            const ubicacion = libro.ubicacionId ? await dependencias.leerUbicacion(libro.ubicacionId) : null;
            // Lista blanca: lo mismo que ya muestra la ficha pública del libro.
            return {
              bookId: libro.bookId,
              existe: true,
              titulo: libro.titulo,
              precio: libro.pvp,
              existencias: Math.max(0, libro.cantidadDisponible),
              ubicacion,
            };
          }),
        );
        return { contenido: JSON.stringify({ libros }), fallo: false };
      }
      case 'consultar_politicas':
        return { contenido: JSON.stringify(buscarPolitica(dependencias.politicas, validada.tema)), fallo: false };
    }
  } catch (error) {
    // El detalle va al registro (sin contenido de la persona); al modelo solo un mensaje genérico.
    console.error('asistente: falló una herramienta', validada.nombre, error instanceof Error ? error.name : 'desconocido');
    return {
      contenido: JSON.stringify({ error: 'La herramienta no está disponible por ahora. Responde con lo que ya sabes y dilo con honestidad.' }),
      fallo: true,
    };
  }
}

export async function responder(
  dependencias: DependenciasAsistente,
  peticion: PeticionAsistente,
): Promise<RespuestaAsistente> {
  const ahora = dependencias.ahora ?? Date.now;
  const inicio = ahora();
  const { proveedor, prompt } = dependencias;

  const indice = await dependencias.cargarIndice();
  if (!indice || indice.modelo !== proveedor.modeloEmbeddings) {
    // Un índice de otro modelo no es comparable: mejor no responder que recomendar al azar.
    throw new IndiceNoDisponibleError('No hay un índice utilizable.');
  }

  const inicial = await buscarCandidatos(
    dependencias,
    indice,
    textoDeConsulta(peticion.mensajes),
    peticion.filtros,
  );
  const sesion: Sesion = {
    indice,
    vistos: new Map(inicial.candidatos.map((libro) => [libro.bookId, libro])),
    tokensEntradaEmbeddings: inicial.tokensEntrada,
  };
  const herramientasLlamadas: string[] = [];
  const rondasHechas: RondaHerramientas[] = [];
  let fallosHerramientas = 0;
  let tokensGeneracionEntrada = 0;
  let tokensSalida = 0;
  let modelo: string | null = null;

  const meta = (extra: Partial<RespuestaAsistente['meta']>): RespuestaAsistente['meta'] => ({
    versionPrompt: prompt.version,
    modelo,
    candidatos: inicial.candidatos.length,
    descartados: 0,
    tokensEntrada: sesion.tokensEntradaEmbeddings + tokensGeneracionEntrada,
    tokensSalida,
    bloqueado: false,
    latenciaMs: ahora() - inicio,
    rondas: rondasHechas.length,
    herramientas: herramientasLlamadas,
    fallosHerramientas,
    tiempoAgotado: false,
    ...extra,
  });

  if (inicial.candidatos.length === 0 && !prompt.herramientas) {
    // Sin libros que ofrecer y sin herramientas que consultar, no tiene sentido pagar una generación.
    return { texto: TEXTO_SIN_RESULTADOS, recomendaciones: [], sinResultados: true, meta: meta({}) };
  }

  const librosIniciales = await paraModelo(dependencias, inicial.candidatos);
  let generacion: ResultadoGeneracion;
  for (;;) {
    const quedaTiempo = ahora() - inicio < LIMITE_PARA_OTRA_VUELTA_MS;
    const puedeUsarHerramientas = prompt.herramientas && rondasHechas.length < MAXIMO_RONDAS && quedaTiempo;
    if (rondasHechas.length > 0 && ahora() - inicio >= LIMITE_PARA_OTRA_VUELTA_MS + 4_000) {
      // Ya no cabe otra llamada al modelo dentro de los 30 s de API Gateway.
      return {
        texto: TEXTO_DEMORA,
        recomendaciones: [],
        sinResultados: false,
        meta: meta({ tiempoAgotado: true }),
      };
    }
    generacion = await proveedor.generarJson({
      instrucciones: prompt.instrucciones,
      mensajes: mensajesParaModelo(peticion.mensajes, librosIniciales, ahora()),
      esquemaSalida: ESQUEMA_SALIDA,
      maximoTokensSalida: MAXIMO_TOKENS_SALIDA,
      nivelPensamiento: 'low',
      ...(puedeUsarHerramientas ? { herramientas: HERRAMIENTAS } : {}),
      ...(rondasHechas.length > 0 ? { rondas: rondasHechas } : {}),
    });
    tokensGeneracionEntrada += generacion.tokensEntrada;
    tokensSalida += generacion.tokensSalida;
    modelo = generacion.modelo;
    if (generacion.llamadas.length === 0 || !puedeUsarHerramientas) {
      break;
    }

    herramientasLlamadas.push(...generacion.llamadas.map((llamada) => llamada.nombre));
    const resultados = await Promise.all(
      generacion.llamadas.map(async (llamada, posicion) => {
        const salida =
          posicion < MAXIMO_LLAMADAS_POR_RONDA
            ? await ejecutarLlamada(dependencias, sesion, llamada)
            : { contenido: JSON.stringify({ error: 'Demasiadas llamadas a la vez; pide solo lo necesario.' }), fallo: true };
        if (salida.fallo) {
          fallosHerramientas += 1;
        }
        return { llamadaId: llamada.id, nombre: llamada.nombre, contenido: salida.contenido };
      }),
    );
    rondasHechas.push({ pasosDelModelo: generacion.pasosDelModelo, resultados });
  }

  if (generacion.bloqueado) {
    return {
      texto: TEXTO_BLOQUEADO,
      recomendaciones: [],
      sinResultados: true,
      meta: meta({ bloqueado: true }),
    };
  }
  if (generacion.llamadas.length > 0 || generacion.truncado) {
    // O el modelo siguió pidiendo herramientas cuando ya no se le ofrecían, o se cortó: no hay respuesta que validar.
    throw new ErrorRespuestaInvalida('La respuesta del modelo no es final o se cortó.');
  }

  const validada = validarRespuesta(generacion.texto, new Set(sesion.vistos.keys()));
  return {
    texto: validada.texto,
    // Lista blanca explícita: nada de esparcir el ítem de la base de datos.
    recomendaciones: validada.recomendaciones.map(({ bookId, motivo }) => {
      const libro = sesion.vistos.get(bookId) as LibroDeInventario;
      return {
        bookId,
        titulo: libro.titulo,
        autor: libro.autor,
        pvp: libro.pvp,
        portadaUrl: libro.portadaUrl ?? null,
        motivo,
      };
    }),
    sinResultados: validada.sinResultados,
    meta: meta({ descartados: validada.descartados }),
  };
}

// ---------------------------------------------------------------------------
// Índice en memoria entre invocaciones
// ---------------------------------------------------------------------------

const VIGENCIA_INDICE_MS = 5 * 60 * 1000;

/**
 * Lee el índice de S3 una vez cada cinco minutos por contenedor caliente: el archivo pesa
 * unos megas y se reconstruye cada seis horas, no hace falta bajarlo en cada pregunta.
 */
export function crearCargadorIndice(
  almacen: AlmacenIndice,
  ahora: () => number = Date.now,
  vigenciaMs: number = VIGENCIA_INDICE_MS,
): () => Promise<IndiceVectorial | null> {
  let guardado: { indice: IndiceVectorial; cargadoEn: number } | null = null;
  return async () => {
    if (guardado && ahora() - guardado.cargadoEn < vigenciaMs) {
      return guardado.indice;
    }
    const archivo = await almacen.leer();
    if (!archivo) {
      return null;
    }
    guardado = { indice: deserializarIndice(archivo.contenido), cargadoEn: ahora() };
    return guardado.indice;
  };
}

// ---------------------------------------------------------------------------
// Handler HTTP
// ---------------------------------------------------------------------------

interface Usuario {
  email: string;
  rol: 'administrador' | 'vendedor';
}

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

let cargadorIndice: (() => Promise<IndiceVectorial | null>) | undefined;
/** Se leen del disco una vez por contenedor: el archivo viaja empaquetado con la Lambda. */
const politicasCargadas = cargarPoliticas();

/** Mismo recorrido que la ficha pública del libro: ubicación → mueble → espacio (tres `GetItem`, nunca un `Scan`). */
async function resolverUbicacion(ubicacionId: string): Promise<UbicacionFisica | null> {
  const ubicacion = await obtenerPorClave<{ nombre: string; muebleId: string }>(variable('TABLA_UBICACIONES'), { ubicacionId });
  if (!ubicacion) {
    return null;
  }
  const mueble = await obtenerPorClave<{ nombre: string; espacioId: string }>(variable('TABLA_MUEBLES'), { muebleId: ubicacion.muebleId });
  if (!mueble) {
    return null;
  }
  const espacio = await obtenerPorClave<{ nombre: string }>(variable('TABLA_ESPACIOS'), { espacioId: mueble.espacioId });
  return espacio ? { espacio: espacio.nombre, mueble: mueble.nombre, ubicacion: ubicacion.nombre } : null;
}

function dependenciasReales(): DependenciasAsistente {
  cargadorIndice ??= crearCargadorIndice(crearAlmacenS3(variable('BUCKET_INDICE')));
  return {
    // Interactivo: intentos cortos y un solo reintento, para no pasar el límite de 30 s de API Gateway.
    proveedor: crearProveedorLlm(process.env, { timeoutMs: 10_000, reintentosMaximos: 1 }),
    cargarIndice: cargadorIndice,
    leerLibro: async (bookId) =>
      (await obtenerPorClave<LibroDeInventario>(variable('TABLA_LIBROS'), { bookId })) ?? null,
    leerConocimiento: async (bookId) =>
      (await obtenerPorClave<ConocimientoDeLibro>(variable('TABLA_CONOCIMIENTO'), { bookId })) ?? null,
    leerUbicacion: resolverUbicacion,
    politicas: politicasCargadas,
    prompt: cargarPrompt(process.env['VERSION_PROMPT_ASISTENTE'] || 'v1'),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    // Interruptor: apagado, ni siquiera se consulta a Firebase ni a Gemini.
    if (process.env['ASISTENTE_ACTIVO'] !== 'true') {
      return respuestaJson(503, { error: 'El asistente no está disponible por ahora.' });
    }

    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);
    const usuario = await obtenerPorClave<Usuario>(variable('TABLA_USUARIOS'), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para usar el asistente de Babel.' });
    }

    const crudo = event.body ?? '';
    if (crudo.length > MAXIMO_CARACTERES_CUERPO) {
      return respuestaJson(413, { error: 'La petición es demasiado grande.' });
    }
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(event.isBase64Encoded ? Buffer.from(crudo, 'base64').toString('utf8') : crudo);
    } catch {
      return respuestaJson(400, { error: 'El cuerpo no es JSON válido.' });
    }
    const peticion = validarPeticion(cuerpo);

    const respuesta = await responder(dependenciasReales(), peticion);
    // Solo cifras: ni el texto de la persona ni el de la respuesta quedan en los registros (privacidad).
    console.log('asistente', JSON.stringify(respuesta.meta));
    return respuestaJson(200, respuesta);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    if (error instanceof ErrorPeticion) {
      return respuestaJson(400, { error: error.message });
    }
    if (error instanceof IndiceNoDisponibleError) {
      return respuestaJson(503, { error: 'El asistente todavía no está listo. Intenta más tarde.' });
    }
    if (error instanceof ErrorProveedorLlm || error instanceof ErrorRespuestaInvalida) {
      // Detalle solo en el registro de la Lambda; el mensaje del proveedor nunca llega al cliente.
      console.error('asistente: fallo del modelo', error.name, error instanceof ErrorProveedorLlm ? error.estadoHttp : '');
      const saturado = error instanceof ErrorProveedorLlm && error.reintentable;
      return respuestaJson(saturado ? 503 : 502, {
        error: 'No pude preparar una recomendación en este momento. Intenta de nuevo.',
      });
    }
    console.error('asistente: error inesperado', error instanceof Error ? error.name : 'desconocido');
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
