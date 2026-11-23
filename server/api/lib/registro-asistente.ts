import { randomUUID } from 'node:crypto';
import type { PeticionAsistente } from './asistente';
import type { RespuestaAsistente } from '../handlers/asistente';
import { diaDeBogota } from './control-asistente';

/**
 * Registro de cada turno del asistente (Fase 6, T-0060), en la tabla `babel-asistente-registros` (clave
 * `registroId`, TTL `expiraEn`). Sirve para medir (costo, latencia, rechazos, libros propuestos) y para revisar
 * fallos, no para espiar a nadie:
 *
 *  - la consulta se guarda ENMASCARADA (correos, teléfonos y números de documento) y recortada;
 *  - el texto de la respuesta NO se guarda: solo los `bookId` propuestos y las cifras;
 *  - no hay IP ni correo de la cuenta: solo el hash del visitante (sal diaria rotativa, ver `control-asistente.ts`);
 *  - caduca solo a los 90 días.
 */

export const DIAS_DE_RETENCION = 90;
export const MAXIMO_CARACTERES_CONSULTA = 500;

// --- Enmascarado -----------------------------------------------------------------------------------------

export interface TextoEnmascarado {
  texto: string;
  /** Cuántos datos personales se reemplazaron. */
  enmascarados: number;
}

const CORREO = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
// ISBN-13 (978/979 + 10 dígitos, con espacios o guiones): es dato de catálogo, no personal; se protege del enmascarado.
const ISBN_13 = /(?<!\d)97[89](?:[ -]?\d){10}(?!\d)/g;
// «cédula 1020304050», «cc: 52.123.456», «NIT 900.123.456-7», «pasaporte AB123456»…
const DOCUMENTO_CON_PALABRA = /(\bc[eé]dula|\bc\.?\s?c\b\.?|\bnit|\bdocumento|\bpasaporte|\bdni)(\D{0,15}?)(\d[\d. -]{2,}\d|\d{4,})/gi;
const TELEFONO_MOVIL = /(?<![\d$])(?:\+?57[\s.-]?)?\(?3\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const TELEFONO_FIJO = /(?<![\d$])\(?60[1-8]\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const TELEFONO_INTERNACIONAL = /(?<![\d$])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;
// «1.020.304.050», «52.123.456»: grupos de miles con punto, sin «$» delante (un precio no se enmascara).
const NUMERO_CON_PUNTOS = /(?<![\d$.,])\d{1,3}(?:\.\d{3}){2,}(?!\d)/g;
// Cualquier corrida de 7 o más dígitos que no sea un precio.
const CORRIDA_LARGA = /(?<![\d$])\d{7,}(?!\d)/g;

/**
 * Reemplaza correos, teléfonos y números de documento por marcas (`[correo]`, `[teléfono]`, `[documento]`).
 * Se prefiere enmascarar de más que de menos: un precio con `$` o de hasta 6 dígitos se conserva, y los ISBN-13
 * también; un ISBN-10 puede quedar enmascarado como documento.
 */
export function enmascararDatosPersonales(entrada: string): TextoEnmascarado {
  let enmascarados = 0;
  const marca = (nombre: string) => () => {
    enmascarados += 1;
    return `[${nombre}]`;
  };
  const isbn: string[] = [];
  let texto = entrada
    .replace(CORREO, marca('correo'))
    .replace(ISBN_13, (coincidencia) => {
      isbn.push(coincidencia);
      return `${isbn.length - 1}`;
    })
    .replace(DOCUMENTO_CON_PALABRA, (_t, palabra: string, relleno: string) => {
      enmascarados += 1;
      return `${palabra}${relleno}[documento]`;
    })
    .replace(TELEFONO_MOVIL, marca('teléfono'))
    .replace(TELEFONO_FIJO, marca('teléfono'))
    .replace(TELEFONO_INTERNACIONAL, marca('teléfono'))
    .replace(NUMERO_CON_PUNTOS, marca('documento'))
    .replace(CORRIDA_LARGA, marca('documento'));
  texto = texto.replace(/(\d+)/g, (_t, i: string) => isbn[Number(i)] ?? '');
  return { texto, enmascarados };
}

// --- Sospecha de inyección -------------------------------------------------------------------------------

const SIN_ACENTOS = /\p{Diacritic}/gu;
const PATRONES_DE_INYECCION: RegExp[] = [
  /\b(ignora|ignore|olvida|forget|disregard)\b.{0,30}\b(instrucciones|instructions|reglas|rules|prompt)\b/,
  /\b(system prompt|prompt del sistema|developer message|mensaje del desarrollador)\b/,
  /\b(tus|your) (instrucciones|instructions|reglas|rules)\b.{0,20}\b(anteriores|previous|originales)\b/,
  /\b(you are now|ahora eres|a partir de ahora eres|actua como si no tuvieras|pretend (that )?you)\b/,
  /\b(modo desarrollador|developer mode|jailbreak|do anything now)\b/,
  /\b(revela|revelame|muestra|muestrame|repite|repiteme|dime|reveal|show|print)\b.{0,30}\b(tu prompt|tus instrucciones|your prompt|your instructions|system prompt)\b/,
];

/**
 * Heurística de bandera: ¿la persona parece intentar cambiar las reglas del asistente? Solo marca el registro para
 * revisarlo después; nunca bloquea (las defensas reales son la lista blanca de datos y el validador de `bookId`).
 */
export function sospechaInyeccion(texto: string): boolean {
  const normalizado = texto.normalize('NFD').replace(SIN_ACENTOS, '').toLowerCase();
  return PATRONES_DE_INYECCION.some((patron) => patron.test(normalizado));
}

// --- Registro --------------------------------------------------------------------------------------------

export interface RegistroAsistente {
  registroId: string;
  /** ISO UTC. */
  creadoEn: string;
  /** Día de Bogotá (AAAA-MM-DD), el mismo del control de gasto. */
  dia: string;
  /** Hash del visitante con la sal del día: ni IP ni correo. */
  visitante: string;
  /** Último mensaje de la persona, enmascarado y recortado. */
  consulta: string;
  /** Mensajes de la persona en la conversación (1 = primera pregunta). */
  turnos: number;
  /** Cuántos datos personales se enmascararon en la consulta. */
  enmascarados: number;
  bookIdsPropuestos: string[];
  herramientas: string[];
  modelo: string | null;
  versionPrompt: string;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensEmbeddings: number;
  costoMicroUsd: number;
  banderas: {
    sinResultados: boolean;
    bloqueado: boolean;
    sospechaInyeccion: boolean;
    tiempoAgotado: boolean;
    reintentoFinal: boolean;
    busquedaForzada: 'anuncio' | 'sin-resultados' | null;
    disponibilidadForzada: boolean;
    descartados: number;
    fallosHerramientas: number;
  };
  /** Ausente hasta que la persona valora la respuesta (Fase 7). */
  valoracion?: 'positiva' | 'negativa';
  expiraEn: number;
}

export function construirRegistro(
  peticion: PeticionAsistente,
  respuesta: RespuestaAsistente,
  { visitante, ahoraMs }: { visitante: string; ahoraMs: number },
): RegistroAsistente {
  const mensajesDePersona = peticion.mensajes.filter((m) => m.rol === 'usuario');
  const ultimo = mensajesDePersona[mensajesDePersona.length - 1]?.texto ?? '';
  const { texto, enmascarados } = enmascararDatosPersonales(ultimo);
  const { meta } = respuesta;
  return {
    registroId: randomUUID(),
    creadoEn: new Date(ahoraMs).toISOString(),
    dia: diaDeBogota(ahoraMs),
    visitante,
    consulta: texto.slice(0, MAXIMO_CARACTERES_CONSULTA),
    turnos: mensajesDePersona.length,
    enmascarados,
    bookIdsPropuestos: respuesta.recomendaciones.map((r) => r.bookId),
    herramientas: meta.herramientas,
    modelo: meta.modelo,
    versionPrompt: meta.versionPrompt,
    latenciaMs: meta.latenciaMs,
    tokensEntrada: meta.tokensEntrada,
    tokensSalida: meta.tokensSalida,
    tokensEmbeddings: meta.tokensEmbeddings,
    costoMicroUsd: meta.costoMicroUsd,
    banderas: {
      sinResultados: respuesta.sinResultados,
      bloqueado: meta.bloqueado,
      sospechaInyeccion: sospechaInyeccion(ultimo),
      tiempoAgotado: meta.tiempoAgotado,
      reintentoFinal: meta.reintentoFinal,
      busquedaForzada: meta.busquedaForzada,
      disponibilidadForzada: meta.disponibilidadForzada,
      descartados: meta.descartados,
      fallosHerramientas: meta.fallosHerramientas,
    },
    expiraEn: Math.floor(ahoraMs / 1000) + DIAS_DE_RETENCION * 86_400,
  };
}
