/**
 * Piezas compartidas por los scripts de la suite de evaluación (Fase 4). Requiere `npm run build:api`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aplicarParches } from '../../dist-server/api/lib/evaluacion-asistente.js';

/** `EVALS_CONGELADO` permite apuntar a otra carpeta (las pruebas de humo usan una copia con datos de mentira). */
export const CARPETA_CONGELADO = process.env.EVALS_CONGELADO ?? 'asistente-ia/evals/congelado';
export const CARPETA_CASOS = 'asistente-ia/evals/casos';

/**
 * La clave se lee del entorno o de `.env` (ignorado por git). Nunca se imprime. El `.env` puede traer
 * varias líneas `GEMINI_API_KEY`, cada una precedida por un comentario con su perfil (`# Staging`,
 * `# Production`); `EVALS_CLAVE=production` elige la de ese perfil. Sin ella se usa `staging` (nivel
 * gratuito) y, si el `.env` no tiene comentarios, la primera línea.
 */
export function leerClaveGemini() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!existsSync('.env')) return '';
  const perfil = (process.env.EVALS_CLAVE ?? 'staging').toLowerCase();
  const claves = [];
  let comentario = '';
  for (const linea of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const nota = /^\s*#\s*(.+?)\s*$/.exec(linea);
    if (nota) comentario = nota[1].toLowerCase();
    if (/^\s*GEMINI_API_KEY\s*=/.test(linea)) {
      claves.push({ perfil: comentario, valor: linea.replace(/^\s*GEMINI_API_KEY\s*=\s*/, '').replace(/^["']|["']\s*$/g, '').trim() });
      comentario = '';
    }
  }
  return (claves.find((c) => c.perfil === perfil) ?? claves[0])?.valor ?? '';
}

const leerJson = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));

export function cargarCasos() {
  const archivos = readdirSync(CARPETA_CASOS).filter((n) => n.endsWith('.json') && n !== 'parches-congelado.json').sort();
  return archivos.flatMap((n) => leerJson(join(CARPETA_CASOS, n)));
}

export function cargarParches() {
  return leerJson(join(CARPETA_CASOS, 'parches-congelado.json'));
}

/**
 * Copia congelada + sinopsis envenenadas de los casos de inyección indirecta. El archivo congelado no se
 * modifica nunca: los parches se aplican en memoria.
 */
export function cargarInventarioCongelado({ conParches = true } = {}) {
  if (!existsSync(join(CARPETA_CONGELADO, 'libros.json'))) {
    throw new Error('No hay copia congelada. Corre primero: node asistente-ia/scripts/congelar-inventario.mjs');
  }
  const libros = leerJson(join(CARPETA_CONGELADO, 'libros.json'));
  const filas = leerJson(join(CARPETA_CONGELADO, 'conocimiento.json'));
  const ubicaciones = leerJson(join(CARPETA_CONGELADO, 'ubicaciones.json'));
  const conocimientoBase = new Map(filas.map((f) => [f.bookId, f]));
  let conocimiento = conocimientoBase;
  let parchados = [];
  if (conParches) {
    ({ conocimiento, parchados } = aplicarParches(libros, conocimientoBase, cargarParches()));
  }
  return {
    libros: new Map(libros.map((l) => [l.bookId, l])),
    listaDeLibros: libros,
    conocimiento,
    ubicaciones,
    parchados,
  };
}
