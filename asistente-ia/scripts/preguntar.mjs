#!/usr/bin/env node
/**
 * Preguntas libres al asistente (Fase 6). Corre `responder()` —el mismo código de la Lambda— en este
 * proceso, con la copia congelada del inventario de producción, el índice local y las políticas reales.
 * No toca AWS ni escribe nada en disco: lo único que sale del equipo son las llamadas a Gemini.
 *
 *   node asistente-ia/scripts/preguntar.mjs "Una novela por menos de $30.000"
 *   node asistente-ia/scripts/preguntar.mjs "Algo para leer en vacaciones" --idioma en --precio-maximo 50000
 *   node asistente-ia/scripts/preguntar.mjs --prompt v6 "¿Tienen algo de Kerouac?"
 *   node asistente-ia/scripts/preguntar.mjs                       # modo conversación (varios turnos)
 *
 * Opciones: --prompt v5 · --idioma es · --precio-maximo 30000 · --sin-adultos · --json (salida cruda)
 *
 * Modo conversación (sin pregunta, o con --conversar): cada línea es un turno y el historial se conserva
 * (máximo 9 mensajes, como en el servidor). Comandos: /nueva (empieza otra conversación), /filtros
 * idioma=en precio=30000 adultos=no (cambia los filtros; sin argumentos los muestra), /salir.
 *
 * Requisitos: `npm run build:api`, la copia congelada y el índice local (`construir-indice-evals.mjs`).
 * La clave se lee como en las evaluaciones (`EVALS_CLAVE=production` elige la de producción, de pago;
 * por defecto es la de `staging`, de nivel gratuito: 15 peticiones por minuto).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { ErrorProveedorLlm } from '../../dist-server/api/lib/proveedor-llm.js';
import { responder } from '../../dist-server/api/handlers/asistente.js';
import { cargarPrompt, ErrorPeticion, validarPeticion } from '../../dist-server/api/lib/asistente.js';
import { cargarPoliticas } from '../../dist-server/api/lib/herramientas-asistente.js';
import { deserializarIndice } from '../../dist-server/api/lib/indice-vectorial.js';
import { CARPETA_CONGELADO, cargarInventarioCongelado, leerClaveGemini } from './lib-evals.mjs';

const ARCHIVO_INDICE = join(CARPETA_CONGELADO, 'indice.bin');
const ARCHIVO_CONSULTAS = join(CARPETA_CONGELADO, 'consultas.json');
const MAXIMO_MENSAJES = 9;

// --- Argumentos ------------------------------------------------------------------------------------
function leerArgumentos(argv) {
  const opciones = { prompt: 'v5', filtros: {}, json: false, conversar: false, pregunta: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      if (opciones.pregunta !== null) throw new Error(`Sobra el argumento «${a}». Si la pregunta tiene espacios, ponla entre comillas.`);
      opciones.pregunta = a;
      continue;
    }
    const nombre = a.slice(2);
    if (nombre === 'json') opciones.json = true;
    else if (nombre === 'conversar') opciones.conversar = true;
    else if (nombre === 'sin-adultos') opciones.filtros.excluirContenidoAdulto = true;
    else {
      const valor = argv[++i];
      if (valor === undefined) throw new Error(`Falta el valor de ${a}`);
      if (nombre === 'prompt') opciones.prompt = valor;
      else if (nombre === 'idioma') opciones.filtros.idioma = valor;
      else if (nombre === 'precio-maximo') opciones.filtros.precioMaximo = Number(valor);
      else throw new Error(`Opción desconocida: ${a}`);
    }
  }
  return opciones;
}

let args;
try {
  args = leerArgumentos(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// --- Preparación -----------------------------------------------------------------------------------
if (!existsSync(ARCHIVO_INDICE)) {
  console.error('No hay índice local. Corre primero: node asistente-ia/scripts/construir-indice-evals.mjs');
  process.exit(1);
}
const clave = leerClaveGemini();
if (!clave) {
  console.error('Falta GEMINI_API_KEY (entorno o .env).');
  process.exit(1);
}
const inventario = cargarInventarioCongelado({ conParches: false });
const indice = deserializarIndice(readFileSync(ARCHIVO_INDICE));
const politicas = cargarPoliticas(process.cwd());
const prompt = cargarPrompt(args.prompt, process.cwd());
// Embeddings de consulta ya calculados por las evaluaciones: se leen, nunca se escriben (tus preguntas no se guardan).
const consultasEnCache = existsSync(ARCHIVO_CONSULTAS) ? JSON.parse(readFileSync(ARCHIVO_CONSULTAS, 'utf8')) : {};
const base = new ProveedorGemini({ claveApi: clave, timeoutMs: 30_000, reintentosMaximos: 1 });
const proveedor = {
  nombre: base.nombre,
  modeloTexto: base.modeloTexto,
  modeloEmbeddings: base.modeloEmbeddings,
  incrustarDocumentos: (d) => base.incrustarDocumentos(d),
  incrustarConsulta: async (texto) => (consultasEnCache[texto] ? { vectores: [consultasEnCache[texto]], tokensEntrada: 0 } : base.incrustarConsulta(texto)),
  generarJson: (peticion) => base.generarJson(peticion),
};
const dependencias = () => ({
  proveedor,
  cargarIndice: async () => indice,
  leerLibro: async (bookId) => inventario.libros.get(bookId) ?? null,
  leerConocimiento: async (bookId) => inventario.conocimiento.get(bookId) ?? null,
  leerUbicacion: async (id) => inventario.ubicaciones[id] ?? null,
  politicas,
  prompt,
});

// --- Presentación ----------------------------------------------------------------------------------
const pesos = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

function mostrar(respuesta, filtros) {
  if (args.json) {
    console.log(JSON.stringify(respuesta, null, 2));
    return;
  }
  const { meta } = respuesta;
  console.log(`\n${respuesta.texto}\n`);
  respuesta.recomendaciones.forEach((r, i) => {
    const libro = inventario.conocimiento.get(r.bookId);
    const idioma = libro?.idioma ? ` · idioma ${libro.idioma}` : '';
    console.log(`  ${i + 1}. ${r.titulo} — ${r.autor} · ${pesos(r.pvp)}${idioma}`);
    console.log(`     ${r.motivo}`);
  });
  if (respuesta.recomendaciones.length > 0) console.log('');
  const forzada = meta.busquedaForzada ? ` · búsqueda forzada: ${meta.busquedaForzada}` : '';
  const herramientas = meta.herramientas.length > 0 ? meta.herramientas.join(', ') : 'ninguna';
  const filtrosTexto = Object.keys(filtros).length > 0 ? ` · filtros ${JSON.stringify(filtros)}` : '';
  console.log(`  [prompt ${meta.versionPrompt} · ${meta.modelo} · ${meta.latenciaMs} ms · ${meta.candidatos} candidatos · herramientas: ${herramientas}${forzada} · descartados: ${meta.descartados}${filtrosTexto}]`);
}

/** Una ronda completa; devuelve la respuesta o `null` si falló (el motivo ya se imprimió). */
async function preguntar(mensajes, filtros) {
  try {
    const peticion = validarPeticion({ mensajes, filtros });
    const respuesta = await responder(dependencias(), peticion);
    mostrar(respuesta, filtros);
    return respuesta;
  } catch (error) {
    if (error instanceof ErrorPeticion) console.error(`Petición no válida: ${error.message}`);
    else if (error instanceof ErrorProveedorLlm && error.estadoHttp === 429) console.error('Gemini respondió 429 (cuota). La clave de staging es de nivel gratuito: espera un minuto o usa EVALS_CLAVE=production.');
    else if (error instanceof ErrorProveedorLlm) console.error(`Error del proveedor: ${error.estadoHttp ?? 'sin estado'} ${error.codigo ?? ''}`.trim());
    else console.error(`Error: ${error.name}: ${error.message}`);
    return null;
  }
}

// --- Una pregunta ----------------------------------------------------------------------------------
if (args.pregunta !== null && !args.conversar) {
  const respuesta = await preguntar([{ rol: 'usuario', texto: args.pregunta }], args.filtros);
  process.exit(respuesta ? 0 : 1);
}

// --- Conversación ----------------------------------------------------------------------------------
let filtros = { ...args.filtros };
let mensajes = [];
const leer = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Asistente sobre la copia congelada (${inventario.libros.size} libros, índice de ${indice.entradas.length}). Prompt ${args.prompt}. Comandos: /nueva · /filtros · /salir`);

function cambiarFiltros(texto) {
  const pares = texto.split(/\s+/).filter(Boolean);
  if (pares.length === 0) {
    console.log(`Filtros actuales: ${JSON.stringify(filtros)}`);
    return;
  }
  const nuevos = {};
  for (const par of pares) {
    const [k, v] = par.split('=');
    if (k === 'idioma' && v) nuevos.idioma = v;
    else if (['precio', 'precioMaximo'].includes(k) && Number(v) > 0) nuevos.precioMaximo = Number(v);
    else if (k === 'adultos' && ['no', 'si'].includes(v)) nuevos.excluirContenidoAdulto = v === 'no';
    else if (k === 'ninguno') continue;
    else {
      console.log(`No entiendo «${par}». Ejemplo: /filtros idioma=en precio=30000 adultos=no  (o /filtros ninguno para quitarlos)`);
      return;
    }
  }
  filtros = nuevos;
  console.log(`Filtros: ${JSON.stringify(filtros)}`);
}

/** Procesa un turno o un comando; devuelve `false` para terminar. */
async function turno(texto) {
  const linea = texto.trim();
  if (linea === '') return true;
  if (linea === '/salir') return false;
  if (linea === '/nueva') {
    mensajes = [];
    console.log('Conversación nueva.');
  } else if (linea.startsWith('/filtros')) {
    cambiarFiltros(linea.slice('/filtros'.length));
  } else if (mensajes.length + 1 > MAXIMO_MENSAJES) {
    console.log(`La conversación llegó al máximo de ${MAXIMO_MENSAJES} mensajes (el servidor también lo exige). Usa /nueva.`);
  } else {
    const propuestos = [...mensajes, { rol: 'usuario', texto: linea }];
    const respuesta = await preguntar(propuestos, filtros);
    // Solo se conserva el turno si hubo respuesta; el servidor es sin estado y recibe el historial completo cada vez.
    if (respuesta) mensajes = [...propuestos, { rol: 'asistente', texto: respuesta.texto }];
  }
  return true;
}

const indicador = () => (mensajes.length === 0 ? '\nTú: ' : '\nTú (sigue la conversación): ');
if (args.pregunta !== null && !(await turno(args.pregunta))) process.exit(0);
const mostrarIndicador = () => {
  if (!process.stdin.isTTY) return; // entrada por tubería: sin indicador
  leer.setPrompt(indicador());
  leer.prompt();
};
mostrarIndicador();
// El iterador asíncrono tolera la entrada por tubería (se acaba con ella) y Ctrl+D en la terminal.
for await (const linea of leer) {
  if (!(await turno(linea))) break;
  mostrarIndicador();
}
leer.close();
