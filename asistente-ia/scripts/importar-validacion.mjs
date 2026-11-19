#!/usr/bin/env node
/**
 * Carga en los casos (`asistente-ia/evals/casos/*.json`) las marcas que la persona hizo en
 * `congelado/candidatos.md`: las casillas con `x` y los libros agregados con `+ ISBN` o `+ Título`.
 * Solo escribe `bookId` (datos públicos del catálogo), nunca extractos de sinopsis.
 *
 *   node asistente-ia/scripts/importar-validacion.mjs [--dry-run]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerValidaciones, resolverAgregado } from '../../dist-server/api/lib/evaluacion-asistente.js';
import { CARPETA_CASOS, CARPETA_CONGELADO, cargarInventarioCongelado } from './lib-evals.mjs';

const inventario = cargarInventarioCongelado();
const validaciones = leerValidaciones(readFileSync(join(CARPETA_CONGELADO, 'candidatos.md'), 'utf8'));
const porCaso = new Map(validaciones.map((v) => [v.casoId, v]));
const sinResolver = [];
let actualizados = 0;
for (const nombre of readdirSync(CARPETA_CASOS).filter((n) => n.endsWith('.json') && n !== 'parches-congelado.json')) {
  const ruta = join(CARPETA_CASOS, nombre);
  const casos = JSON.parse(readFileSync(ruta, 'utf8'));
  let cambio = false;
  for (const caso of casos) {
    const v = porCaso.get(caso.id);
    if (!v || caso.aceptables !== null) continue;
    const ids = new Set(v.marcados.filter((id) => inventario.libros.has(id)));
    for (const texto of v.agregados) {
      const encontrados = resolverAgregado(texto, inventario.listaDeLibros);
      if (encontrados.length === 0) sinResolver.push(`${caso.id}: «${texto}»`);
      encontrados.forEach((id) => ids.add(id));
    }
    caso.aceptables = [...ids].sort();
    cambio = true;
    actualizados += 1;
    if (caso.aceptables.length === 0) console.log(`Aviso: ${caso.id} quedó sin ningún aceptable; no se puntuará por acierto.`);
  }
  if (cambio && !process.argv.includes('--dry-run')) writeFileSync(ruta, `${JSON.stringify(casos, null, 2)}\n`);
}
console.log(`${actualizados} casos con aceptables cargados${process.argv.includes('--dry-run') ? ' (--dry-run: no se escribió nada)' : ''}.`);
if (sinResolver.length) console.log(`No encontré en el inventario: ${sinResolver.join('; ')}`);
