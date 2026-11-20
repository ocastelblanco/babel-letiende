#!/usr/bin/env node
/**
 * Evalúa el RECUPERADOR del asistente (sin modelo de lenguaje) sobre la copia congelada y genera los
 * candidatos que la persona valida. Solo gasta embeddings de las preguntas (una por caso, y se guardan
 * en `congelado/consultas.json`: volver a puntuar no llama a la API).
 *
 *   node asistente-ia/scripts/evaluar-recuperador.mjs --candidatos   # escribe congelado/candidatos.md
 *   node asistente-ia/scripts/evaluar-recuperador.mjs                # Recall@k y Hit@k con los aceptables validados
 *   node asistente-ia/scripts/evaluar-recuperador.mjs --complemento # candidatos que la persona no vio (los límites del caso cambian lo que se recupera)
 *   node asistente-ia/scripts/evaluar-recuperador.mjs --dry-run      # qué haría, sin llamar a la API
 *
 * El recuperador es el mismo de producción: filtros del índice → coseno (40) → existencias y precio →
 * hasta 8 libros al modelo. Recall@8 es lo que el modelo llega a ver; Recall@40, lo que el índice encuentra.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { CANDIDATOS_DEL_INDICE, LIBROS_AL_MODELO, filtroDelIndice, seleccionarCandidatos, textoDeConsulta } from '../../dist-server/api/lib/asistente.js';
import { buscarSimilares, deserializarIndice } from '../../dist-server/api/lib/indice-vectorial.js';
import { formatearBloqueDeValidacion, hitEnK, normalizarTexto, recallEnK } from '../../dist-server/api/lib/evaluacion-asistente.js';
import { CARPETA_CONGELADO, cargarCasos, cargarInventarioCongelado, leerClaveGemini } from './lib-evals.mjs';

const CANDIDATOS_POR_FUENTE = 10;
const ARCHIVO_INDICE = join(CARPETA_CONGELADO, 'indice.bin');
const ARCHIVO_CONSULTAS = join(CARPETA_CONGELADO, 'consultas.json');
const argumentos = new Set(process.argv.slice(2));
const casos = cargarCasos();
const conPregunta = casos.filter((c) => ['aceptables', 'restricciones', 'politicas'].includes(c.categoria) && (c.aceptables !== undefined));

if (argumentos.has('--dry-run')) {
  const consultas = existsSync(ARCHIVO_CONSULTAS) ? JSON.parse(readFileSync(ARCHIVO_CONSULTAS, 'utf8')) : {};
  const faltan = conPregunta.filter((c) => !(textoDeConsulta(c.mensajes) in consultas)).length;
  console.log(`--dry-run: ${casos.length} casos, ${conPregunta.length} con aceptables (${conPregunta.filter((c) => c.aceptables === null).length} pendientes de validar). Embeddings de preguntas por pedir: ${faltan}.`);
  process.exit(0);
}
if (!existsSync(ARCHIVO_INDICE)) {
  console.error('No hay índice local. Corre primero: node asistente-ia/scripts/construir-indice-evals.mjs');
  process.exit(1);
}

const inventario = cargarInventarioCongelado();
const indice = deserializarIndice(readFileSync(ARCHIVO_INDICE));
const consultas = existsSync(ARCHIVO_CONSULTAS) ? JSON.parse(readFileSync(ARCHIVO_CONSULTAS, 'utf8')) : {};
let proveedor = null;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function vectorDe(texto) {
  if (consultas[texto]) return consultas[texto];
  const clave = leerClaveGemini();
  if (!clave) throw new Error('Falta GEMINI_API_KEY (entorno o .env) para pedir el embedding de una pregunta nueva.');
  proveedor ??= new ProveedorGemini({ claveApi: clave });
  for (let intento = 0; ; intento += 1) {
    try {
      const resultado = await proveedor.incrustarConsulta(texto);
      consultas[texto] = resultado.vectores[0];
      writeFileSync(ARCHIVO_CONSULTAS, JSON.stringify(consultas));
      return consultas[texto];
    } catch (error) {
      if (intento >= 3) throw error;
      console.log(`   (falló el embedding, espero 20 s: ${error.name})`);
      await esperar(20_000);
    }
  }
}

function inventarioDe(bookIds) {
  return new Map(bookIds.map((id) => [id, inventario.libros.get(id)]).filter(([, l]) => l));
}

/**
 * Los casos de «restricciones» guardan el límite que la respuesta debe cumplir (`precioMaximo`, `idioma`);
 * un modelo que hace bien su trabajo lo manda como filtro de `buscar_libros`, y el recuperador se mide así.
 * (Medirlos sin filtro daba cero en todos: fallo del evaluador, no del recuperador.)
 */
function filtrosDeRestricciones(restricciones) {
  const filtros = {};
  if (restricciones?.precioMaximo !== undefined) filtros.precioMaximo = restricciones.precioMaximo;
  if (restricciones?.idioma !== undefined) filtros.idioma = restricciones.idioma;
  return filtros;
}

/** Ranking del índice (40) y lo que de él llega al modelo (hasta 8, con existencias y precio). */
async function recuperar(caso) {
  const consulta = textoDeConsulta(caso.mensajes);
  const filtros = caso.filtros ?? filtrosDeRestricciones(caso.restricciones);
  const similares = buscarSimilares(indice, await vectorDe(consulta), { k: CANDIDATOS_DEL_INDICE, filtro: filtroDelIndice(filtros) });
  const alModelo = seleccionarCandidatos(similares, inventarioDe(similares.map((s) => s.bookId)), filtros, LIBROS_AL_MODELO);
  return { top40: similares.map((s) => s.bookId), al8: alModelo.map((l) => l.bookId), similares, filtros };
}

/** Candidatos por palabras: coincidencias en título y autor pesan más que en la sinopsis. Solo libros con existencias. */
function porPalabras(caso) {
  const palabras = (caso.busqueda ?? []).map(normalizarTexto).filter(Boolean);
  if (palabras.length === 0) return [];
  const puntuados = [];
  for (const libro of inventario.libros.values()) {
    if (!(libro.cantidadDisponible > 0)) continue;
    const cabecera = normalizarTexto(`${libro.titulo} ${libro.autor}`);
    const sinopsis = normalizarTexto(inventario.conocimiento.get(libro.bookId)?.sinopsis ?? '');
    const puntaje = palabras.reduce((s, p) => s + (cabecera.includes(p) ? 3 : 0) + (sinopsis.includes(p) ? 1 : 0), 0);
    if (puntaje > 0) puntuados.push({ bookId: libro.bookId, puntaje });
  }
  return puntuados.sort((a, b) => b.puntaje - a.puntaje || a.bookId.localeCompare(b.bookId)).slice(0, CANDIDATOS_POR_FUENTE).map((p) => p.bookId);
}

function candidatoPara(bookId) {
  const libro = inventario.libros.get(bookId);
  const k = inventario.conocimiento.get(bookId);
  return { bookId, titulo: libro.titulo, autor: libro.autor, pvp: libro.pvp, idioma: k?.idioma ?? null, extracto: (k?.sinopsis ?? '').replace(/\s+/g, ' ').slice(0, 160) };
}

const resultados = [];
for (const caso of conPregunta) {
  resultados.push({ caso, ...(await recuperar(caso)) });
}

if (argumentos.has('--candidatos')) {
  const bloques = ['# Candidatos para validar', '', 'Para cada pregunta marca con una `x` los libros que te parecen buenas respuestas y agrega con `+` los que conozcas y no aparezcan. **Este archivo está fuera de git** (contiene extractos de sinopsis de terceros). Cuando termines, avísame: yo cargo tus marcas en los casos.', ''];
  let total = 0;
  let soloPorPalabras = 0;
  for (const r of resultados.filter((x) => x.caso.aceptables === null)) {
    const delRecuperador = r.al8.length >= CANDIDATOS_POR_FUENTE ? r.al8.slice(0, CANDIDATOS_POR_FUENTE) : seleccionarCandidatos(r.similares, inventarioDe(r.top40), r.filtros, CANDIDATOS_POR_FUENTE).map((l) => l.bookId);
    const palabras = porPalabras(r.caso);
    soloPorPalabras += palabras.filter((id) => !r.top40.includes(id)).length;
    const identidad = (id) => inventario.libros.get(id).isbn ?? id;
    const vistos = new Set();
    const union = [...delRecuperador, ...palabras].filter((id) => !vistos.has(identidad(id)) && vistos.add(identidad(id)));
    total += union.length;
    bloques.push(formatearBloqueDeValidacion(r.caso, union.map(candidatoPara)));
  }
  writeFileSync(join(CARPETA_CONGELADO, 'candidatos.md'), bloques.join('\n'));
  console.log(`Escribí ${join(CARPETA_CONGELADO, 'candidatos.md')}: ${resultados.filter((x) => x.caso.aceptables === null).length} preguntas, ${total} candidatos en total.`);
  console.log(`Candidatos que la búsqueda por palabras aportó y NO estaban entre los 40 del recuperador: ${soloPorPalabras} (puntos ciegos posibles del recuperador).`);
  process.exit(0);
}

const medibles = resultados.filter((r) => Array.isArray(r.caso.aceptables) && r.caso.aceptables.length > 0);
if (medibles.length === 0) {
  console.log('Todavía no hay aceptables validados: no hay contra qué medir. Corre con --candidatos y valida el archivo.');
  process.exit(0);
}
const media = (valores) => valores.filter((v) => v !== null).reduce((s, v, _, a) => s + v / a.length, 0);
const tabla = medibles.map((r) => ({ caso: r.caso.id, aceptables: r.caso.aceptables.length, 'recall@8': recallEnK(r.al8, r.caso.aceptables, 8), 'recall@40': recallEnK(r.top40, r.caso.aceptables, 40), 'hit@8': hitEnK(r.al8, r.caso.aceptables, 8), 'hit@40': hitEnK(r.top40, r.caso.aceptables, 40) }));
console.table(tabla);
console.log(`Promedio sobre ${medibles.length} casos — Recall@8: ${media(tabla.map((t) => t['recall@8'])).toFixed(2)} · Recall@40: ${media(tabla.map((t) => t['recall@40'])).toFixed(2)} · Hit@8: ${media(tabla.map((t) => t['hit@8'])).toFixed(2)} · Hit@40: ${media(tabla.map((t) => t['hit@40'])).toFixed(2)}`);

// Diagnóstico de sesgo: libros que llegan al modelo con los filtros del caso y que la persona nunca vio.
const archivoCandidatos = join(CARPETA_CONGELADO, 'candidatos.md');
const archivoComplemento = join(CARPETA_CONGELADO, 'candidatos-complemento.md');
const identidad = (id) => inventario.libros.get(id)?.isbn ?? id;
/** `bookId` de cada caso en un archivo de candidatos, por identidad (ISBN): el archivo original quitó duplicados por ISBN. */
function vistosEn(archivo) {
  const porCaso = new Map();
  if (!existsSync(archivo)) return porCaso;
  for (const bloque of readFileSync(archivo, 'utf8').split(/^## /m).slice(1)) {
    porCaso.set(bloque.slice(0, bloque.indexOf(' ')), new Set([...bloque.matchAll(/`([0-9a-f-]{36})`/g)].map((m) => identidad(m[1]))));
  }
  return porCaso;
}
if (existsSync(archivoCandidatos)) {
  const generandoComplemento = argumentos.has('--complemento');
  const vistos = vistosEn(archivoCandidatos);
  const vistosComplemento = generandoComplemento ? new Map() : vistosEn(archivoComplemento);
  const sinVer = medibles
    .map((r) => ({
      r,
      sinVer: r.al8.filter((id) => {
        const clave = identidad(id);
        return !vistos.get(r.caso.id)?.has(clave) && !vistosComplemento.get(r.caso.id)?.has(clave) && !r.caso.aceptables.some((a) => identidad(a) === clave);
      }),
    }))
    .filter((x) => x.sinVer.length > 0);
  console.log(`Libros entregados al modelo que la persona no ha visto (no se pueden contar como acierto ni como error): ${sinVer.map((x) => `${x.r.caso.id}:${x.sinVer.length}`).join(' ') || 'ninguno'}`);
  if (generandoComplemento) {
    if (existsSync(archivoComplemento)) {
      console.error(`Ya existe ${archivoComplemento}: no lo sobrescribo para no perder marcas. Bórralo o renómbralo si de verdad quieres generarlo otra vez.`);
      process.exit(1);
    }
    const bloques = ['# Candidatos complementarios para validar', '', 'Son libros que el recuperador entrega al modelo cuando se aplican los límites de la pregunta (precio, idioma) y que no estaban en la primera lista. Marca con una `x` los que serían una buena respuesta y agrega con `+` los que falten. **Este archivo está fuera de git** (contiene extractos de sinopsis de terceros). Cuando termines, avísame.', ''];
    for (const x of sinVer) bloques.push(formatearBloqueDeValidacion(x.r.caso, x.sinVer.map(candidatoPara)));
    writeFileSync(archivoComplemento, bloques.join('\n'));
    console.log(`Escribí ${archivoComplemento}: ${sinVer.length} preguntas, ${sinVer.reduce((n, x) => n + x.sinVer.length, 0)} candidatos.`);
  }
}
writeFileSync(join(CARPETA_CONGELADO, 'recuperador.json'), JSON.stringify({ generadoEn: new Date().toISOString(), tabla }, null, 2));
