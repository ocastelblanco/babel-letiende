/**
 * Interfaz neutral al proveedor del modelo de lenguaje (ADR-015). El resto del
 * backend del asistente depende solo de esto: cambiar de Gemini a Azure, o de
 * una API a otra del mismo proveedor, es escribir otra implementación.
 */

/** Un libro (o fragmento) que se convierte en vector para la búsqueda. */
export interface DocumentoParaIncrustar {
  titulo: string | null;
  texto: string;
}

export interface ResultadoIncrustacion {
  /** Un vector por documento, en el mismo orden. Normalizados (norma 1) para que el producto punto sea el coseno. */
  vectores: number[][];
  tokensEntrada: number;
}

export interface MensajeConversacion {
  rol: 'usuario' | 'asistente';
  texto: string;
}

/** Una herramienta que el modelo puede pedir que se ejecute. */
export interface DeclaracionHerramienta {
  nombre: string;
  descripcion: string;
  /** JSON Schema del objeto de argumentos (`type: 'object'`, `properties`, `required`). */
  parametros: Record<string, unknown>;
}

/** El modelo pide ejecutar una herramienta. Los argumentos vienen del modelo: hay que validarlos antes de usarlos. */
export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
}

/**
 * Una vuelta del ciclo «el modelo pide herramientas → se ejecutan → se le devuelven los resultados».
 * `pasosDelModelo` es lo que el modelo respondió en esa vuelta y se devuelve TAL CUAL (opaco para
 * quien llama): el proveedor exige reenviarlo completo, incluido su razonamiento interno.
 */
export interface RondaHerramientas {
  pasosDelModelo: unknown[];
  resultados: { llamadaId: string; nombre: string; contenido: string }[];
}

export interface PeticionGeneracion {
  instrucciones: string;
  mensajes: MensajeConversacion[];
  /** Herramientas disponibles en esta vuelta. */
  herramientas?: DeclaracionHerramienta[];
  /** Vueltas de herramientas ya ocurridas desde el último mensaje de la persona, en orden. */
  rondas?: RondaHerramientas[];
  /** Obliga al modelo a llamar a una de estas herramientas en vez de responder con texto. */
  forzarHerramientas?: string[];
  /** Subconjunto de JSON Schema/OpenAPI que el proveedor aplica a la salida. */
  esquemaSalida: Record<string, unknown>;
  maximoTokensSalida: number;
  /** Cuánto «piensa» el modelo antes de responder; más pensamiento cuesta más tokens de salida. Por defecto `low`. */
  nivelPensamiento?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface ResultadoGeneracion {
  /** Texto JSON tal como lo devolvió el modelo; quien llama lo parsea y valida. */
  texto: string;
  tokensEntrada: number;
  /** Incluye el «pensamiento» del modelo, que se factura como salida. */
  tokensSalida: number;
  tokensPensamiento: number;
  /** El proveedor rechazó la entrada o la salida por sus políticas de seguridad. */
  bloqueado: boolean;
  /** Se cortó por llegar al tope de tokens: el JSON puede estar incompleto. */
  truncado: boolean;
  modelo: string;
  /** Herramientas que el modelo pide ejecutar. Si hay alguna, `texto` no es la respuesta final. */
  llamadas: LlamadaHerramienta[];
  /** Los pasos de esta vuelta, para devolverlos en la siguiente `RondaHerramientas`. */
  pasosDelModelo: unknown[];
}

export interface ProveedorLlm {
  readonly nombre: string;
  readonly modeloEmbeddings: string;
  readonly modeloTexto: string;
  incrustarDocumentos(documentos: DocumentoParaIncrustar[]): Promise<ResultadoIncrustacion>;
  incrustarConsulta(consulta: string): Promise<ResultadoIncrustacion>;
  generarJson(peticion: PeticionGeneracion): Promise<ResultadoGeneracion>;
}

/** Fallo del proveedor. El mensaje nunca incluye la clave ni el cuerpo completo de la respuesta. */
export class ErrorProveedorLlm extends Error {
  constructor(
    mensaje: string,
    readonly estadoHttp: number | null,
    /** Código del proveedor (`RESOURCE_EXHAUSTED`, `INVALID_ARGUMENT`...), si lo hay. */
    readonly codigo: string | null,
    /** Reintentar tiene sentido (límite de cuota, error transitorio del servidor, red). */
    readonly reintentable: boolean,
  ) {
    super(mensaje);
    this.name = 'ErrorProveedorLlm';
  }
}
