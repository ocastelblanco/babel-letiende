#!/usr/bin/env node
/**
 * Carga en los casos (`asistente-ia/evals/casos/*.json`) las marcas que la persona hizo en
 * `congelado/candidatos.md`: las casillas con `x` y los libros agregados con `+ ISBN` o `+ Título`.
 * Solo escribe `bookId` (datos públicos del catálogo), nunca extractos de sinopsis.
 *
 *   node asistente-ia/scripts/importar-validacion.mjs [--dry-run]
 *   node asistente-ia/scripts/importar-validacion.mjs --complemento [--dry-run]   # suma `congelado/candidatos-complemento.md`
 *                                                                              # a los aceptables que ya existen (no los reemplaza)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerValidaciones, resolverAgregado } from '../../dist-server/api/lib/evaluacion-asistente.js';
import { CARPETA_CASOS, CARPETA_CONGELADO, cargarInventarioCongelado } from './lib-evals.mjs';

const inventario = cargarInventarioCongelado();
const complemento = process.argv.includes('--complemento');
const validaciones = leerValidaciones(readFileSync(join(CARPETA_CONGELADO, complemento ? 'candidatos-complemento.md' : 'candidatos.md'), 'utf8'));
const porCaso = new Map(validaciones.map((v) => [v.casoId, v]));
const sinResolver = [];
const incumplen = [];
let actualizados = 0;
for (const nombre of readdirSync(CARPETA_CASOS).filter((n) => n.endsWith('.json') && n !== 'parches-congelado.json')) {
  const ruta = join(CARPETA_CASOS, nombre);
  const casos = JSON.parse(readFileSync(ruta, 'utf8'));
  let cambio = false;
  for (const caso of casos) {
    const v = porCaso.get(caso.id);
    if (!v || (complemento ? !Array.isArray(caso.aceptables) : caso.aceptables !== null)) continue;
    const antes = new Set(complemento ? caso.aceptables : []);
    const ids = new Set([...antes, ...v.marcados.filter((id) => inventario.libros.has(id))]);
    for (const texto of v.agregados) {
      const encontrados = resolverAgregado(texto, inventario.listaDeLibros);
      if (encontrados.length === 0) sinResolver.push(`${caso.id}: «${texto}»`);
      encontrados.forEach((id) => ids.add(id));
    }
    caso.aceptables = [...ids].sort();
    cambio = true;
    actualizados += 1;
    if (complemento) console.log(`${caso.id}: +${[...ids].filter((id) => !antes.has(id)).length} (ahora ${ids.size} aceptables)`);
    // Un aceptable que incumple el límite de la pregunta no puede ser una buena respuesta: se avisa, no se quita en silencio.
    for (const id of ids) {
      const libro = inventario.libros.get(id);
      const precioMaximo = caso.restricciones?.precioMaximo;
      const idioma = caso.restricciones?.idioma;
      if (precioMaximo !== undefined && libro.pvp > precioMaximo) incumplen.push(`${caso.id}: «${libro.titulo}» cuesta ${libro.pvp} y el límite es ${precioMaximo}`);
      if (idioma !== undefined && inventario.conocimiento.get(id)?.idioma !== idioma) incumplen.push(`${caso.id}: «${libro.titulo}» no está en idioma «${idioma}»`);
    }
    if (caso.aceptables.length === 0) console.log(`Aviso: ${caso.id} quedó sin ningún aceptable; no se puntuará por acierto.`);
  }
  if (cambio && !process.argv.includes('--dry-run')) writeFileSync(ruta, `${JSON.stringify(casos, null, 2)}\n`);
}
console.log(`${actualizados} casos con aceptables cargados${process.argv.includes('--dry-run') ? ' (--dry-run: no se escribió nada)' : ''}.`);
if (sinResolver.length) console.log(`No encontré en el inventario: ${sinResolver.join('; ')}`);
if (incumplen.length) console.log(`Aceptables que incumplen el límite de su pregunta (revisa si de verdad los quieres): ${incumplen.join('; ')}`);
