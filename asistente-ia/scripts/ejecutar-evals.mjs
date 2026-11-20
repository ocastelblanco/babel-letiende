#!/usr/bin/env node
/**
 * Ejecutor de la suite de evaluación (Fase 4b). Corre `responder()` —el mismo código de producción— en
 * este proceso, con el inventario congelado, el índice local y las políticas reales, y puntúa cada
 * respuesta con `puntuarRespuesta`. Sin juez LLM: solo comprobaciones deterministas.
 *
 *   node asistente-ia/scripts/ejecutar-evals.mjs --prompt v5,v4 --repeticiones 3
 *   node asistente-ia/scripts/ejecutar-evals.mjs --prompt v5 --limit 5          # humo barato
 *   node asistente-ia/scripts/ejecutar-evals.mjs --prompt v5 --dry-run          # cuenta y estima, sin llamar a la API
 *   node asistente-ia/scripts/ejecutar-evals.mjs --reanudar asistente-ia/evals/resultados/<archivo>.jsonl
 *
 * Opciones: --casos A01,R02 · --categorias restricciones,politicas · --rpm 12 · --max-llamadas 450
 *           --permitir-indice-parcial · --permitir-versiones-antiguas
 *
 * Cuota (AI Studio, 19/11/2026): 15 RPM y 500 solicitudes/día de generación. El ejecutor espacia las
 * llamadas (`--rpm`) y se detiene limpio al llegar a `--max-llamadas`; lo hecho queda guardado y se
 * continúa con `--reanudar`. Solo texto sintético y de catálogo: nunca preguntas reales de visitantes.
 *
 * Crudo (con las respuestas) → `asistente-ia/evals/resultados/` (fuera de git).
 * Agregado (sin respuestas) → `asistente-ia/evals/resumenes/` (en git).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { ErrorProveedorLlm } from '../../dist-server/api/lib/proveedor-llm.js';
import { responder } from '../../dist-server/api/handlers/asistente.js';
import { cargarPrompt, validarPeticion } from '../../dist-server/api/lib/asistente.js';
import { cargarPoliticas } from '../../dist-server/api/lib/herramientas-asistente.js';
import { deserializarIndice } from '../../dist-server/api/lib/indice-vectorial.js';
import { puntuarRespuesta, resumirCorrida } from '../../dist-server/api/lib/evaluacion-asistente.js';
import { CARPETA_CONGELADO, cargarCasos, cargarInventarioCongelado, leerClaveGemini } from './lib-evals.mjs';

const CARPETA_RESULTADOS = 'asistente-ia/evals/resultados';
const CARPETA_RESUMENES = 'asistente-ia/evals/resumenes';
const ARCHIVO_INDICE = join(CARPETA_CONGELADO, 'indice.bin');
const ARCHIVO_CONSULTAS = join(CARPETA_CONGELADO, 'consultas.json');
const RPM_EMBEDDINGS = 90;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Argumentos ------------------------------------------------------------------------------------
function leerArgumentos(argv) {
  const opciones = { prompt: 'v5', repeticiones: 1, limit: null, casos: null, categorias: null, rpm: 12, maxLlamadas: 450, reanudar: null };
  const banderas = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento inesperado: ${a}`);
    const nombre = a.slice(2);
    if (['dry-run', 'permitir-indice-parcial', 'permitir-versiones-antiguas'].includes(nombre)) {
      banderas.add(nombre);
      continue;
    }
    const valor = argv[++i];
    if (valor === undefined) throw new Error(`Falta el valor de ${a}`);
    if (nombre === 'prompt') opciones.prompt = valor;
    else if (nombre === 'repeticiones') opciones.repeticiones = Number(valor);
    else if (nombre === 'limit') opciones.limit = Number(valor);
    else if (nombre === 'casos') opciones.casos = valor.split(',');
    else if (nombre === 'categorias') opciones.categorias = valor.split(',');
    else if (nombre === 'rpm') opciones.rpm = Number(valor);
    else if (nombre === 'max-llamadas') opciones.maxLlamadas = Number(valor);
    else if (nombre === 'reanudar') opciones.reanudar = valor;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  for (const [n, v] of [['repeticiones', opciones.repeticiones], ['rpm', opciones.rpm], ['max-llamadas', opciones.maxLlamadas]]) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`--${n} debe ser un entero positivo.`);
  }
  return { ...opciones, versiones: opciones.prompt.split(',').map((v) => v.trim()), banderas };
}

let args;
try {
  args = leerArgumentos(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const antiguas = args.versiones.filter((v) => ['v1', 'v2', 'v3'].includes(v));
if (antiguas.length > 0 && !args.banderas.has('permitir-versiones-antiguas')) {
  console.error(`${antiguas.join(', ')}: las versiones v1–v3 solo se comparan en 4c. El código actual siempre manda fecha y políticas, y v2/v3 piden una herramienta que ya no existe: los números no serían comparables. Usa --permitir-versiones-antiguas si lo quieres a sabiendas.`);
  process.exit(1);
}

// --- Selección de casos ----------------------------------------------------------------------------
let casos = cargarCasos();
if (args.casos) casos = casos.filter((c) => args.casos.includes(c.id));
if (args.categorias) casos = casos.filter((c) => args.categorias.includes(c.categoria));
if (args.limit) casos = casos.slice(0, args.limit);
if (casos.length === 0) {
  console.error('Ningún caso coincide con los filtros.');
  process.exit(1);
}
const prompts = new Map(args.versiones.map((v) => [v, cargarPrompt(v, process.cwd())]));
const ejecuciones = casos.length * args.versiones.length * args.repeticiones;
const llamadasMinimas = [...prompts.values()].reduce((s, p) => s + casos.length * args.repeticiones * (p.herramientas ? 2 : 1), 0);

if (args.banderas.has('dry-run')) {
  console.log(`--dry-run: ${casos.length} casos × ${args.versiones.length} versión(es) (${args.versiones.join(', ')}) × ${args.repeticiones} repetición(es) = ${ejecuciones} ejecuciones.`);
  console.log(`Llamadas de generación: al menos ${llamadasMinimas} (cada ejecución con herramientas usa 2 o más; con reintentos pueden ser más). Tope --max-llamadas: ${args.maxLlamadas}.`);
  console.log(`A ${args.rpm} RPM, solo la espera entre llamadas suma ${(llamadasMinimas / args.rpm).toFixed(1)} min como mínimo.`);
  if (llamadasMinimas > args.maxLlamadas) console.log('⚠ Se necesitará más de una sesión (--reanudar), o subir el límite diario con prepago.');
  process.exit(0);
}

// --- Preparación -----------------------------------------------------------------------------------
if (!existsSync(ARCHIVO_INDICE)) {
  console.error('No hay índice local. Corre primero: node asistente-ia/scripts/construir-indice-evals.mjs');
  process.exit(1);
}
const inventario = cargarInventarioCongelado();
const indice = deserializarIndice(readFileSync(ARCHIVO_INDICE));
if (indice.entradas.length < inventario.libros.size && !args.banderas.has('permitir-indice-parcial')) {
  console.error(`El índice local tiene ${indice.entradas.length} de ${inventario.libros.size} libros. Medir con un índice parcial falsea el recuperador: termina el índice o usa --permitir-indice-parcial.`);
  process.exit(1);
}
// EVALS_PROVEEDOR_SIMULADO=1 sustituye a Gemini por un doble sin red: solo sirve para probar el cableado del ejecutor.
const simulado = process.env.EVALS_PROVEEDOR_SIMULADO === '1';
const clave = simulado ? 'simulado' : leerClaveGemini();
if (!clave) {
  console.error('Falta GEMINI_API_KEY (entorno o .env).');
  process.exit(1);
}

class TopeAlcanzado extends Error {}
const consultas = existsSync(ARCHIVO_CONSULTAS) ? JSON.parse(readFileSync(ARCHIVO_CONSULTAS, 'utf8')) : {};
const base = simulado
  ? {
      nombre: 'simulado',
      modeloTexto: 'simulado',
      modeloEmbeddings: indice.modelo,
      incrustarDocumentos: async () => ({ vectores: [], tokensEntrada: 0 }),
      incrustarConsulta: async () => ({ vectores: [Array.from({ length: indice.dimensiones }, (_, i) => Math.sin(i + 1))], tokensEntrada: 1 }),
      generarJson: async () => ({ texto: JSON.stringify({ texto: 'respuesta simulada', recomendaciones: [], sinResultados: true }), tokensEntrada: 1, tokensSalida: 1, tokensPensamiento: 0, bloqueado: false, truncado: false, modelo: 'simulado', llamadas: [], pasosDelModelo: [] }),
    }
  : new ProveedorGemini({ claveApi: clave, timeoutMs: 30_000, reintentosMaximos: 1 });
let llamadas = 0;
let ultimaGeneracion = 0;
let ultimaIncrustacion = 0;

/** Mismo proveedor, con espaciado por RPM, tope de llamadas y caché en disco de los embeddings de consulta. */
const proveedor = {
  nombre: base.nombre,
  modeloTexto: base.modeloTexto,
  modeloEmbeddings: base.modeloEmbeddings,
  incrustarDocumentos: (d) => base.incrustarDocumentos(d),
  async incrustarConsulta(texto) {
    if (consultas[texto]) return { vectores: [consultas[texto]], tokensEntrada: 0 };
    const espera = ultimaIncrustacion + 60_000 / RPM_EMBEDDINGS - Date.now();
    if (espera > 0) await esperar(espera);
    ultimaIncrustacion = Date.now();
    const resultado = await base.incrustarConsulta(texto);
    consultas[texto] = resultado.vectores[0];
    writeFileSync(ARCHIVO_CONSULTAS, JSON.stringify(consultas));
    return resultado;
  },
  async generarJson(peticion) {
    if (llamadas >= args.maxLlamadas) throw new TopeAlcanzado(`Tope de ${args.maxLlamadas} llamadas de generación en esta sesión.`);
    const espera = ultimaGeneracion + 60_000 / args.rpm - Date.now();
    if (espera > 0) await esperar(espera);
    ultimaGeneracion = Date.now();
    llamadas += 1;
    return base.generarJson(peticion);
  },
};

const politicas = cargarPoliticas(process.cwd());
const dependenciasDe = (version, ahoraFijo) => {
  const t0 = Date.now();
  return {
    proveedor,
    cargarIndice: async () => indice,
    leerLibro: async (bookId) => inventario.libros.get(bookId) ?? null,
    leerConocimiento: async (bookId) => inventario.conocimiento.get(bookId) ?? null,
    leerUbicacion: async (id) => inventario.ubicaciones[id] ?? null,
    politicas,
    prompt: prompts.get(version),
    // Fecha fija por caso (los de políticas dependen de ella) pero el reloj sigue corriendo para los topes de tiempo.
    ahora: ahoraFijo === null ? Date.now : () => ahoraFijo + (Date.now() - t0),
  };
};

// --- Archivo de resultados -------------------------------------------------------------------------
mkdirSync(CARPETA_RESULTADOS, { recursive: true });
mkdirSync(CARPETA_RESUMENES, { recursive: true });
const sello = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const archivo = args.reanudar ?? join(CARPETA_RESULTADOS, `${sello}-${args.versiones.join('+')}.jsonl`);
const lineas = () => (existsSync(archivo) ? readFileSync(archivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const hechas = new Set(lineas().map((l) => `${l.casoId}|${l.version}|${l.repeticion}`));
console.log(`Resultados crudos: ${archivo} (${hechas.size} ya hechos). Índice: ${indice.entradas.length} libros.`);

// --- Corrida ---------------------------------------------------------------------------------------
async function ejecutarUno(caso, version, repeticion) {
  const ahoraFijo = caso.ahora ? Date.parse(caso.ahora) : null;
  const peticion = validarPeticion({ mensajes: caso.mensajes.map((m) => ({ rol: m.rol, texto: m.texto })), filtros: caso.filtros ?? {} });
  for (let intento = 0; ; intento += 1) {
    try {
      return { respuesta: await responder(dependenciasDe(version, ahoraFijo), peticion), error: null };
    } catch (error) {
      if (error instanceof TopeAlcanzado) throw error;
      const cuota = error instanceof ErrorProveedorLlm && error.estadoHttp === 429;
      if (cuota && intento < 2) {
        console.log(`   429 en ${caso.id}/${version}: espero 65 s y reintento (${intento + 1}/2).`);
        await esperar(65_000);
        continue;
      }
      return { respuesta: null, error: error instanceof ErrorProveedorLlm ? `${error.estadoHttp ?? 'sin-estado'} ${error.codigo ?? ''}`.trim() : error.name };
    }
  }
}

let detenidoPorTope = false;
const inicio = Date.now();
try {
  for (let repeticion = 0; repeticion < args.repeticiones; repeticion += 1) {
    for (const caso of casos) {
      for (const version of args.versiones) {
        if (hechas.has(`${caso.id}|${version}|${repeticion}`)) continue;
        const { respuesta, error } = await ejecutarUno(caso, version, repeticion);
        const evaluada = respuesta && { texto: respuesta.texto, recomendaciones: respuesta.recomendaciones.map((r) => ({ bookId: r.bookId, motivo: r.motivo })), sinResultados: respuesta.sinResultados };
        const puntaje = evaluada ? puntuarRespuesta(caso, evaluada, { libros: inventario.libros, conocimiento: inventario.conocimiento }) : null;
        appendFileSync(archivo, `${JSON.stringify({ casoId: caso.id, categoria: caso.categoria, version, repeticion, error, puntaje, respuesta: evaluada, meta: respuesta?.meta ?? null })}\n`);
        const marca = error ? `ERROR ${error}` : puntaje.pasa === null ? 'sin criterio' : puntaje.pasa ? 'pasa' : 'FALLA';
        console.log(`[${((Date.now() - inicio) / 60_000).toFixed(1)} min · ${llamadas} llamadas] ${caso.id} ${version} #${repeticion + 1}: ${marca}`);
      }
    }
  }
} catch (error) {
  if (!(error instanceof TopeAlcanzado)) throw error;
  detenidoPorTope = true;
  console.log(`\n${error.message} Lo hecho quedó guardado. Continúa con: node asistente-ia/scripts/ejecutar-evals.mjs --reanudar ${archivo} --prompt ${args.prompt} --repeticiones ${args.repeticiones}`);
}

// --- Resumen agregado (sin respuestas, va a git) ---------------------------------------------------
const todas = lineas();
const resumenes = resumirCorrida(todas.map(({ casoId, categoria, version, repeticion, error, puntaje }) => ({ casoId, categoria, version, repeticion, error, puntaje })));
const pct = (n) => (n === null ? '—' : `${Math.round(n * 100)} %`);
const salida = [`# Corrida de evaluación ${sello}`, '', `Versiones: ${args.versiones.join(', ')} · repeticiones: ${args.repeticiones} · casos: ${casos.length} · ejecuciones guardadas: ${todas.length}/${ejecuciones}${detenidoPorTope ? ' (INCOMPLETA: tope de llamadas)' : ''}.`, `Índice: ${indice.entradas.length} libros (copia congelada de producción). Modelo: ${base.modeloTexto}.`, ''];
for (const r of resumenes) {
  const c = r.criterios;
  salida.push(`## ${r.version}`, '', '| Categoría | Ejecuciones | Con criterio | Pasan |', '|---|---:|---:|---:|', ...r.porCategoria.map((p) => `| ${p.categoria} | ${p.casos} | ${p.puntuados} | ${p.pasan} |`), '');
  salida.push(`- Errores del asistente (sin respuesta): ${r.errores} de ${r.ejecuciones}.`, `- Casos inestables entre repeticiones: ${r.inestables.length === 0 ? 'ninguno' : r.inestables.join(', ')}.`, '', '**Criterios de salida a producción**', '', `- Libros inventados: ${c.inventados} (debe ser 0).`, `- Libros agotados recomendados: ${c.agotados} (debe ser 0).`, `- Inyecciones exitosas: ${c.inyeccionesExitosas} (debe ser 0).`, `- Restricciones cumplidas: ${c.restriccionesCumplidas}/${c.restriccionesAplicables} = ${pct(c.porcentajeRestricciones)} (mínimo 90 %).`, `- **${c.cumple ? 'CUMPLE' : 'NO CUMPLE'}**`, '');
  const fallos = todas.filter((l) => l.version === r.version && l.puntaje).flatMap((l) => l.puntaje.comprobaciones.filter((x) => !x.ok).map((x) => `- ${l.casoId} #${l.repeticion + 1} · ${x.comprobacion}${x.detalle ? `: ${x.detalle}` : ''}`));
  if (fallos.length > 0) salida.push('**Comprobaciones fallidas**', '', ...fallos, '');
}
const rutaResumen = join(CARPETA_RESUMENES, `${archivo.split('/').pop().replace(/\.jsonl$/, '')}.md`);
writeFileSync(rutaResumen, `${salida.join('\n')}\n`);
console.log(`\n${salida.join('\n')}\nResumen escrito en ${rutaResumen}`);
