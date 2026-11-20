import { createHash } from 'node:crypto';

/**
 * Índice vectorial del asistente (`asistente-ia/PLAN.md` Fase 2, T-0022).
 *
 * Un solo archivo, sin base de datos vectorial: con ~3.000 libros, una búsqueda
 * por fuerza bruta sobre vectores en memoria tarda microsegundos y no cuesta
 * nada. El archivo guarda SOLO vectores y datos para filtrar; nunca el texto de
 * las sinopsis (que son de terceros).
 *
 * Formato binario (little endian):
 *   4 bytes  magia `BIDX`
 *   4 bytes  versión del formato (uint32)
 *   4 bytes  largo del encabezado JSON (uint32)
 *   N bytes  encabezado JSON: { modelo, dimensiones, creadoEn, entradas[] }
 *   resto    un vector int8 de `dimensiones` bytes por entrada, en orden
 *
 * Los vectores llegan normalizados (norma 1) y se cuantizan a int8 con una
 * escala fija de 127: 768 bytes por libro en vez de 3.072 (≈ 2,3 MB en vez de
 * 9,2 MB para 3.000 libros). La cuantización altera el puntaje en el orden del
 * 1 %, suficiente para ordenar candidatos; el puntaje exacto no se usa para nada más.
 */

const MAGIA = 'BIDX';
export const VERSION_FORMATO = 1;
const ESCALA = 127;
/** Tope de caracteres del texto que se convierte en vector (el modelo admite 8.192 tokens; esto lo deja muy por debajo). */
const MAXIMO_CARACTERES_TEXTO = 6000;

export interface EntradaIndice {
  bookId: string;
  /** Huella del texto con el que se calculó el vector: si cambia, hay que recalcularlo. */
  hash: string;
  /** El libro no tiene sinopsis: se indexó solo con título, autor y lo que haya. */
  sinSinopsis: boolean;
  /** Para filtrar sin volver a leer la base de datos. */
  idioma: string | null;
  clasificacionEdad: string | null;
  /**
   * PVP en COP, para filtrar por precio ANTES de la similitud (Fase 5): si se filtra después del top-k,
   * con un límite bajo los libros baratos nunca llegan al modelo. Opcional porque los índices escritos
   * antes no lo traen; sin él, el libro pasa este filtro y el precio se revisa contra la base de datos.
   */
  pvp?: number | null;
}

export interface IndiceVectorial {
  modelo: string;
  dimensiones: number;
  creadoEn: string;
  entradas: EntradaIndice[];
  /** `vectores[i]` corresponde a `entradas[i]`. */
  vectores: Int8Array[];
}

export class ErrorIndiceInvalido extends Error {
  constructor(detalle: string) {
    super(`El archivo del índice es inválido: ${detalle}.`);
    this.name = 'ErrorIndiceInvalido';
  }
}

// ---------------------------------------------------------------------------
// Texto que se convierte en vector
// ---------------------------------------------------------------------------

export interface DatosLibroParaIndice {
  bookId: string;
  titulo: string;
  autor: string;
  pvp?: number | null;
}

export interface ConocimientoParaIndice {
  sinopsis: string | null;
  categorias: string[];
  idioma: string | null;
  clasificacionEdad: string | null;
}

export interface DocumentoIndice {
  bookId: string;
  titulo: string;
  texto: string;
  hash: string;
  sinSinopsis: boolean;
  idioma: string | null;
  clasificacionEdad: string | null;
  pvp: number | null;
}

/** «Título + autor + categorías + sinopsis»; lo que falte simplemente no entra. */
export function documentoParaIndice(
  libro: DatosLibroParaIndice,
  conocimiento: ConocimientoParaIndice | null,
): DocumentoIndice {
  const partes: string[] = [];
  if (libro.autor?.trim()) {
    partes.push(`autor: ${libro.autor.trim()}`);
  }
  const categorias = (conocimiento?.categorias ?? []).filter(
    (categoria) => categoria.trim() !== '',
  );
  if (categorias.length > 0) {
    partes.push(`categorías: ${categorias.join(', ')}`);
  }
  const sinopsis = conocimiento?.sinopsis?.trim() ?? '';
  if (sinopsis) {
    partes.push(`sinopsis: ${sinopsis}`);
  }
  const titulo = (libro.titulo ?? '').trim();
  const texto = partes.join(' | ').slice(0, MAXIMO_CARACTERES_TEXTO);
  return {
    bookId: libro.bookId,
    titulo,
    texto,
    hash: createHash('sha256').update(`${titulo}\n${texto}`).digest('hex').slice(0, 16),
    sinSinopsis: sinopsis === '',
    idioma: conocimiento?.idioma ?? null,
    clasificacionEdad: conocimiento?.clasificacionEdad ?? null,
    // El precio no entra en la huella: cambiarlo no exige un vector nuevo.
    pvp: typeof libro.pvp === 'number' && Number.isFinite(libro.pvp) && libro.pvp > 0 ? libro.pvp : null,
  };
}

// ---------------------------------------------------------------------------
// Cuantización y búsqueda
// ---------------------------------------------------------------------------

/** Normaliza (por si el proveedor no lo hizo) y cuantiza a int8. */
export function cuantizar(vector: number[]): Int8Array {
  const norma = Math.sqrt(vector.reduce((suma, x) => suma + x * x, 0)) || 1;
  const resultado = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    resultado[i] = Math.max(-ESCALA, Math.min(ESCALA, Math.round((vector[i] / norma) * ESCALA)));
  }
  return resultado;
}

export interface ResultadoBusqueda {
  bookId: string;
  /** Coseno aproximado, entre -1 y 1. */
  puntaje: number;
}

/**
 * Los `k` libros más parecidos a la consulta. `filtro` se aplica ANTES de puntuar
 * (idioma, edad...). El orden es determinista: a igual puntaje, por `bookId`.
 */
export function buscarSimilares(
  indice: IndiceVectorial,
  consulta: number[],
  opciones: { k: number; filtro?: (entrada: EntradaIndice) => boolean },
): ResultadoBusqueda[] {
  if (consulta.length !== indice.dimensiones) {
    throw new ErrorIndiceInvalido(
      `la consulta tiene ${consulta.length} dimensiones y el índice ${indice.dimensiones}`,
    );
  }
  const norma = Math.sqrt(consulta.reduce((suma, x) => suma + x * x, 0)) || 1;
  const unitaria = consulta.map((x) => x / norma);
  const resultados: ResultadoBusqueda[] = [];
  indice.entradas.forEach((entrada, posicion) => {
    if (opciones.filtro && !opciones.filtro(entrada)) {
      return;
    }
    const vector = indice.vectores[posicion];
    let producto = 0;
    for (let i = 0; i < unitaria.length; i += 1) {
      producto += unitaria[i] * vector[i];
    }
    resultados.push({ bookId: entrada.bookId, puntaje: producto / ESCALA });
  });
  resultados.sort((a, b) => b.puntaje - a.puntaje || a.bookId.localeCompare(b.bookId));
  return resultados.slice(0, Math.max(0, opciones.k));
}

// ---------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------

export function serializarIndice(indice: IndiceVectorial): Buffer {
  if (indice.entradas.length !== indice.vectores.length) {
    throw new ErrorIndiceInvalido('hay un número distinto de entradas y de vectores');
  }
  const encabezado = Buffer.from(
    JSON.stringify({
      modelo: indice.modelo,
      dimensiones: indice.dimensiones,
      creadoEn: indice.creadoEn,
      entradas: indice.entradas,
    }),
    'utf8',
  );
  const cabecera = Buffer.alloc(12);
  cabecera.write(MAGIA, 0, 'ascii');
  cabecera.writeUInt32LE(VERSION_FORMATO, 4);
  cabecera.writeUInt32LE(encabezado.length, 8);
  const cuerpo = Buffer.alloc(indice.vectores.length * indice.dimensiones);
  indice.vectores.forEach((vector, posicion) => {
    if (vector.length !== indice.dimensiones) {
      throw new ErrorIndiceInvalido('un vector no tiene la dimensión declarada');
    }
    cuerpo.set(vector as unknown as Uint8Array, posicion * indice.dimensiones);
  });
  return Buffer.concat([cabecera, encabezado, cuerpo]);
}

export function deserializarIndice(contenido: Buffer): IndiceVectorial {
  if (contenido.length < 12 || contenido.toString('ascii', 0, 4) !== MAGIA) {
    throw new ErrorIndiceInvalido('no empieza con la magia esperada');
  }
  const version = contenido.readUInt32LE(4);
  if (version !== VERSION_FORMATO) {
    throw new ErrorIndiceInvalido(`versión de formato ${version} no soportada`);
  }
  const largoEncabezado = contenido.readUInt32LE(8);
  if (12 + largoEncabezado > contenido.length) {
    throw new ErrorIndiceInvalido('el encabezado excede el archivo');
  }
  let encabezado: {
    modelo?: unknown;
    dimensiones?: unknown;
    creadoEn?: unknown;
    entradas?: unknown;
  };
  try {
    encabezado = JSON.parse(
      contenido.toString('utf8', 12, 12 + largoEncabezado),
    ) as typeof encabezado;
  } catch {
    throw new ErrorIndiceInvalido('el encabezado no es JSON');
  }
  const { modelo, dimensiones, creadoEn, entradas } = encabezado;
  if (
    typeof modelo !== 'string' ||
    typeof creadoEn !== 'string' ||
    !Number.isInteger(dimensiones) ||
    !Array.isArray(entradas)
  ) {
    throw new ErrorIndiceInvalido('el encabezado está incompleto');
  }
  const dim = dimensiones as number;
  const cuerpo = contenido.subarray(12 + largoEncabezado);
  if (dim <= 0 || cuerpo.length !== entradas.length * dim) {
    throw new ErrorIndiceInvalido(
      'el tamaño del cuerpo no coincide con las entradas y las dimensiones',
    );
  }
  const vectores = entradas.map((_, posicion) => {
    const vector = new Int8Array(dim);
    for (let i = 0; i < dim; i += 1) {
      vector[i] = cuerpo.readInt8(posicion * dim + i);
    }
    return vector;
  });
  return { modelo, dimensiones: dim, creadoEn, entradas: entradas as EntradaIndice[], vectores };
}

// ---------------------------------------------------------------------------
// Reconstrucción incremental
// ---------------------------------------------------------------------------

export interface PlanReconstruccion {
  /** Libros cuyo vector actual sigue vigente: se conservan tal cual. */
  conservados: { entrada: EntradaIndice; vector: Int8Array }[];
  /** Libros nuevos o cuyo texto cambió: hay que pedir su vector. */
  porIncrustar: DocumentoIndice[];
  /**
   * Libros que ya estaban indexados pero cuyo texto cambió: su vector anterior sigue
   * disponible mientras no se reemplace, para que un fallo del proveedor no los saque
   * del índice (un vector algo viejo es mejor que ninguno).
   */
  desactualizados: Map<string, { entrada: EntradaIndice; vector: Int8Array }>;
  eliminados: number;
}

/**
 * Compara el índice vigente con los libros de hoy por la huella del texto (no por
 * una fecha: el título y el autor viven en `babel-libros` y su edición no toca la
 * fecha del conocimiento). Si cambió el modelo o las dimensiones, ningún vector
 * viejo sirve: los vectores de modelos distintos no son comparables.
 */
export function planificarReconstruccion(
  existente: IndiceVectorial | null,
  documentos: DocumentoIndice[],
  modelo: string,
  dimensiones: number,
): PlanReconstruccion {
  const reutilizable =
    existente !== null && existente.modelo === modelo && existente.dimensiones === dimensiones;
  const previos = new Map<string, { entrada: EntradaIndice; vector: Int8Array }>();
  if (reutilizable) {
    existente.entradas.forEach((entrada, posicion) =>
      previos.set(entrada.bookId, { entrada, vector: existente.vectores[posicion] }),
    );
  }
  const vigentes = new Set(documentos.map((documento) => documento.bookId));
  const conservados: PlanReconstruccion['conservados'] = [];
  const porIncrustar: DocumentoIndice[] = [];
  const desactualizados = new Map<string, { entrada: EntradaIndice; vector: Int8Array }>();
  for (const documento of documentos) {
    const previo = previos.get(documento.bookId);
    if (previo && previo.entrada.hash === documento.hash) {
      // Los datos para filtrar pueden cambiar sin que cambie el texto (p. ej. el idioma o el precio): se refrescan sin pedir un vector nuevo.
      conservados.push({
        entrada: {
          bookId: documento.bookId,
          hash: documento.hash,
          sinSinopsis: documento.sinSinopsis,
          idioma: documento.idioma,
          clasificacionEdad: documento.clasificacionEdad,
          pvp: documento.pvp,
        },
        vector: previo.vector,
      });
    } else {
      if (previo) {
        desactualizados.set(documento.bookId, previo);
      }
      porIncrustar.push(documento);
    }
  }
  const eliminados = [...previos.keys()].filter((bookId) => !vigentes.has(bookId)).length;
  return { conservados, porIncrustar, desactualizados, eliminados };
}
