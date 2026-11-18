#!/usr/bin/env node
/**
 * Ejercita la clase real `ProveedorGemini` (la que usará la Lambda del asistente)
 * contra la API de Gemini, con textos sintéticos. Requiere `npm run build:api`.
 *
 * Comprueba que el cliente funciona de punta a punta, no solo sus pruebas con
 * respuestas simuladas: embeddings en lote, que una consulta parecida puntúe
 * más alto que una distinta (sentido de los vectores) y generación con salida
 * JSON de varios turnos. Solo imprime estados, cifras y claves; nunca la clave.
 */
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { buscarSimilares, cuantizar } from '../../dist-server/api/lib/indice-vectorial.js';

const proveedor = new ProveedorGemini({ claveApi: process.env.GEMINI_API_KEY ?? '' });
let fallos = 0;
const comprobar = (condicion, descripcion) => {
  console.log(`${condicion ? 'OK   ' : 'FALLA'} ${descripcion}`);
  if (!condicion) fallos += 1;
};

// 1. Embeddings y búsqueda
const libros = [
  { titulo: 'El señor de los anillos', texto: 'autor: Tolkien | categorías: Fantasía | sinopsis: Un hobbit emprende un viaje para destruir un anillo mágico y derrotar al señor oscuro.' },
  { titulo: 'Cocina colombiana tradicional', texto: 'autor: Varios | categorías: Cocina | sinopsis: Recetas de ajiaco, sancocho y bandeja paisa para preparar en casa.' },
  { titulo: 'Introducción a la contabilidad', texto: 'autor: Varios | categorías: Negocios | sinopsis: Conceptos básicos de balances, activos y pasivos para pequeñas empresas.' },
];
const docs = await proveedor.incrustarDocumentos(libros);
comprobar(docs.vectores.length === 3, 'un vector por libro');
comprobar(docs.vectores.every((v) => v.length === 768), 'cada vector tiene 768 dimensiones');
comprobar(docs.tokensEntrada > 0, `reporta tokens de entrada (${docs.tokensEntrada})`);

const indice = {
  modelo: proveedor.modeloEmbeddings,
  dimensiones: 768,
  creadoEn: new Date().toISOString(),
  entradas: libros.map((_, i) => ({ bookId: `l${i}`, hash: `h${i}`, sinSinopsis: false, idioma: 'es', clasificacionEdad: null })),
  vectores: docs.vectores.map(cuantizar),
};
for (const [consulta, esperado] of [
  ['quiero una aventura épica con magia y dragones', 'l0'],
  ['cómo preparar sopas y platos típicos del país', 'l1'],
  ['aprender sobre finanzas de un negocio', 'l2'],
]) {
  const q = await proveedor.incrustarConsulta(consulta);
  const top = buscarSimilares(indice, q.vectores[0], { k: 3 });
  comprobar(top[0].bookId === esperado, `«${consulta}» → primero ${top[0].bookId} (esperado ${esperado}; puntaje ${top[0].puntaje.toFixed(2)})`);
}

// 2. Generación con salida JSON y conversación de varios turnos
const esquema = {
  type: 'object',
  properties: {
    texto: { type: 'string' },
    recomendaciones: { type: 'array', items: { type: 'object', properties: { bookId: { type: 'string' }, motivo: { type: 'string' } }, required: ['bookId', 'motivo'] } },
    sinResultados: { type: 'boolean' },
  },
  required: ['texto', 'recomendaciones', 'sinResultados'],
};
const g = await proveedor.generarJson({
  instrucciones: 'Eres un asistente de prueba de una librería. Recomienda solo libros de la lista que recibas. Responde solo con el JSON pedido.',
  mensajes: [
    { rol: 'usuario', texto: 'Busco algo de fantasía.' },
    { rol: 'asistente', texto: '{"texto":"Tengo una opción.","recomendaciones":[],"sinResultados":false}' },
    { rol: 'usuario', texto: 'Dime cuál. Lista: [{"bookId":"l0","titulo":"El señor de los anillos","categorias":["Fantasía"]},{"bookId":"l1","titulo":"Cocina colombiana tradicional","categorias":["Cocina"]}]' },
  ],
  esquemaSalida: esquema,
  maximoTokensSalida: 600,
});
let objeto = null;
try {
  objeto = JSON.parse(g.texto);
} catch {
  // se reporta abajo
}
comprobar(objeto !== null, 'la salida es JSON válido');
comprobar(Array.isArray(objeto?.recomendaciones) && typeof objeto?.sinResultados === 'boolean' && typeof objeto?.texto === 'string', 'respeta el esquema');
comprobar(objeto?.recomendaciones?.[0]?.bookId === 'l0', `recomienda el libro de fantasía (bookId=${objeto?.recomendaciones?.[0]?.bookId})`);
comprobar(g.tokensEntrada > 0 && g.tokensSalida > 0, `reporta uso (entrada ${g.tokensEntrada}, salida ${g.tokensSalida}, pensamiento ${g.tokensPensamiento})`);
comprobar(!g.truncado && !g.bloqueado, 'no está truncada ni bloqueada');

// 3. Tope de tokens muy bajo: debe marcarse como truncada
const corta = await proveedor.generarJson({
  instrucciones: 'Responde solo con el JSON pedido.',
  mensajes: [{ rol: 'usuario', texto: 'Recomiéndame un libro.' }],
  esquemaSalida: esquema,
  maximoTokensSalida: 16,
  nivelPensamiento: 'minimal',
});
comprobar(corta.truncado, 'un tope de tokens muy bajo se marca como truncada');

// 3. Ciclo de herramientas con la clase real (T-0030): pide → se ejecuta → se devuelve → respuesta final con esquema
const herramienta = {
  nombre: 'consultar_disponibilidad',
  descripcion: 'Consulta precio y existencias de libros por su bookId.',
  parametros: { type: 'object', properties: { book_ids: { type: 'array', items: { type: 'string' } } }, required: ['book_ids'] },
};
const esquemaFinal = {
  type: 'object',
  properties: { texto: { type: 'string' }, recomendaciones: { type: 'array', items: { type: 'object', properties: { bookId: { type: 'string' }, motivo: { type: 'string' } }, required: ['bookId', 'motivo'] } }, sinResultados: { type: 'boolean' } },
  required: ['texto', 'recomendaciones', 'sinResultados'],
};
const peticionHerramientas = {
  instrucciones: 'Eres el asistente de una librería. Para precios y existencias usa siempre la herramienta; nunca los inventes. Responde solo con el JSON pedido.',
  mensajes: [{ rol: 'usuario', texto: 'El libro con bookId l-9 se llama «Cien años de soledad». ¿Cuántos quedan y cuánto cuesta?' }],
  esquemaSalida: esquemaFinal,
  maximoTokensSalida: 600,
  herramientas: [herramienta],
};
const vuelta1 = await proveedor.generarJson(peticionHerramientas);
comprobar(vuelta1.llamadas.length === 1 && vuelta1.llamadas[0].nombre === 'consultar_disponibilidad', `el modelo pide la herramienta (${vuelta1.llamadas.map((l) => l.nombre).join(',') || 'ninguna'})`);
comprobar(Boolean(vuelta1.llamadas[0]?.id) && Array.isArray(vuelta1.llamadas[0]?.argumentos?.book_ids), 'la llamada trae id y argumentos como objeto');
comprobar(vuelta1.bloqueado === false, 'una interacción que espera una herramienta no se marca como bloqueada');
comprobar(vuelta1.pasosDelModelo.length >= 2, `devuelve los pasos del modelo para reenviarlos (${vuelta1.pasosDelModelo.length})`);
if (vuelta1.llamadas[0]) {
  const vuelta2 = await proveedor.generarJson({
    ...peticionHerramientas,
    rondas: [{
      pasosDelModelo: vuelta1.pasosDelModelo,
      resultados: [{ llamadaId: vuelta1.llamadas[0].id, nombre: vuelta1.llamadas[0].nombre, contenido: JSON.stringify({ libros: [{ bookId: 'l-9', existe: true, titulo: 'Cien años de soledad', precio: 42000, existencias: 3 }] }) }],
    }],
  });
  comprobar(vuelta2.llamadas.length === 0 && vuelta2.texto !== '', 'con el resultado devuelto, el modelo da la respuesta final');
  let final = null;
  try { final = JSON.parse(vuelta2.texto); } catch { /* se reporta abajo */ }
  comprobar(final !== null && Array.isArray(final.recomendaciones) && typeof final.sinResultados === 'boolean', 'la respuesta final cumple el esquema (herramientas + salida JSON)');
  comprobar(vuelta2.texto.includes('42') , 'la respuesta usa el dato que devolvió la herramienta');
  // Última vuelta sin herramientas, con la historia dentro: lo que hace el orquestador al agotar las rondas.
  const sinTools = await proveedor.generarJson({ ...peticionHerramientas, herramientas: undefined, rondas: [{ pasosDelModelo: vuelta1.pasosDelModelo, resultados: [{ llamadaId: vuelta1.llamadas[0].id, nombre: vuelta1.llamadas[0].nombre, contenido: JSON.stringify({ libros: [{ bookId: 'l-9', existe: true, precio: 42000, existencias: 3 }] }) }] }] });
  comprobar(sinTools.llamadas.length === 0 && sinTools.texto !== '', 'la vuelta final sin herramientas funciona con la historia de la llamada');
}

console.log(fallos === 0 ? '\nTodo en orden.' : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
