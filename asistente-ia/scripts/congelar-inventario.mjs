#!/usr/bin/env node
/**
 * Congela una copia del inventario de PRODUCCIÓN para la suite de evaluación (Fase 4, T-0041).
 *
 * - SOLO LECTURA: únicamente `Scan` paginado a mano (un `Scan` sin paginar se corta en 1.000 sin avisar).
 * - LISTA BLANCA en la propia petición (`ProjectionExpression`): `costo`, `utilidadCatalogo`,
 *   `porcentajeDescuentoEditorial`, `creadoPor` y demás datos internos NUNCA salen de AWS.
 * - El destino (`asistente-ia/evals/congelado/`) está en `.gitignore`: contiene sinopsis de terceros
 *   (ADR-018) y no se versiona. Solo el manifiesto (conteos) se puede citar en la bitácora.
 *
 * Usa el perfil de AWS por defecto de tu máquina (región us-east-1). Uso: node asistente-ia/scripts/congelar-inventario.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const ETAPA = process.env.ETAPA_CONGELAR ?? 'production';
const DESTINO = 'asistente-ia/evals/congelado';
const cliente = new DynamoDBClient({ region: 'us-east-1' });

async function escanear(tabla, campos) {
  const nombres = {};
  const proyeccion = campos.map((campo, i) => { nombres[`#c${i}`] = campo; return `#c${i}`; }).join(',');
  const filas = [];
  let clave;
  do {
    const respuesta = await cliente.send(new ScanCommand({
      TableName: `${tabla}-${ETAPA}`,
      ProjectionExpression: proyeccion,
      ExpressionAttributeNames: nombres,
      ExclusiveStartKey: clave,
    }));
    filas.push(...(respuesta.Items ?? []).map((item) => unmarshall(item)));
    clave = respuesta.LastEvaluatedKey;
  } while (clave);
  return filas;
}

const libros = await escanear('babel-libros', ['bookId', 'isbn', 'titulo', 'autor', 'portadaUrl', 'pvp', 'cantidadDisponible', 'ubicacionId']);
const conocimiento = await escanear('babel-libros-conocimiento', ['bookId', 'sinopsis', 'categorias', 'idioma', 'clasificacionEdad', 'paginas']);
const ubicaciones = await escanear('babel-ubicaciones', ['ubicacionId', 'nombre', 'muebleId']);
const muebles = await escanear('babel-muebles', ['muebleId', 'nombre', 'espacioId']);
const espacios = await escanear('babel-espacios', ['espacioId', 'nombre']);

const muebleDe = new Map(muebles.map((m) => [m.muebleId, m]));
const espacioDe = new Map(espacios.map((e) => [e.espacioId, e]));
const ubicacionesResueltas = {};
for (const u of ubicaciones) {
  const mueble = muebleDe.get(u.muebleId);
  const espacio = mueble ? espacioDe.get(mueble.espacioId) : undefined;
  if (mueble && espacio) ubicacionesResueltas[u.ubicacionId] = { espacio: espacio.nombre, mueble: mueble.nombre, ubicacion: u.nombre };
}

const conSinopsis = conocimiento.filter((k) => (k.sinopsis ?? '').trim().length >= 200).length;
const manifiesto = {
  congeladoEn: new Date().toISOString(),
  etapa: ETAPA,
  libros: libros.length,
  librosConExistencias: libros.filter((l) => (l.cantidadDisponible ?? 0) > 0).length,
  conocimiento: conocimiento.length,
  conSinopsisUtil: conSinopsis,
  ubicaciones: Object.keys(ubicacionesResueltas).length,
};
mkdirSync(DESTINO, { recursive: true });
writeFileSync(`${DESTINO}/libros.json`, JSON.stringify(libros));
writeFileSync(`${DESTINO}/conocimiento.json`, JSON.stringify(conocimiento));
writeFileSync(`${DESTINO}/ubicaciones.json`, JSON.stringify(ubicacionesResueltas));
writeFileSync(`${DESTINO}/manifiesto.json`, JSON.stringify(manifiesto, null, 2));
console.log(manifiesto);
