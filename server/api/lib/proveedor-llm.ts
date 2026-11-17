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

export interface PeticionGeneracion {
  instrucciones: string;
  mensajes: MensajeConversacion[];
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
