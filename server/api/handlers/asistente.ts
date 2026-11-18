import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { crearAlmacenS3, type AlmacenIndice } from '../lib/almacen-indice';
import {
  CANDIDATOS_DEL_INDICE,
  ESQUEMA_SALIDA,
  ErrorPeticion,
  ErrorRespuestaInvalida,
  MAXIMO_CARACTERES_CUERPO,
  TEXTO_BLOQUEADO,
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
  type LibroDeInventario,
  type PeticionAsistente,
  type PromptAsistente,
} from '../lib/asistente';
import { crearProveedorLlm } from '../lib/gemini';
import {
  buscarSimilares,
  deserializarIndice,
  type IndiceVectorial,
} from '../lib/indice-vectorial';
import { ErrorProveedorLlm, type ProveedorLlm } from '../lib/proveedor-llm';
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
  prompt: PromptAsistente;
  ahora?: () => number;
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
  };
}

/** Todavía no hay un índice utilizable (no se ha construido, o es de otro modelo de embeddings). */
export class IndiceNoDisponibleError extends Error {}

const MAXIMO_TOKENS_SALIDA = 1024;

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

  const consulta = await proveedor.incrustarConsulta(textoDeConsulta(peticion.mensajes));
  const similares = buscarSimilares(indice, consulta.vectores[0], {
    k: CANDIDATOS_DEL_INDICE,
    filtro: filtroDelIndice(peticion.filtros),
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
  const candidatos = seleccionarCandidatos(similares, inventario, peticion.filtros);

  const meta = (extra: Partial<RespuestaAsistente['meta']>): RespuestaAsistente['meta'] => ({
    versionPrompt: prompt.version,
    modelo: null,
    candidatos: candidatos.length,
    descartados: 0,
    tokensEntrada: consulta.tokensEntrada,
    tokensSalida: 0,
    bloqueado: false,
    latenciaMs: ahora() - inicio,
    ...extra,
  });

  if (candidatos.length === 0) {
    // Sin libros que ofrecer no tiene sentido pagar una generación.
    return {
      texto: TEXTO_SIN_RESULTADOS,
      recomendaciones: [],
      sinResultados: true,
      meta: meta({}),
    };
  }

  const librosParaModelo = await Promise.all(
    candidatos.map(async (libro) =>
      libroParaModelo(libro, await dependencias.leerConocimiento(libro.bookId)),
    ),
  );
  const generacion = await proveedor.generarJson({
    instrucciones: prompt.instrucciones,
    mensajes: mensajesParaModelo(peticion.mensajes, librosParaModelo),
    esquemaSalida: ESQUEMA_SALIDA,
    maximoTokensSalida: MAXIMO_TOKENS_SALIDA,
    nivelPensamiento: 'low',
  });
  const tokens = {
    modelo: generacion.modelo,
    tokensEntrada: consulta.tokensEntrada + generacion.tokensEntrada,
    tokensSalida: generacion.tokensSalida,
  };

  if (generacion.bloqueado) {
    return {
      texto: TEXTO_BLOQUEADO,
      recomendaciones: [],
      sinResultados: true,
      meta: meta({ ...tokens, bloqueado: true }),
    };
  }
  if (generacion.truncado) {
    throw new ErrorRespuestaInvalida('La respuesta del modelo se cortó.');
  }

  const validada = validarRespuesta(generacion.texto, new Set(candidatos.map((c) => c.bookId)));
  const porId = new Map(candidatos.map((libro) => [libro.bookId, libro]));
  return {
    texto: validada.texto,
    // Lista blanca explícita: nada de esparcir el ítem de la base de datos.
    recomendaciones: validada.recomendaciones.map(({ bookId, motivo }) => {
      const libro = porId.get(bookId) as LibroDeInventario;
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
    meta: meta({ ...tokens, descartados: validada.descartados }),
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
