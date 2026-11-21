import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntradaIndice } from './indice-vectorial';
import type { MensajeConversacion } from './proveedor-llm';

/**
 * Lógica pura del asistente de recomendación (`asistente-ia/PLAN.md` Fase 2, T-0023):
 * validación de la petición, búsqueda híbrida (filtros → candidatos), armado del
 * contexto que ve el modelo y validación de lo que el modelo responde. Nada aquí
 * toca la red ni la base de datos, para poder probarlo entero con el modelo simulado.
 */

// ---------------------------------------------------------------------------
// Límites (A04/A05): todo lo que llega del cliente se acota en el servidor.
// ---------------------------------------------------------------------------

export const MAXIMO_TURNOS = 9;
export const MAXIMO_CARACTERES_MENSAJE = 1000;
export const MAXIMO_CARACTERES_CUERPO = 20_000;
/** Libros que se piden al índice antes de filtrar por existencias y precio (que viven en la base de datos). */
export const CANDIDATOS_DEL_INDICE = 40;
/** Libros que ve el modelo: más contexto cuesta tokens y no mejora la respuesta. */
export const LIBROS_AL_MODELO = 8;
export const MAXIMO_RECOMENDACIONES = 3;
const MAXIMO_CARACTERES_SINOPSIS = 700;
const MAXIMO_CARACTERES_CONSULTA = 600;
const MAXIMO_CARACTERES_TEXTO_RESPUESTA = 1200;
const MAXIMO_CARACTERES_MOTIVO = 400;
const MAXIMO_PRECIO = 10_000_000;

export const TEXTO_SIN_RESULTADOS =
  'No encontré en la librería un libro que encaje con eso. ¿Quieres contarme un poco más de lo que buscas, o probar con otro tema?';
export const TEXTO_DEMORA =
  'Esto está tardando más de lo normal y prefiero no hacerte esperar. ¿Me repites tu pregunta en un momento?';
export const TEXTO_SIN_CONFIRMAR =
  'No tengo a mano las existencias ni la ubicación exacta de ese libro en este momento. Pregúntanos en la librería, o intenta de nuevo en un momento.';
export const TEXTO_BLOQUEADO =
  'No puedo ayudarte con esa consulta. Si quieres, cuéntame qué tipo de lectura buscas y te recomiendo algo de la librería.';

// ---------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------

export interface FiltrosAsistente {
  /** Código de idioma de dos o tres letras (`es`, `en`, `pt`...). Un libro de idioma desconocido no cumple el filtro. */
  idioma?: string;
  /** PVP máximo en COP. */
  precioMaximo?: number;
  /** Excluye los libros que Google Books marca como `MATURE`. Es el único dato de edad que hay hoy. */
  excluirContenidoAdulto?: boolean;
}

export interface PeticionAsistente {
  mensajes: MensajeConversacion[];
  filtros: FiltrosAsistente;
  /**
   * `bookId` de los libros que el asistente recomendó en cada mensaje suyo (misma posición que `mensajes`;
   * vacío en los de la persona). El historial solo trae texto, y sin esto «el libro que me recomendaste»
   * no se puede resolver a un libro concreto para consultar su disponibilidad.
   */
  librosPorMensaje?: string[][];
}

/** Identificador de un libro: el de `babel-libros` es un UUID; se acepta solo lo que no puede ser otra cosa. */
const FORMATO_BOOK_ID = /^[0-9a-f-]{8,64}$/i;

/** La petición no cumple el contrato. El mensaje lo escribimos nosotros y es seguro mostrarlo. */
export class ErrorPeticion extends Error {}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export function validarPeticion(cuerpo: unknown): PeticionAsistente {
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['mensajes'])) {
    throw new ErrorPeticion('Falta la lista de mensajes.');
  }
  const crudos = cuerpo['mensajes'] as unknown[];
  if (crudos.length === 0 || crudos.length > MAXIMO_TURNOS) {
    throw new ErrorPeticion(`La conversación debe tener entre 1 y ${MAXIMO_TURNOS} mensajes.`);
  }
  const librosPorMensaje: string[][] = [];
  const mensajes: MensajeConversacion[] = crudos.map((crudo, posicion) => {
    if (!esObjeto(crudo) || (crudo['rol'] !== 'usuario' && crudo['rol'] !== 'asistente')) {
      throw new ErrorPeticion('Cada mensaje necesita un rol válido.');
    }
    // La conversación alterna empezando y terminando con la persona.
    const rolEsperado = posicion % 2 === 0 ? 'usuario' : 'asistente';
    if (crudo['rol'] !== rolEsperado) {
      throw new ErrorPeticion('Los mensajes deben alternar entre la persona y el asistente, empezando por la persona.');
    }
    if (typeof crudo['texto'] !== 'string') {
      throw new ErrorPeticion('Cada mensaje necesita un texto.');
    }
    const texto = crudo['texto'].trim();
    if (texto === '') {
      throw new ErrorPeticion('Un mensaje está vacío.');
    }
    if (texto.length > MAXIMO_CARACTERES_MENSAJE) {
      throw new ErrorPeticion(`Un mensaje supera los ${MAXIMO_CARACTERES_MENSAJE} caracteres.`);
    }
    librosPorMensaje.push(validarLibrosDelMensaje(crudo));
    return { rol: crudo['rol'], texto };
  });
  if (mensajes[mensajes.length - 1].rol !== 'usuario') {
    throw new ErrorPeticion('El último mensaje debe ser de la persona.');
  }
  return { mensajes, filtros: validarFiltros(cuerpo['filtros']), librosPorMensaje };
}

/** `libros` es opcional y solo vale en los mensajes del asistente; cualquier otra cosa se ignora. */
function validarLibrosDelMensaje(mensaje: Record<string, unknown>): string[] {
  const libros = mensaje['libros'];
  if (mensaje['rol'] !== 'asistente' || libros === undefined || libros === null) {
    return [];
  }
  if (!Array.isArray(libros) || libros.length > MAXIMO_RECOMENDACIONES) {
    throw new ErrorPeticion(`«libros» debe ser una lista de hasta ${MAXIMO_RECOMENDACIONES} identificadores.`);
  }
  if (!libros.every((id) => typeof id === 'string' && FORMATO_BOOK_ID.test(id))) {
    throw new ErrorPeticion('«libros» solo admite identificadores de libro.');
  }
  return [...new Set(libros as string[])];
}

function validarFiltros(crudos: unknown): FiltrosAsistente {
  if (crudos === undefined || crudos === null) {
    return {};
  }
  if (!esObjeto(crudos)) {
    throw new ErrorPeticion('Los filtros no son válidos.');
  }
  const filtros: FiltrosAsistente = {};
  if (crudos['idioma'] !== undefined && crudos['idioma'] !== null) {
    if (typeof crudos['idioma'] !== 'string' || !/^[a-z]{2,3}$/i.test(crudos['idioma'])) {
      throw new ErrorPeticion('El idioma debe ser un código de dos o tres letras.');
    }
    filtros.idioma = crudos['idioma'].toLowerCase();
  }
  if (crudos['precioMaximo'] !== undefined && crudos['precioMaximo'] !== null) {
    const precio = crudos['precioMaximo'];
    if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0 || precio > MAXIMO_PRECIO) {
      throw new ErrorPeticion('El precio máximo debe ser un número positivo.');
    }
    filtros.precioMaximo = precio;
  }
  if (crudos['excluirContenidoAdulto'] !== undefined && crudos['excluirContenidoAdulto'] !== null) {
    if (typeof crudos['excluirContenidoAdulto'] !== 'boolean') {
      throw new ErrorPeticion('excluirContenidoAdulto debe ser verdadero o falso.');
    }
    filtros.excluirContenidoAdulto = crudos['excluirContenidoAdulto'];
  }
  return filtros;
}

// ---------------------------------------------------------------------------
// Búsqueda híbrida
// ---------------------------------------------------------------------------

/**
 * Texto con el que se busca: lo último que pidió la persona, más lo anterior si cabe
 * («algo de misterio» … «y que sea corto» necesita las dos frases). Solo mensajes de la
 * persona: lo que dijo el asistente no es una preferencia.
 */
export function textoDeConsulta(mensajes: MensajeConversacion[]): string {
  const delUsuario = mensajes.filter((mensaje) => mensaje.rol === 'usuario').map((m) => m.texto);
  const partes: string[] = [];
  let largo = 0;
  for (let i = delUsuario.length - 1; i >= 0; i -= 1) {
    const restante = MAXIMO_CARACTERES_CONSULTA - largo;
    if (restante <= 0) {
      break;
    }
    const parte = delUsuario[i].slice(0, restante);
    partes.unshift(parte);
    largo += parte.length + 1;
  }
  return partes.join(' ');
}

/** Filtro previo a la similitud, con los datos que el índice guarda por libro. */
export function filtroDelIndice(filtros: FiltrosAsistente): (entrada: EntradaIndice) => boolean {
  return (entrada) => {
    if (filtros.idioma !== undefined && entrada.idioma !== filtros.idioma) {
      return false;
    }
    if (filtros.excluirContenidoAdulto && entrada.clasificacionEdad === 'MATURE') {
      return false;
    }
    // Antes de la similitud: con el precio después del top-40, una pregunta sin tema y un límite
    // bajo nunca veía los libros baratos (R07, línea base de 4b). Un libro sin precio en el índice pasa,
    // y `seleccionarCandidatos` revisa el precio vigente contra la base de datos en todos los casos.
    if (filtros.precioMaximo !== undefined && typeof entrada.pvp === 'number' && entrada.pvp > filtros.precioMaximo) {
      return false;
    }
    return true;
  };
}

export interface LibroDeInventario {
  bookId: string;
  isbn?: string | null;
  titulo: string;
  autor: string;
  portadaUrl?: string | null;
  pvp: number;
  cantidadDisponible: number;
  ubicacionId?: string;
}

/**
 * De los candidatos del índice (ya ordenados por similitud) deja los que se pueden
 * vender hoy y entran en el presupuesto. El índice puede estar hasta unas horas atrás
 * respecto de la base de datos: un libro vendido o borrado desde entonces se descarta aquí.
 * Los ejemplares del mismo ISBN en distintas ubicaciones cuentan como un solo libro.
 */
export function seleccionarCandidatos(
  ordenados: { bookId: string }[],
  inventario: Map<string, LibroDeInventario>,
  filtros: FiltrosAsistente,
  limite: number = LIBROS_AL_MODELO,
): LibroDeInventario[] {
  const elegidos: LibroDeInventario[] = [];
  const vistos = new Set<string>();
  for (const { bookId } of ordenados) {
    const libro = inventario.get(bookId);
    if (!libro || !(libro.cantidadDisponible > 0)) {
      continue;
    }
    if (filtros.precioMaximo !== undefined && !(libro.pvp <= filtros.precioMaximo)) {
      continue;
    }
    const identidad = libro.isbn ? `isbn:${libro.isbn}` : `id:${libro.bookId}`;
    if (vistos.has(identidad)) {
      continue;
    }
    vistos.add(identidad);
    elegidos.push(libro);
    if (elegidos.length >= limite) {
      break;
    }
  }
  return elegidos;
}

// ---------------------------------------------------------------------------
// Contexto para el modelo
// ---------------------------------------------------------------------------

export interface ConocimientoDeLibro {
  sinopsis: string | null;
  categorias: string[];
  idioma: string | null;
}

export interface LibroParaModelo {
  bookId: string;
  titulo: string;
  autor: string;
  categorias: string[];
  idioma: string | null;
  /** COP. */
  precio: number;
  sinopsis: string | null;
}

/**
 * Lista blanca de lo que el modelo ve de cada libro: nunca `costo`, `utilidad`,
 * descuentos, existencias exactas ni quién lo catalogó (CLAUDE.md, ficha pública).
 */
export function libroParaModelo(
  libro: LibroDeInventario,
  conocimiento: ConocimientoDeLibro | null,
): LibroParaModelo {
  const sinopsis = conocimiento?.sinopsis?.trim() ?? '';
  return {
    bookId: libro.bookId,
    titulo: libro.titulo,
    autor: libro.autor,
    categorias: conocimiento?.categorias ?? [],
    idioma: conocimiento?.idioma ?? null,
    precio: libro.pvp,
    sinopsis: sinopsis === '' ? null : sinopsis.slice(0, MAXIMO_CARACTERES_SINOPSIS),
  };
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
/** Bogotá no tiene horario de verano: siempre UTC-5. */
const DESFASE_BOGOTA_MS = -5 * 60 * 60 * 1000;

function fechaEnLetras(desplazada: Date): string {
  return `${DIAS_SEMANA[desplazada.getUTCDay()]} ${desplazada.getUTCDate()} de ${MESES[desplazada.getUTCMonth()]} de ${desplazada.getUTCFullYear()}`;
}

/**
 * Día y hora de Bogotá en palabras, para que el modelo no tenga que adivinar de qué día se
 * habla cuando preguntan «¿abren mañana?». Se calcula en el servidor: el modelo no tiene reloj
 * y, sin este dato, inventa el día (staging, 18/11/2026: dijo el horario de un miércoles para un jueves).
 * El día de mañana se da calculado porque un modelo pequeño falla en la aritmética de fechas.
 */
export function momentoActualParaModelo(ahoraMs: number): { hoy: string; manana: string; hora: string } {
  const hoy = new Date(ahoraMs + DESFASE_BOGOTA_MS);
  const manana = new Date(ahoraMs + DESFASE_BOGOTA_MS + 24 * 60 * 60 * 1000);
  const horas = hoy.getUTCHours();
  const minutos = String(hoy.getUTCMinutes()).padStart(2, '0');
  const hora12 = horas % 12 === 0 ? 12 : horas % 12;
  return {
    hoy: fechaEnLetras(hoy),
    manana: fechaEnLetras(manana),
    hora: `${hora12}:${minutos} ${horas < 12 ? 'a. m.' : 'p. m.'}`,
  };
}

/**
 * Conversación que recibe el modelo. Los libros (y la fecha) van en el ÚLTIMO turno de la persona,
 * serializados como JSON: así una sinopsis (texto de un tercero) o el mensaje de la persona
 * no pueden salirse de su cadena para parecer una instrucción, y nada de eso llega al
 * campo de instrucciones del sistema.
 */
export function mensajesParaModelo(
  mensajes: MensajeConversacion[],
  libros: LibroParaModelo[],
  ahoraMs: number = Date.now(),
  politicas: { tema: string; texto: string }[] = [],
  recomendadosAntes: { bookId: string; titulo: string; autor: string }[] = [],
): MensajeConversacion[] {
  const ultimo = mensajes.length - 1;
  const momento = momentoActualParaModelo(ahoraMs);
  // Lo que el asistente recomendó antes, leído de la base: «ese libro» y «el que me recomendaste» se resuelven con esto.
  const bloqueRecomendadosAntes =
    recomendadosAntes.length === 0
      ? ''
      : `\n\nLIBROS_RECOMENDADOS_ANTES (si la persona habla de «ese libro» o «el que me recomendaste», son estos; consulta con estos bookId):\n${JSON.stringify(recomendadosAntes)}`;
  const fecha = `FECHA_Y_HORA_ACTUAL:\nHoy: ${momento.hoy}, ${momento.hora} (hora de Bogotá)\nMañana: ${momento.manana}`;
  return mensajes.map((mensaje, posicion) =>
    posicion === ultimo
      ? {
          rol: mensaje.rol,
          texto: `${fecha}\n\nPOLITICAS_DE_LA_LIBRERIA:\n${JSON.stringify(politicas)}\n\nLIBROS_DISPONIBLES:\n${JSON.stringify(libros)}${bloqueRecomendadosAntes}\n\nMENSAJE_DE_LA_PERSONA:\n${mensaje.texto}`,
        }
      : mensaje,
  );
}

export const ESQUEMA_SALIDA: Record<string, unknown> = {
  type: 'object',
  properties: {
    texto: { type: 'string' },
    recomendaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { bookId: { type: 'string' }, motivo: { type: 'string' } },
        required: ['bookId', 'motivo'],
      },
    },
    sinResultados: { type: 'boolean' },
  },
  required: ['texto', 'recomendaciones', 'sinResultados'],
};

// ---------------------------------------------------------------------------
// Validación de la respuesta del modelo
// ---------------------------------------------------------------------------

/**
 * Frase con la que el modelo promete buscar («Permíteme revisar…», «Déjame consultar…») en vez de
 * hacerlo. También cuenta ofrecer la búsqueda («podemos buscar en el inventario completo»): sin
 * recomendaciones, ofrecerla es no hacerla; pero solo con el verbo pegado, para no confundir la
 * amabilidad de un rechazo («puedo ayudarte a buscar un libro»). Exige el verbo de búsqueda cerca del anuncio para no confundir una pregunta aclaratoria
 * («¿qué género te gustaría buscar?») ni una respuesta de políticas.
 */
const ANUNCIO_DE_BUSQUEDA =
  /\b(perm[ií]teme|d[eé]jame|voy a|vamos a|dame un momento|un momento|enseguida)\b[^.?!]{0,40}?\b(revis|busc|consult|verific|chequ|mir[oa]r?\b|ver\b)|\b(puedo|podemos)\s+(revisar|buscar|consultar|verificar)\b/i;

/**
 * «Anuncia y no actúa» (línea base de 4b, R01 en 3 de 3 con v5): la respuesta final no recomienda
 * nada y su texto promete una búsqueda que no hizo. `sinResultados` no cuenta: en la primera corrida
 * de la Fase 5 el modelo anunció «Déjame revisar…» y a la vez marcó `sinResultados`. Lee el JSON crudo
 * del modelo; si no se puede leer, no es este caso (lo resuelve la validación normal).
 */
export function anunciaSinActuar(textoJson: string): boolean {
  let objeto: unknown;
  try {
    objeto = JSON.parse(textoJson);
  } catch {
    return false;
  }
  if (!esObjeto(objeto) || typeof objeto['texto'] !== 'string') {
    return false;
  }
  const recomendaciones = objeto['recomendaciones'];
  if (Array.isArray(recomendaciones) && recomendaciones.length > 0) {
    return false;
  }
  return ANUNCIO_DE_BUSQUEDA.test(objeto['texto']);
}

/**
 * Por qué el servidor debe obligar al modelo a buscar antes de entregar su respuesta, o `null`.
 * `LIBROS_DISPONIBLES` son solo los 8 libros más parecidos y no conocen el precio ni el idioma que la
 * persona escribió en su mensaje: un «no hay» dicho sin buscar puede ser falso (R01 y R07 de la suite,
 * Fase 5: «no tenemos novelas por menos de $30.000» con 9 en inventario). Solo aplica si en este turno
 * todavía no se buscó: después de buscar, «no hay» se respeta.
 */
export function motivoParaBuscar(textoJson: string): 'anuncio' | 'sin-resultados' | null {
  if (anunciaSinActuar(textoJson)) {
    return 'anuncio';
  }
  let objeto: unknown;
  try {
    objeto = JSON.parse(textoJson);
  } catch {
    return null;
  }
  if (!esObjeto(objeto) || objeto['sinResultados'] !== true) {
    return null;
  }
  const recomendaciones = objeto['recomendaciones'];
  return Array.isArray(recomendaciones) && recomendaciones.length > 0 ? null : 'sin-resultados';
}

const NUMERO = '(?:\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';
/** «quedan 5 unidades», «tenemos 1 ejemplar», «nos queda 2». */
const AFIRMA_EXISTENCIAS = new RegExp(`\\b${NUMERO}\\s+(?:unidades?|ejemplar(?:es)?|copias?)\\b|\\bquedan?\\s+${NUMERO}\\b`, 'i');
/**
 * Nombres con los que el modelo inventa dónde está un libro («lo tenemos en la estantería de terror, mueble
 * principal», «en el primer piso»). Solo cuentan los sustantivos de lugar dentro de la librería, sin exigir un
 * verbo: el modelo los dice con «encuentras», «tenemos», «está», «queda»… Las ubicaciones reales (Sala VIP,
 * Biblioteca 2, Estante 3) solo las conoce `consultar_disponibilidad`.
 */
const AFIRMA_UBICACION = /\b(?:estante|estanter[ií]a|mueble|piso|repisa|vitrina|sala\s+(?:vip|principal)|biblioteca\s+\d)\b/i;
/**
 * «Para saber la ubicación exacta te sugiero consultarlo en la librería»: remitir a la persona a preguntar lo que
 * `consultar_disponibilidad` le puede decir (prohibido por el prompt, y el modelo lo hizo 2 de 3 veces en la prueba
 * manual del 21/11/2026). Exige a la vez un verbo de preguntar y un dato de inventario, para no confundir una
 * respuesta de políticas («pregunta en la librería por los cambios»).
 */
const REMITE_A_LA_LIBRERIA =
  /(?=[^]*\b(?:ubicaci[oó]n|lugar|d[oó]nde|existencias|cu[aá]ntos?\s+quedan|precio|disponibilidad)\b)[^]*\b(?:preg[uú]ntalo|preg[uú]ntanos|preguntarlo|preguntarnos|consultarlo|consultarnos|consulta\s+directamente)\b/i;

/**
 * La persona pregunta por existencias o por dónde está un libro dentro de la librería («¿en qué lugar está?»,
 * «¿cuántos quedan?»). El prompt exige llamar `consultar_disponibilidad` en estos casos y el modelo, a veces,
 * prefiere esquivar («te invito a consultarlo en la librería») o responder de memoria. «¿Dónde queda la
 * librería?» NO cuenta: es una pregunta de políticas.
 */
const PIDE_DATOS_DE_INVENTARIO =
  /\b(?:en\s+qu[eé]\s+(?:lugar|estante|piso|mueble|sala|parte|secci[oó]n)|cu[aá]ntos?\s+(?:quedan|hay|ejemplares|unidades|copias)|cu[aá]ntas?\s+(?:unidades|copias|quedan|hay)|existencias|d[oó]nde\s+(?:lo|la|los|las)\s+(?:encuentro|encuentras|puedo\s+encontrar|consigo)|d[oó]nde\s+est[aá]n?\s+(?:el|ese|este|la|esa|esta|los|las)\s+(?:libros?|novelas?|ejemplar(?:es)?)|hay\s+(?:disponibilidad|ejemplares|unidades))\b/i;

export function pideDatosDeInventario(textoDeLaPersona: string): boolean {
  return PIDE_DATOS_DE_INVENTARIO.test(textoDeLaPersona);
}

/**
 * El texto da existencias o ubicación de un libro, o remite a la persona a preguntarlas en la librería. El modelo NO tiene esos datos en `LIBROS_DISPONIBLES`
 * (la lista blanca no lleva existencias exactas ni ubicación): solo salen de `consultar_disponibilidad`.
 * Dicho sin haberla llamado es inventado: en la prueba manual del 21/11/2026 el modelo dijo «quedan 5
 * unidades, en el primer piso, estante de terror» cuando había 1, en la Sala VIP (2 de 3 intentos).
 * Lee el JSON crudo del modelo; si no se puede leer, no es este caso.
 */
export function afirmaDatosDeInventario(textoJson: string): boolean {
  let objeto: unknown;
  try {
    objeto = JSON.parse(textoJson);
  } catch {
    return false;
  }
  if (!esObjeto(objeto) || typeof objeto['texto'] !== 'string') {
    return false;
  }
  const texto = objeto['texto'];
  return AFIRMA_EXISTENCIAS.test(texto) || AFIRMA_UBICACION.test(texto) || REMITE_A_LA_LIBRERIA.test(texto);
}

/** La salida del modelo no sirve (no es JSON, no cumple el esquema o se cortó). */
export class ErrorRespuestaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    // Sin esto el registro decía solo «Error» y el 502 de staging (18/11/2026) no se podía diagnosticar.
    this.name = 'ErrorRespuestaInvalida';
  }
}

export interface RespuestaValidada {
  texto: string;
  recomendaciones: { bookId: string; motivo: string }[];
  sinResultados: boolean;
  /** Recomendaciones que el modelo propuso y se descartaron (inexistentes, agotadas o fuera de la lista). */
  descartados: number;
}

/**
 * El modelo solo puede recomendar libros de la lista que se le dio en este turno
 * (`permitidos`): todo otro `bookId` —inventado, agotado, o de otro turno— se descarta y se
 * cuenta. Si el modelo recomendó algo y todo se descartó, su texto probablemente nombra
 * esos libros: se reemplaza por la respuesta segura de «sin resultados».
 */
export function validarRespuesta(textoJson: string, permitidos: Set<string>): RespuestaValidada {
  let objeto: unknown;
  try {
    objeto = JSON.parse(textoJson);
  } catch {
    throw new ErrorRespuestaInvalida('La respuesta del modelo no es JSON.');
  }
  if (
    !esObjeto(objeto) ||
    typeof objeto['texto'] !== 'string' ||
    !Array.isArray(objeto['recomendaciones']) ||
    typeof objeto['sinResultados'] !== 'boolean'
  ) {
    throw new ErrorRespuestaInvalida('La respuesta del modelo no cumple el esquema.');
  }
  const propuestas = objeto['recomendaciones'] as unknown[];
  const recomendaciones: { bookId: string; motivo: string }[] = [];
  const yaIncluidos = new Set<string>();
  let descartados = 0;
  for (const propuesta of propuestas) {
    const valida =
      esObjeto(propuesta) &&
      typeof propuesta['bookId'] === 'string' &&
      typeof propuesta['motivo'] === 'string' &&
      permitidos.has(propuesta['bookId']) &&
      !yaIncluidos.has(propuesta['bookId']);
    if (!valida || recomendaciones.length >= MAXIMO_RECOMENDACIONES) {
      descartados += 1;
      continue;
    }
    const bookId = propuesta['bookId'] as string;
    yaIncluidos.add(bookId);
    recomendaciones.push({
      bookId,
      motivo: (propuesta['motivo'] as string).trim().slice(0, MAXIMO_CARACTERES_MOTIVO),
    });
  }
  if (propuestas.length > 0 && recomendaciones.length === 0) {
    return { texto: TEXTO_SIN_RESULTADOS, recomendaciones: [], sinResultados: true, descartados };
  }
  const texto = objeto['texto'].trim().slice(0, MAXIMO_CARACTERES_TEXTO_RESPUESTA);
  if (texto === '') {
    throw new ErrorRespuestaInvalida('La respuesta del modelo no trae texto.');
  }
  return {
    texto,
    recomendaciones,
    sinResultados: recomendaciones.length === 0 && objeto['sinResultados'],
    descartados,
  };
}

// ---------------------------------------------------------------------------
// Prompt versionado
// ---------------------------------------------------------------------------

export interface PromptAsistente {
  version: string;
  modelo: string;
  fecha: string;
  motivo: string;
  instrucciones: string;
  /** El prompt está escrito para usar herramientas (encabezado `herramientas: true`). Las versiones sin ese dato no las usan. */
  herramientas: boolean;
}

const prompts = new Map<string, PromptAsistente>();

/**
 * Carga `asistente-ia/prompts/asistente-<version>.md`: un encabezado `---` con versión,
 * modelo, fecha y motivo, y el resto del archivo es el prompt tal cual. Una sola fuente:
 * el mismo archivo que se lee y se versiona es el que corre en la Lambda (se empaqueta).
 */
export function cargarPrompt(
  version: string = 'v1',
  raiz: string = process.env['LAMBDA_TASK_ROOT'] ?? process.cwd(),
): PromptAsistente {
  if (!/^v\d{1,3}$/.test(version)) {
    // Evita que una variable de entorno mal escrita abra rutas arbitrarias.
    throw new Error(`Versión de prompt inválida: ${version}`);
  }
  const clave = `${raiz}::${version}`;
  const guardado = prompts.get(clave);
  if (guardado) {
    return guardado;
  }
  const contenido = readFileSync(
    join(raiz, 'asistente-ia', 'prompts', `asistente-${version}.md`),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const partes = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(contenido);
  if (!partes) {
    throw new Error(`El prompt ${version} no tiene encabezado.`);
  }
  const encabezado = new Map<string, string>();
  for (const linea of partes[1].split('\n')) {
    const separador = linea.indexOf(':');
    if (separador > 0) {
      encabezado.set(linea.slice(0, separador).trim(), linea.slice(separador + 1).trim());
    }
  }
  const instrucciones = partes[2].trim();
  const campos = ['version', 'modelo', 'fecha', 'motivo'].map((campo) => encabezado.get(campo));
  if (campos.some((campo) => !campo) || instrucciones === '') {
    throw new Error(`El prompt ${version} tiene el encabezado o el cuerpo incompletos.`);
  }
  const prompt: PromptAsistente = {
    version: campos[0] as string,
    modelo: campos[1] as string,
    fecha: campos[2] as string,
    motivo: campos[3] as string,
    instrucciones,
    herramientas: encabezado.get('herramientas') === 'true',
  };
  prompts.set(clave, prompt);
  return prompt;
}
