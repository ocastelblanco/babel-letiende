import {
  ErrorProveedorLlm,
  type DocumentoParaIncrustar,
  type PeticionGeneracion,
  type ProveedorLlm,
  type ResultadoGeneracion,
  type ResultadoIncrustacion,
} from './proveedor-llm';

/**
 * Implementación de `ProveedorLlm` sobre la Gemini API (REST, `v1beta`).
 *
 * El contrato se comprobó contra la API real el 2026-11-17 con el workflow
 * `asistente-verificar-gemini.yml` (no se escribió de memoria ni solo de la
 * documentación, que ya describe la Interactions API):
 * - `gemini-embedding-2` no admite `task_type`: el rol del texto va como prefijo
 *   (`title: ... | text: ...` para documentos, `task: search result | query: ...`
 *   para consultas). Con `output_dimensionality: 768` devuelve vectores de norma 1.
 * - `batchEmbedContents` devuelve un vector por cada petición del lote.
 * - `generateContent` acepta `responseMimeType` + `responseSchema` y reporta el
 *   uso en `usageMetadata`.
 * La clave viaja solo en la cabecera `x-goog-api-key`; nunca en la URL ni en logs.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const MODELO_TEXTO_POR_DEFECTO = 'gemini-3.5-flash-lite';
export const MODELO_EMBEDDINGS_POR_DEFECTO = 'gemini-embedding-2';
export const DIMENSIONES_POR_DEFECTO = 768;
/** Peticiones por `batchEmbedContents`; margen conservador, la documentación no fija un tope para este modelo. */
const TAMANO_LOTE_EMBEDDINGS = 50;
const TIMEOUT_MS = 20_000;
const REINTENTOS_MAXIMOS = 2;
const PAUSA_BASE_MS = 500;

export interface OpcionesGemini {
  claveApi: string;
  modeloTexto?: string;
  modeloEmbeddings?: string;
  dimensiones?: number;
  /** Para pruebas. */
  fetchImpl?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
}

interface UsoGemini {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
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
        usageMetadata?: UsoGemini;
      }>(`/models/${this.modeloEmbeddings}:batchEmbedContents`, {
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
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: UsoGemini;
    }>(`/models/${this.modeloTexto}:generateContent`, {
      systemInstruction: { parts: [{ text: peticion.instrucciones }] },
      contents: peticion.mensajes.map((mensaje) => ({
        role: mensaje.rol === 'usuario' ? 'user' : 'model',
        parts: [{ text: mensaje.texto }],
      })),
      generationConfig: {
        maxOutputTokens: peticion.maximoTokensSalida,
        responseMimeType: 'application/json',
        responseSchema: peticion.esquemaSalida,
      },
    });

    const candidato = respuesta.candidates?.[0];
    const texto = (candidato?.content?.parts ?? [])
      .filter((parte) => !parte.thought && typeof parte.text === 'string')
      .map((parte) => parte.text)
      .join('');
    const razon = candidato?.finishReason ?? null;
    const uso = respuesta.usageMetadata ?? {};
    const pensamiento = uso.thoughtsTokenCount ?? 0;
    return {
      texto,
      tokensEntrada: uso.promptTokenCount ?? 0,
      tokensSalida: (uso.candidatesTokenCount ?? 0) + pensamiento,
      tokensPensamiento: pensamiento,
      bloqueado:
        Boolean(respuesta.promptFeedback?.blockReason) ||
        razon === 'SAFETY' ||
        razon === 'PROHIBITED_CONTENT',
      truncado: razon === 'MAX_TOKENS',
      modelo: this.modeloTexto,
    };
  }

  /** POST con tiempo límite y reintentos acotados para cuota agotada, errores del servidor y fallos de red. */
  private async llamar<T>(ruta: string, cuerpo: unknown): Promise<T> {
    let ultimo: ErrorProveedorLlm | null = null;
    for (let intento = 0; intento <= REINTENTOS_MAXIMOS; intento += 1) {
      if (intento > 0) {
        await this.esperar(PAUSA_BASE_MS * 2 ** (intento - 1));
      }
      try {
        const respuesta = await this.fetchImpl(`${BASE_URL}${ruta}`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.claveApi, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(TIMEOUT_MS),
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
export function crearProveedorLlm(entorno: NodeJS.ProcessEnv = process.env): ProveedorLlm {
  return new ProveedorGemini({
    claveApi: entorno['GEMINI_API_KEY'] ?? '',
    modeloTexto: entorno['GEMINI_MODELO_TEXTO'] || undefined,
    modeloEmbeddings: entorno['GEMINI_MODELO_EMBEDDINGS'] || undefined,
  });
}
