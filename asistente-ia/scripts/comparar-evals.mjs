#!/usr/bin/env node
/**
 * Compuerta de la suite de evaluación (Fase 4c, T-0043). Compara el resumen JSON de una corrida contra la
 * línea base y sale con error si el prompt o el modelo empeoran más de la tolerancia. No llama a la API ni
 * necesita la copia congelada: solo lee dos archivos agregados que están en git.
 *
 *   npm run evals:comparar -- asistente-ia/evals/resumenes/<corrida>.json
 *   npm run evals:comparar -- <corrida>.json --version v7           # si la corrida trae varias versiones
 *   npm run evals:comparar -- <corrida>.json --tolerancia-categoria 0.2 --tolerancia-global 0.1
 *   npm run evals:comparar -- <corrida>.json --permitir-casos-distintos
 *
 *   npm run evals:comparar -- --fijar <corrida>.json --version v5 --nota "motivo"   # fija la línea base
 *
 * Códigos de salida: 0 pasa · 1 la compuerta falla · 2 uso o archivo inválido.
 * Reglas y tolerancias: asistente-ia/evals/README.md y bitácora 06 §7.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compararConLineaBase, motivoDeFormatoInvalido, TOLERANCIAS_POR_DEFECTO } from '../../dist-server/api/lib/compuerta-evals.js';

const LINEA_BASE = 'asistente-ia/evals/linea-base.json';

function terminar(codigo, mensaje) {
  (codigo === 0 ? console.log : console.error)(mensaje);
  process.exit(codigo);
}

function leerArgumentos(argv) {
  const o = { archivo: null, fijar: null, version: null, base: LINEA_BASE, nota: null, tolerancias: { ...TOLERANCIAS_POR_DEFECTO } };
  const numero = (nombre, valor) => {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`--${nombre} debe ser un número entre 0 y 1 (0,15 = 15 puntos).`);
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--permitir-casos-distintos') o.tolerancias.permitirCasosDistintos = true;
    else if (!a.startsWith('--')) {
      if (o.archivo) throw new Error(`Argumento inesperado: ${a}`);
      o.archivo = a;
    } else {
      const valor = argv[++i];
      if (valor === undefined) throw new Error(`Falta el valor de ${a}`);
      if (a === '--version') o.version = valor;
      else if (a === '--base') o.base = valor;
      else if (a === '--fijar') o.fijar = valor;
      else if (a === '--nota') o.nota = valor;
      else if (a === '--tolerancia-categoria') o.tolerancias.categoria = numero('tolerancia-categoria', valor);
      else if (a === '--tolerancia-global') o.tolerancias.global = numero('tolerancia-global', valor);
      else if (a === '--max-errores') o.tolerancias.errores = numero('max-errores', valor);
      else throw new Error(`Opción desconocida: ${a}`);
    }
  }
  return o;
}

function leerJson(ruta, tipo) {
  if (!existsSync(ruta)) terminar(2, `No existe ${ruta}.`);
  let valor;
  try {
    valor = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (error) {
    terminar(2, `${ruta} no es JSON válido: ${error.message}`);
  }
  const motivo = motivoDeFormatoInvalido(valor, tipo);
  if (motivo) terminar(2, `${ruta} no sirve como ${tipo === 'resumen' ? 'resumen de corrida' : 'línea base'}: ${motivo}.`);
  return valor;
}

/** Elige la versión del prompt: la única, o la pedida con --version. */
function elegirVersion(resumen, version, ruta) {
  const versiones = resumen.resumenes.map((r) => r.version);
  if (version) {
    const elegido = resumen.resumenes.find((r) => r.version === version);
    if (!elegido) terminar(2, `${ruta} no trae la versión ${version}. Trae: ${versiones.join(', ')}.`);
    return elegido;
  }
  if (versiones.length > 1) terminar(2, `${ruta} trae varias versiones (${versiones.join(', ')}): indica cuál con --version.`);
  return resumen.resumenes[0];
}

let args;
try {
  args = leerArgumentos(process.argv.slice(2));
} catch (error) {
  terminar(2, error.message);
}

// --- Fijar la línea base ---------------------------------------------------------------------------
if (args.fijar) {
  if (!args.nota) terminar(2, 'Fijar una línea base exige --nota con el motivo (queda en el archivo).');
  const resumen = leerJson(args.fijar, 'resumen');
  const elegido = elegirVersion(resumen, args.version, args.fijar);
  if (!elegido.criterios.cumple) terminar(2, `La versión ${elegido.version} no cumple los criterios de salida: no puede ser la línea base.`);
  if (resumen.meta.incompleta) terminar(2, 'La corrida está incompleta: no puede ser la línea base.');
  const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const linea = { formato: 1, referencia: { sello: resumen.meta.sello, version: elegido.version, fijadaEl: hoy, nota: args.nota }, meta: resumen.meta, resumen: elegido };
  writeFileSync(args.base, `${JSON.stringify(linea, null, 2)}\n`);
  terminar(0, `Línea base fijada en ${args.base}: ${elegido.version}, corrida ${resumen.meta.sello}.`);
}

// --- Comparar --------------------------------------------------------------------------------------
if (!args.archivo) terminar(2, 'Uso: npm run evals:comparar -- <resumen.json> [--version vN] [--base <linea-base.json>]');
const base = leerJson(args.base, 'linea-base');
const candidato = leerJson(args.archivo, 'resumen');
const resumen = elegirVersion(candidato, args.version, args.archivo);
const veredicto = compararConLineaBase(base, { meta: candidato.meta, resumen }, args.tolerancias);

const pct = (n) => (n === null ? '—' : `${(n * 100).toFixed(1)} %`);
console.log(`Línea base: ${base.referencia.version}, corrida ${base.referencia.sello} (fijada el ${base.referencia.fijadaEl}).`);
console.log(`Candidato:  ${resumen.version}, corrida ${candidato.meta.sello}, modelo ${candidato.meta.modelo}.`);
console.log(`Aprobación del conjunto: ${pct(veredicto.tasaGlobal.candidato)} (línea base ${pct(veredicto.tasaGlobal.base)}).`);
for (const a of veredicto.avisos) console.log(`  aviso  [${a.regla}] ${a.mensaje}`);
for (const f of veredicto.fallos) console.log(`  FALLA  [${f.regla}] ${f.mensaje}`);
if (veredicto.ok) terminar(0, `\nCOMPUERTA: PASA (${veredicto.avisos.length} aviso(s)).`);
terminar(1, `\nCOMPUERTA: FALLA (${veredicto.fallos.length} regla(s)). No cambies el prompt ni el modelo en producción.`);
