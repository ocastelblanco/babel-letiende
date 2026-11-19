#!/usr/bin/env node
/**
 * Construye el índice de embeddings de la COPIA CONGELADA (con las sinopsis envenenadas de los casos de
 * inyección indirecta) en `asistente-ia/evals/congelado/indice.bin`. Usa el mismo código de producción
 * (`reconstruirIndice`) con un almacén en disco en lugar de S3. Es incremental: si se interrumpe (cuota,
 * red), se vuelve a correr y continúa donde quedó.
 *
 * Mandar sinopsis de libros al nivel gratuito de Gemini es aceptable (texto de catálogo, ningún dato de
 * personas; bitácora 02). Requiere `npm run build:api` y GEMINI_API_KEY (entorno o `.env`).
 *
 *   node asistente-ia/scripts/construir-indice-evals.mjs [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { reconstruirIndice } from '../../dist-server/api/handlers/indice-asistente.js';
import { CARPETA_CONGELADO, cargarInventarioCongelado, leerClaveGemini } from './lib-evals.mjs';

const ARCHIVO = join(CARPETA_CONGELADO, 'indice.bin');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const inventario = cargarInventarioCongelado();
console.log(`Copia congelada: ${inventario.libros.size} libros; sinopsis envenenadas: ${inventario.parchados.length}.`);
if (process.argv.includes('--dry-run')) {
  console.log(`--dry-run: se indexarían hasta ${inventario.libros.size} libros en lotes de 50 (${Math.ceil(inventario.libros.size / 50)} llamadas de embeddings).`);
  process.exit(0);
}
const clave = leerClaveGemini();
if (!clave) {
  console.error('Falta GEMINI_API_KEY (variable de entorno o línea en .env). Es la clave del proyecto de AI Studio de Babel; nunca se imprime.');
  process.exit(1);
}

const almacen = {
  async leer() {
    return existsSync(ARCHIVO) ? { contenido: readFileSync(ARCHIVO), version: String(readFileSync(ARCHIVO).length) } : null;
  },
  async escribir(contenido) {
    writeFileSync(ARCHIVO, contenido);
    return 'ok';
  },
};
const proveedor = new ProveedorGemini({ claveApi: clave });

for (let vuelta = 1; vuelta <= 20; vuelta += 1) {
  const resumen = await reconstruirIndice({
    proveedor,
    almacen,
    dimensiones: 768,
    leerLibros: async () => inventario.listaDeLibros.map((l) => ({ bookId: l.bookId, titulo: l.titulo, autor: l.autor })),
    leerConocimiento: async () => [...inventario.conocimiento.values()],
  });
  console.log(`Vuelta ${vuelta}: indexados ${resumen.indexados}/${resumen.totalLibros}, nuevos ${resumen.nuevos}, conservados ${resumen.conservados}, pendientes ${resumen.pendientes}, parada: ${resumen.motivoParada}, tokens ${resumen.tokensEntrada}.`);
  if (resumen.pendientes === 0) {
    console.log('Índice completo.');
    process.exit(0);
  }
  console.log('Quedaron pendientes (cuota o error del proveedor): espero 60 s y sigo.');
  await esperar(60_000);
}
console.error('No se completó el índice tras 20 vueltas.');
process.exit(1);
