import {
  ErrorProveedorLlm,
  type DocumentoParaIncrustar,
  type LlamadaHerramienta,
  type PeticionGeneracion,
  type ProveedorLlm,
  type ResultadoGeneracion,
  type ResultadoIncrustacion,
} from './proveedor-llm';

/**
 * Implementación de `ProveedorLlm` sobre la Gemini API (REST).
 *
 * El contrato se comprobó contra la API real (workflow `asistente-verificar-gemini.yml`,
 * 17/11/2026) en vez de escribirse de memoria: la documentación se contradecía.
 * - Embeddings: `gemini-embedding-2` no admite `task_type`; el rol del texto va como
 *   prefijo (`title: ... | text: ...` para documentos, `task: search result | query: ...`
 *   para consultas). Con `output_dimensionality: 768` devuelve vectores de norma 1.
 *   `batchEmbedContents` devuelve un vector por petición.
 * - Generación: Interactions API estable (`POST /v1/interactions`), sin estado en el
 *   servidor (`store: false`; el historial viaja en `input`). La respuesta trae pasos
 *   (`thought`, `model_output`); el texto sale de los `model_output`. `status: incomplete`
 *   indica corte por el tope de tokens. El pensamiento llega en `total_thought_tokens`,
 *   aparte de `total_output_tokens`, y se factura como salida. Funciona con y sin
 *   `Api-Revision`; se envía para fijar el esquema de respuesta.
 * La clave viaja solo en la cabecera `x-goog-api-key`; nunca en la URL ni en logs.
 */

const HOST = 'https://generativelanguage.googleapis.com';
/** Embeddings: `v1beta`, la ruta con la que se verificó `batchEmbedContents`. */
const BASE_EMBEDDINGS = `${HOST}/v1beta`;
/** Generación: la Interactions API estable. */
const BASE_INTERACCIONES = `${HOST}/v1`;
const REVISION_API = '2026-05-20';
export const MODELO_TEXTO_POR_DEFECTO = 'gemini-3.5-flash-lite';
export const MODELO_EMBEDDINGS_POR_DEFECTO = 'gemini-embedding-2';
export const DIMENSIONES_POR_DEFECTO = 768;
/** Peticiones por `batchEmbedContents`; margen conservador, la documentación no fija un tope para este modelo. */
const TAMANO_LOTE_EMBEDDINGS = 50;
const TIMEOUT_MS = 20_000;
const REINTENTOS_MAXIMOS = 2;
const PAUSA_BASE_MS = 500;
/** Por debajo de esto, un intento más no alcanza a recibir una respuesta (medido: 5 a 13 s por generación). */
export const MINIMO_MS_POR_INTENTO = 4_000;

export interface OpcionesGemini {
  claveApi: string;
  modeloTexto?: string;
  modeloEmbeddings?: string;
  dimensiones?: number;
  /** Tiempo máximo por intento. Un endpoint interactivo lo baja para no pasar el límite de API Gateway (30 s). */
  timeoutMs?: number;
  /** Reintentos tras el primer intento (429, 5xx y red). */
  reintentosMaximos?: number;
  /**
   * Instante (ms) a partir del cual no se debe seguir esperando a Gemini. Un endpoint interactivo lo fija para no
   * pasar el límite de 30 s de API Gateway: cada intento recorta su tiempo al que queda y no se reintenta si lo que
   * queda tras la pausa no alcanza para un intento útil.
   */
  fechaLimiteMs?: number;
  /** Para pruebas. */
  fetchImpl?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  ahora?: () => number;
}

interface UsoEmbeddings {
  promptTokenCount?: number;
}

interface PasoInteraccion {
  type?: string;
  content?: { type?: string; text?: string }[];
  /** Solo en `function_call`. */
  id?: string;
  name?: string;
  arguments?: unknown;
}

const esperarReal = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

export class ProveedorGemini implements ProveedorLlm {
  readonly nombre = 'gemini';
  readonly modeloTexto: string;
  readonly modeloEmbeddings: string;
  private readonly dimensiones: number;
  private readonly claveApi: string;
  private readonly fetchImpl: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly reintentosMaximos: number;
  private readonly fechaLimiteMs: number | null;
  private readonly ahora: () => number;

  constructor(opciones: OpcionesGemini) {
    if (!opciones.claveApi) {
      throw new ErrorProveedorLlm('Falta la clave de la API de Gemini.', null, null, false);
    }
    this.claveApi = opciones.claveApi;
    this.modeloTexto = opciones.modeloTexto ?? MODELO_TEXTO_POR_DEFECTO;
    this.modeloEmbeddings = opciones.modeloEmbeddings ?? MODELO_EMBEDDINGS_POR_DEFECTO;
    this.dimensiones = opciones.dimensiones ?? DIMENSIONES_POR_DEFECTO;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
    this.esperar = opciones.esperar ?? esperarReal;
    this.timeoutMs = opciones.timeoutMs ?? TIMEOUT_MS;
    this.reintentosMaximos = opciones.reintentosMaximos ?? REINTENTOS_MAXIMOS;
    this.fechaLimiteMs = opciones.fechaLimiteMs ?? null;
    this.ahora = opciones.ahora ?? Date.now;
  }

  /** Tiempo para el próximo intento, o `null` si ya no cabe uno útil antes de la fecha límite. */
  private tiempoParaIntento(pausaMs: number): number | null {
    if (this.fechaLimiteMs === null) {
      return this.timeoutMs;
    }
    const restante = this.fechaLimiteMs - this.ahora() - pausaMs;
    return restante < MINIMO_MS_POR_INTENTO ? null : Math.min(this.timeoutMs, restante);
  }

  async incrustarDocumentos(documentos: DocumentoParaIncrustar[]): Promise<ResultadoIncrustacion> {
    const textos = documentos.map(
      (documento) => `title: ${documento.titulo?.trim() || 'none'} | text: ${documento.texto}`,
    );
    return this.incrustar(textos);
  }

  async incrustarConsulta(consulta: string): Promise<ResultadoIncrustacion> {
    return this.incrustar([`task: search result | query: ${consulta}`]);
  }

  private async incrustar(textos: string[]): Promise<ResultadoIncrustacion> {
    const vectores: number[][] = [];
    let tokensEntrada = 0;
    for (let inicio = 0; inicio < textos.length; inicio += TAMANO_LOTE_EMBEDDINGS) {
      const lote = textos.slice(inicio, inicio + TAMANO_LOTE_EMBEDDINGS);
      const respuesta = await this.llamar<{
        embeddings?: { values?: number[] }[];
        usageMetadata?: UsoEmbeddings;
      }>(BASE_EMBEDDINGS, `/models/${this.modeloEmbeddings}:batchEmbedContents`, {
        requests: lote.map((texto) => ({
          model: `models/${this.modeloEmbeddings}`,
          content: { parts: [{ text: texto }] },
          output_dimensionality: this.dimensiones,
        })),
      });
      const recibidos = respuesta.embeddings ?? [];
      // Un vector por texto, ni más ni menos: un desajuste desalinearía el índice con los libros sin que nada falle.
      if (recibidos.length !== lote.length) {
        throw new ErrorProveedorLlm(
          `Gemini devolvió ${recibidos.length} vectores para ${lote.length} textos.`,
          null,
          null,
          false,
        );
      }
      for (const embedding of recibidos) {
        const valores = embedding.values;
        if (!Array.isArray(valores) || valores.length !== this.dimensiones) {
          throw new ErrorProveedorLlm(
            'Gemini devolvió un vector con una dimensión inesperada.',
            null,
            null,
            false,
          );
        }
        vectores.push(valores);
      }
      tokensEntrada += respuesta.usageMetadata?.promptTokenCount ?? 0;
    }
    return { vectores, tokensEntrada };
  }

  async generarJson(peticion: PeticionGeneracion): Promise<ResultadoGeneracion> {
    const respuesta = await this.llamar<{
      status?: string;
      steps?: PasoInteraccion[];
      usage?: {
        total_input_tokens?: number;
        total_output_tokens?: number;
        total_thought_tokens?: number;
      };
    }>(
      BASE_INTERACCIONES,
      '/interactions',
      {
        model: this.modeloTexto,
        system_instruction: peticion.instrucciones,
        // Sin estado en el servidor: el historial completo viaja en cada llamada y nada queda guardado en Google.
        store: false,
        input: [
          ...peticion.mensajes.map((mensaje) => ({
            type: mensaje.rol === 'usuario' ? 'user_input' : 'model_output',
            content: [{ type: 'text', text: mensaje.texto }],
          })),
          // Verificado (T-0030): hay que reenviar TODOS los pasos de la vuelta anterior, incluido el
          // pensamiento (sin él, 400), y el resultado va como lista de partes de texto (un texto plano
          // o un objeto no se entienden: el modelo vuelve a pedir la herramienta).
          ...(peticion.rondas ?? []).flatMap((ronda) => [
            ...ronda.pasosDelModelo,
            ...ronda.resultados.map((resultado) => ({
              type: 'function_result',
              name: resultado.nombre,
              call_id: resultado.llamadaId,
              result: [{ type: 'text', text: resultado.contenido }],
            })),
          ]),
        ],
        ...(peticion.herramientas && peticion.herramientas.length > 0
          ? {
              tools: peticion.herramientas.map((herramienta) => ({
                type: 'function',
                name: herramienta.nombre,
                description: herramienta.descripcion,
                parameters: herramienta.parametros,
              })),
            }
          : {}),
        generation_config: {
          max_output_tokens: peticion.maximoTokensSalida,
          thinking_level: peticion.nivelPensamiento ?? 'low',
          ...(peticion.forzarHerramientas && peticion.forzarHerramientas.length > 0
            ? {
                tool_choice: {
                  allowed_tools: { mode: 'any', tools: peticion.forzarHerramientas },
                },
              }
            : {}),
        },
        // La API rechaza forzar una herramienta (modo `any`) junto con salida JSON (400 `invalid_request`,
        // medido el 20/11/2026). Con el modo `any` la respuesta siempre es una llamada, así que en esa
        // vuelta no se pide el formato; la respuesta final, en la vuelta siguiente, sí lo lleva.
        ...(peticion.forzarHerramientas && peticion.forzarHerramientas.length > 0
          ? {}
          : {
              response_format: {
                type: 'text',
                mime_type: 'application/json',
                schema: peticion.esquemaSalida,
              },
            }),
      },
      { 'Api-Revision': REVISION_API },
    );

    const pasos = respuesta.steps ?? [];
    const llamadas: LlamadaHerramienta[] = pasos
      .filter((paso) => paso.type === 'function_call')
      .flatMap((paso) =>
        typeof paso.id === 'string' && typeof paso.name === 'string'
          ? [
              {
                id: paso.id,
                nombre: paso.name,
                // Lo que escribe el modelo no es de fiar: un valor que no sea un objeto se trata como «sin argumentos».
                argumentos:
                  paso.arguments && typeof paso.arguments === 'object' && !Array.isArray(paso.arguments)
                    ? (paso.arguments as Record<string, unknown>)
                    : {},
              },
            ]
          : [],
      );
    const texto = pasos
      .filter((paso) => paso.type === 'model_output')
      .flatMap((paso) => paso.content ?? [])
      .filter((bloque) => bloque.type === 'text' && typeof bloque.text === 'string')
      .map((bloque) => bloque.text)
      .join('');
    const uso = respuesta.usage ?? {};
    const pensamiento = uso.total_thought_tokens ?? 0;
    const estado = respuesta.status ?? null;
    return {
      texto,
      tokensEntrada: uso.total_input_tokens ?? 0,
      tokensSalida: (uso.total_output_tokens ?? 0) + pensamiento,
      tokensPensamiento: pensamiento,
      // La documentación no describe cómo se señala un bloqueo de seguridad en una interacción, así que
      // no se pudo verificar: se trata como bloqueo toda respuesta sin texto que no terminó con normalidad.
      // Una interacción que espera el resultado de una herramienta (`requires_action`) tampoco es un bloqueo.
      bloqueado: texto === '' && estado !== 'completed' && llamadas.length === 0,
      // Verificado: un tope de tokens muy bajo devuelve `status: incomplete` con el texto cortado.
      truncado: estado === 'incomplete' && texto !== '',
      modelo: this.modeloTexto,
      llamadas,
      pasosDelModelo: pasos,
    };
  }

  /** POST con tiempo límite y reintentos acotados para cuota agotada, errores del servidor y fallos de red. */
  private async llamar<T>(
    base: string,
    ruta: string,
    cuerpo: unknown,
    cabeceras: Record<string, string> = {},
  ): Promise<T> {
    let ultimo: ErrorProveedorLlm | null = null;
    for (let intento = 0; intento <= this.reintentosMaximos; intento += 1) {
      const pausa = intento > 0 ? PAUSA_BASE_MS * 2 ** (intento - 1) : 0;
      const tiempo = this.tiempoParaIntento(pausa);
      if (tiempo === null) {
        // Sin tiempo para otro intento: se entrega el último fallo (o, si ni el primero cabía, uno reintentable).
        ultimo ??= new ErrorProveedorLlm('No quedó tiempo para llamar a Gemini.', null, null, true);
        break;
      }
      if (pausa > 0) {
        await this.esperar(pausa);
      }
      try {
        const respuesta = await this.fetchImpl(`${base}${ruta}`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': this.claveApi,
            'Content-Type': 'application/json',
            ...cabeceras,
          },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(tiempo),
        });
        if (respuesta.ok) {
          return (await respuesta.json()) as T;
        }
        ultimo = await this.errorDeRespuesta(respuesta);
      } catch (error) {
        ultimo =
          error instanceof ErrorProveedorLlm
            ? error
            : new ErrorProveedorLlm('No se pudo conectar con Gemini.', null, null, true);
      }
      if (!ultimo.reintentable) {
        break;
      }
    }
    throw ultimo ?? new ErrorProveedorLlm('Fallo desconocido de Gemini.', null, null, false);
  }

  private async errorDeRespuesta(respuesta: Response): Promise<ErrorProveedorLlm> {
    let codigo: string | null = null;
    try {
      const cuerpo = (await respuesta.json()) as { error?: { status?: unknown } };
      codigo = typeof cuerpo.error?.status === 'string' ? cuerpo.error.status : null;
    } catch {
      // cuerpo no JSON: basta con el estado HTTP
    }
    // Solo se conserva el estado y el código: el texto del error no se reenvía a quien llama ni a los logs.
    const reintentable = respuesta.status === 429 || respuesta.status >= 500;
    return new ErrorProveedorLlm(
      `Gemini respondió HTTP ${respuesta.status}${codigo ? ` (${codigo})` : ''}.`,
      respuesta.status,
      codigo,
      reintentable,
    );
  }
}

/** Construye el proveedor desde las variables de entorno de la Lambda. */
export function crearProveedorLlm(
  entorno: NodeJS.ProcessEnv = process.env,
  opciones: Pick<OpcionesGemini, 'timeoutMs' | 'reintentosMaximos' | 'fechaLimiteMs'> = {},
): ProveedorLlm {
  return new ProveedorGemini({
    ...opciones,
    claveApi: entorno['GEMINI_API_KEY'] ?? '',
    modeloTexto: entorno['GEMINI_MODELO_TEXTO'] || undefined,
    modeloEmbeddings: entorno['GEMINI_MODELO_EMBEDDINGS'] || undefined,
  });
}
