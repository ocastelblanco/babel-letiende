import { createHash, randomBytes } from 'node:crypto';
import { crearSiNoExiste, obtenerPorClave, sumarAtributo } from '../services/dynamodb';

/**
 * Control de operación del asistente (Fase 6, T-0060): interruptor administrable, tope de gasto diario en USD y
 * tope de mensajes por visitante y día. Todo vive en la tabla `babel-asistente-control` (clave `clave`, TTL
 * `expiraEn`):
 *
 *   `interruptor`              { activo: boolean }          (ausente = encendido; solo lo apaga)
 *   `gasto#AAAA-MM-DD`         { microUsd: número }         (suma atómica del costo estimado de cada respuesta)
 *   `visitante#AAAA-MM-DD#<h>` { mensajes: número }         (suma atómica con tope)
 *   `sal#AAAA-MM-DD`           { sal: texto }               (sal aleatoria del día para anonimizar la IP)
 *
 * El día es el de Bogotá. Todo ítem con fecha caduca solo (TTL) a los 3 días.
 */

/**
 * Tarifa de pago estándar, USD por millón de tokens. Fuente: https://ai.google.dev/gemini-api/docs/pricing
 * (leída el 21/11/2026): `gemini-3.5-flash-lite` entrada 0,30 y salida 2,50 (la salida incluye el pensamiento);
 * `gemini-embedding-2` entrada de texto 0,20. Si el proveedor cambia de modelo o de precio, se corrige aquí.
 * Como son USD por millón de tokens, tokens × tarifa da micro-USD exactos.
 */
export const TARIFA_USD_POR_MILLON = { entrada: 0.3, salida: 2.5, embeddings: 0.2 } as const;

export interface UsoDeTokens {
  /** Tokens de entrada de las llamadas de generación (sin los de embeddings). */
  tokensEntradaGeneracion: number;
  /** Tokens de salida de la generación, con el pensamiento ya incluido. */
  tokensSalida: number;
  tokensEmbeddings: number;
}

/** Costo estimado en micro-USD (1 USD = 1.000.000), redondeado hacia arriba: el tope se calcula por exceso. */
export function costoEnMicroUsd(uso: UsoDeTokens): number {
  return Math.ceil(
    uso.tokensEntradaGeneracion * TARIFA_USD_POR_MILLON.entrada +
      uso.tokensSalida * TARIFA_USD_POR_MILLON.salida +
      uso.tokensEmbeddings * TARIFA_USD_POR_MILLON.embeddings,
  );
}

export interface LimitesControl {
  topeDiarioMicroUsd: number;
  mensajesPorVisitanteDia: number;
}

export const LIMITES_POR_DEFECTO: LimitesControl = { topeDiarioMicroUsd: 1_000_000, mensajesPorVisitanteDia: 30 };

/** Lee los topes del entorno (`serverless.yml`); un valor ausente o inválido cae al valor por defecto, que es el más estricto. */
export function limitesDelEntorno(entorno: Record<string, string | undefined> = process.env): LimitesControl {
  const positivo = (texto: string | undefined, defecto: number): number => {
    const n = Number(texto);
    return texto !== undefined && texto !== '' && Number.isFinite(n) && n > 0 ? n : defecto;
  };
  return {
    topeDiarioMicroUsd: Math.round(positivo(entorno['ASISTENTE_TOPE_DIARIO_USD'], LIMITES_POR_DEFECTO.topeDiarioMicroUsd / 1e6) * 1e6),
    mensajesPorVisitanteDia: Math.floor(positivo(entorno['ASISTENTE_MENSAJES_POR_VISITANTE'], LIMITES_POR_DEFECTO.mensajesPorVisitanteDia)),
  };
}

export interface AlmacenControl {
  leer(clave: string): Promise<Record<string, unknown> | null>;
  /** `false` si ya existía. */
  crearSiNoExiste(item: Record<string, unknown>): Promise<boolean>;
  sumar(clave: string, atributo: string, cantidad: number, opciones?: { tope?: number; expiraEn?: number }): Promise<{ exito: boolean }>;
}

export function crearAlmacenControl(nombreTabla: string): AlmacenControl {
  return {
    leer: async (clave) => (await obtenerPorClave<Record<string, unknown>>(nombreTabla, { clave })) ?? null,
    crearSiNoExiste: (item) => crearSiNoExiste(nombreTabla, item, 'clave'),
    sumar: (clave, atributo, cantidad, opciones) => sumarAtributo(nombreTabla, { clave }, atributo, cantidad, opciones),
  };
}

const HORAS_BOGOTA_MS = 5 * 3600_000;
const TRES_DIAS_S = 3 * 86_400;

/** Día de Bogotá (UTC-5 fijo) en formato AAAA-MM-DD. */
export function diaDeBogota(ahoraMs: number): string {
  return new Date(ahoraMs - HORAS_BOGOTA_MS).toISOString().slice(0, 10);
}

const expiraEn = (ahoraMs: number): number => Math.floor(ahoraMs / 1000) + TRES_DIAS_S;

/** Hash de la IP con la sal del día: sirve para contar por visitante sin guardar la IP, y no se puede cruzar entre días. */
export function hashDeVisitante(ip: string, sal: string): string {
  return createHash('sha256').update(`${sal}|${ip}`).digest('hex').slice(0, 32);
}

async function salDelDia(almacen: AlmacenControl, dia: string, ahoraMs: number): Promise<string> {
  const clave = `sal#${dia}`;
  const existente = await almacen.leer(clave);
  if (typeof existente?.['sal'] === 'string') {
    return existente['sal'];
  }
  const nueva = randomBytes(16).toString('hex');
  if (await almacen.crearSiNoExiste({ clave, sal: nueva, expiraEn: expiraEn(ahoraMs) })) {
    return nueva;
  }
  // Otra petición la creó a la vez: se usa la suya, para que ambas cuenten al mismo visitante.
  const ganadora = await almacen.leer(clave);
  if (typeof ganadora?.['sal'] !== 'string') {
    throw new Error('No se pudo obtener la sal del día.');
  }
  return ganadora['sal'];
}

/**
 * Sal de un día ya pasado o actual, SOLO lectura (nunca la crea). Sirve para comprobar que quien valora una respuesta
 * es el mismo visitante que la pidió: el hash del registro se hizo con la sal de ese día. `null` si ya caducó (TTL).
 */
export async function leerSalDelDia(almacen: AlmacenControl, dia: string): Promise<string | null> {
  const existente = await almacen.leer(`sal#${dia}`);
  return typeof existente?.['sal'] === 'string' ? existente['sal'] : null;
}

export type VeredictoControl =
  | { permitido: true; dia: string; visitante: string }
  | { permitido: false; motivo: 'apagado' | 'tope-diario' | 'tope-visitante' };

/**
 * ¿Se atiende esta petición? Interruptor → tope de gasto del día → tope de mensajes de este visitante (este último
 * suma antes de responder, de forma atómica). El gasto se lee antes y se suma después (`registrarGasto`): con
 * peticiones simultáneas el tope puede pasarse por el costo de unas pocas respuestas (centavos), nunca más.
 * Cualquier fallo de la tabla lanza: el llamador responde 503, porque sin poder verificar el tope no se gasta.
 */
export async function evaluarEntrada(
  almacen: AlmacenControl,
  { ip, ahoraMs, limites }: { ip: string; ahoraMs: number; limites: LimitesControl },
): Promise<VeredictoControl> {
  const dia = diaDeBogota(ahoraMs);
  const interruptor = await almacen.leer('interruptor');
  if (interruptor?.['activo'] === false) {
    return { permitido: false, motivo: 'apagado' };
  }
  const gasto = await almacen.leer(`gasto#${dia}`);
  if (typeof gasto?.['microUsd'] === 'number' && gasto['microUsd'] >= limites.topeDiarioMicroUsd) {
    return { permitido: false, motivo: 'tope-diario' };
  }
  const visitante = hashDeVisitante(ip, await salDelDia(almacen, dia, ahoraMs));
  const suma = await almacen.sumar(`visitante#${dia}#${visitante}`, 'mensajes', 1, {
    tope: limites.mensajesPorVisitanteDia,
    expiraEn: expiraEn(ahoraMs),
  });
  return suma.exito ? { permitido: true, dia, visitante } : { permitido: false, motivo: 'tope-visitante' };
}

/** Suma el costo estimado de una respuesta al gasto del día. */
export async function registrarGasto(almacen: AlmacenControl, dia: string, microUsd: number, ahoraMs: number): Promise<void> {
  if (microUsd <= 0) {
    return;
  }
  await almacen.sumar(`gasto#${dia}`, 'microUsd', microUsd, { expiraEn: expiraEn(ahoraMs) });
}
