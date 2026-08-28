import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

/**
 * Cliente DynamoDB único del proceso (tech-specs.md §5.1) y funciones
 * genéricas de acceso a datos, parametrizadas siempre por nombre de tabla —
 * nunca hardcodean una tabla concreta. Los handlers de cada endpoint (fuera
 * del alcance de esta tarea) resuelven el nombre real de tabla desde las
 * variables de entorno que ya declara `serverless.yml` (`TABLA_LIBROS`,
 * `TABLA_VENTAS`, etc.) y se lo pasan a estas funciones.
 */
const clienteBase = new DynamoDBClient({});
const documento = DynamoDBDocumentClient.from(clienteBase);

/** Clave primaria (y, si aplica, de ordenamiento) de un ítem de DynamoDB. */
export type ClaveDynamoDB = Record<string, string>;

export async function obtenerPorClave<T extends object>(
  nombreTabla: string,
  clave: ClaveDynamoDB,
): Promise<T | undefined> {
  const resultado = await documento.send(
    new GetCommand({ TableName: nombreTabla, Key: clave }),
  );
  return resultado.Item as T | undefined;
}

export async function guardar<T extends object>(
  nombreTabla: string,
  item: T,
): Promise<void> {
  await documento.send(new PutCommand({ TableName: nombreTabla, Item: item }));
}

/**
 * Devuelve una COPIA de `item` sin las claves de `campos` cuyo valor sea
 * `null` — nunca muta el original. Necesaria antes de un `PutCommand` sobre
 * cualquier atributo que sea la clave de partición de un índice secundario
 * global disperso (ej. `isbn` en `isbn-index` de `babel-libros`, tipado
 * estrictamente `S`): para que un ítem quede FUERA de ese índice, el
 * atributo debe estar AUSENTE — no vale que esté presente con valor `null`,
 * DynamoDB rechaza ese caso con `ValidationException` por violar el tipo `S`
 * declarado del GSI.
 */
export function omitirCamposNulos<T extends object>(item: T, campos: (keyof T)[]): T {
  const copia = { ...item };
  for (const campo of campos) {
    if (copia[campo] === null) {
      delete copia[campo];
    }
  }
  return copia;
}

export async function eliminar(nombreTabla: string, clave: ClaveDynamoDB): Promise<void> {
  await documento.send(new DeleteCommand({ TableName: nombreTabla, Key: clave }));
}

/** Consulta un índice secundario global por igualdad exacta de su clave de partición. */
export async function consultarPorIndice<T extends object>(
  nombreTabla: string,
  nombreIndice: string,
  nombreAtributoClave: string,
  valorClave: string,
): Promise<T[]> {
  const resultado = await documento.send(
    new QueryCommand({
      TableName: nombreTabla,
      IndexName: nombreIndice,
      KeyConditionExpression: '#clave = :valor',
      ExpressionAttributeNames: { '#clave': nombreAtributoClave },
      ExpressionAttributeValues: { ':valor': valorClave },
    }),
  );
  return (resultado.Items ?? []) as T[];
}

/**
 * Un `Scan` de DynamoDB recorre como máximo ~1 MB de datos por llamada — si
 * la tabla pesa más que eso, la respuesta trae `LastEvaluatedKey` y deja el
 * resto sin recorrer, SIN lanzar ningún error (no es un fallo, es el
 * comportamiento documentado de la API). Las 3 funciones de `Scan` de este
 * archivo (`escanearMayorQue`/`escanearTodo`/`escanearProyeccion`) recorren
 * TODAS las páginas antes de devolver el resultado — encontrado en
 * producción (2026-08-19): con `babel-libros` ya sobre las ~1 MB (2.000+
 * libros), el buscador de la pestaña Editar (`GET /api/libros/inventario`,
 * que usa `escanearTodo`) solo veía una fracción del catálogo real, sin
 * ningún error visible ni en el backend ni en el frontend — `staging`, con
 * muchos menos libros, nunca cruzó ese límite y por eso el bug era invisible
 * ahí. `FilterExpression` (`escanearMayorQue`) se aplica DESPUÉS del límite
 * de 1 MB por página, así que ni siquiera filtrar ayuda a evitar esto.
 */
async function escanearPaginado<T extends object>(
  parametros: Omit<ScanCommandInput, 'ExclusiveStartKey'>,
): Promise<T[]> {
  const items: T[] = [];
  let ultimaClaveEvaluada: Record<string, unknown> | undefined;
  do {
    const resultado = await documento.send(
      new ScanCommand({ ...parametros, ExclusiveStartKey: ultimaClaveEvaluada }),
    );
    items.push(...((resultado.Items ?? []) as T[]));
    ultimaClaveEvaluada = resultado.LastEvaluatedKey;
  } while (ultimaClaveEvaluada !== undefined);
  return items;
}

/**
 * Escanea toda la tabla (todas las páginas, ver `escanearPaginado`)
 * filtrando por un atributo numérico estrictamente mayor que un valor. Un
 * `Scan` recorre toda la tabla (no usa índice), así que solo es aceptable
 * para tablas pequeñas/alcance inicial — ver TODO.md/MEMORY.md sobre
 * filtros más finos como tarea futura.
 */
export async function escanearMayorQue<T extends object>(
  nombreTabla: string,
  nombreAtributo: string,
  valorMinimoExcluido: number,
): Promise<T[]> {
  return escanearPaginado<T>({
    TableName: nombreTabla,
    FilterExpression: '#atributo > :valor',
    ExpressionAttributeNames: { '#atributo': nombreAtributo },
    ExpressionAttributeValues: { ':valor': valorMinimoExcluido },
  });
}

/**
 * Escanea toda la tabla sin filtro (todas las páginas, ver
 * `escanearPaginado`). Igual que `escanearMayorQue`, solo aceptable para
 * tablas pequeñas (ej. `babel-estantes`, sin `Query`/GSI propio) — ver
 * TODO.md/MEMORY.md sobre filtros más finos como tarea futura.
 */
export async function escanearTodo<T extends object>(nombreTabla: string): Promise<T[]> {
  return escanearPaginado<T>({ TableName: nombreTabla });
}

/**
 * Escanea toda la tabla (todas las páginas, ver `escanearPaginado`)
 * trayendo solo los atributos indicados (`ProjectionExpression`) — usado
 * por `babel-validaciones-libros` (`plan-validar-libros-async.md` §4.1): a
 * diferencia de `escanearTodo`, cada ítem de esa tabla puede pesar ~100 KB
 * (`colaBookIds` con miles de `bookId`), y el único propósito de escanearla
 * en `POST /api/validaciones-libros` es detectar si ya hay una corrida
 * `en_progreso` — no hace falta traer la cola completa de cada corrida
 * histórica solo para ese chequeo.
 */
export async function escanearProyeccion<T extends object>(
  nombreTabla: string,
  atributos: (keyof T & string)[],
): Promise<T[]> {
  return escanearPaginado<T>({
    TableName: nombreTabla,
    ProjectionExpression: atributos.map((_, indice) => `#atributo${indice}`).join(', '),
    ExpressionAttributeNames: Object.fromEntries(atributos.map((atributo, indice) => [`#atributo${indice}`, atributo])),
  });
}

/**
 * Decrementa un atributo numérico en `cantidad` solo si su valor actual es
 * mayor o igual a `cantidad` — operación atómica (`ConditionExpression`) para
 * evitar sobrevender si dos ventas del mismo libro llegan casi al mismo
 * tiempo (`POST /api/ventas`, TODO.md Tarea 2: vender más de un ejemplar en
 * una sola `Venta`). Devuelve `false` (sin lanzar) si la condición falla, ya
 * sea porque no quedan suficientes ejemplares o porque el ítem no existe —
 * quien llama decide qué código HTTP corresponde en cada caso.
 */
export async function decrementarPorCantidadSiSuficiente(
  nombreTabla: string,
  clave: ClaveDynamoDB,
  nombreAtributo: string,
  cantidad: number,
): Promise<boolean> {
  try {
    await documento.send(
      new UpdateCommand({
        TableName: nombreTabla,
        Key: clave,
        UpdateExpression: 'SET #atributo = #atributo - :cantidad',
        ConditionExpression: '#atributo >= :cantidad',
        ExpressionAttributeNames: { '#atributo': nombreAtributo },
        ExpressionAttributeValues: { ':cantidad': cantidad },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}

/** Lanzado por `fusionarLibroDuplicado` cuando el `bookId` no existe (`ConditionExpression`) — quien llama decide el código HTTP (típicamente `404`). */
export class ItemNoExisteError extends Error {}

/**
 * Fusiona un duplicado detectado por ISBN sobre un libro ya catalogado
 * (`TODO.md` Tarea 2.3, corrección de condición de carrera): en una única
 * llamada `UpdateCommand` a DynamoDB, FIJA (`SET`) los campos editables
 * normales del libro e INCREMENTA (`ADD`) `cantidadTotal`/`cantidadDisponible`
 * en `ejemplaresNuevos` — nunca lee el ítem antes de escribir. `ADD` es una
 * operación atómica a nivel de ítem garantizada por DynamoDB: si dos
 * vendedores fusionan el mismo duplicado casi al mismo tiempo, ambos
 * incrementos se aplican sin importar el orden de llegada, a diferencia de
 * "leer cantidadTotal actual, sumarle el delta en el cliente/handler, y
 * sobrescribir" (que puede perder el incremento de quien llega primero si el
 * segundo lee un valor ya obsoleto). Lanza `ItemNoExisteError` si el `bookId`
 * no existe.
 */
export async function fusionarLibroDuplicado<T extends object>(
  nombreTabla: string,
  bookId: string,
  campos: {
    isbn: string | null;
    titulo: string;
    autor: string;
    editorial: string | null;
    portadaUrl: string | null;
    ubicacionId: string;
    pvp: number;
    porcentajeDescuentoEditorial: number;
    costo: number;
    utilidadCatalogo: number;
    actualizadoEn: string;
  },
  ejemplaresNuevos: number,
): Promise<T> {
  // `isbn` es la clave de partición del GSI disperso `isbn-index` (tipo `S`
  // estricto, ver `omitirCamposNulos`): el body de
  // `POST /api/libros/:bookId/fusionar-duplicado` permite editar `isbn` igual
  // que `PUT /api/libros/:bookId`, así que también puede llegar `null` aquí.
  // Un `SET #isbn = :isbn` con `:isbn = null` violaría ese tipo `S` (igual
  // que un `PutItem`), así que si el isbn fusionado queda vacío se usa
  // `REMOVE` en vez de `SET` para que el ítem quede FUERA del índice
  // (atributo ausente) en lugar de con `isbn: null`.
  const expressionAttributeValues: Record<string, unknown> = {
    ':titulo': campos.titulo,
    ':autor': campos.autor,
    ':editorial': campos.editorial,
    ':portadaUrl': campos.portadaUrl,
    ':ubicacionId': campos.ubicacionId,
    ':pvp': campos.pvp,
    ':porcentajeDescuentoEditorial': campos.porcentajeDescuentoEditorial,
    ':costo': campos.costo,
    ':utilidadCatalogo': campos.utilidadCatalogo,
    ':actualizadoEn': campos.actualizadoEn,
    ':ejemplaresNuevos': ejemplaresNuevos,
  };
  const asignacionIsbn = campos.isbn === null ? '' : '#isbn = :isbn, ';
  const remocionIsbn = campos.isbn === null ? ' REMOVE #isbn' : '';
  if (campos.isbn !== null) {
    expressionAttributeValues[':isbn'] = campos.isbn;
  }

  try {
    const resultado = await documento.send(
      new UpdateCommand({
        TableName: nombreTabla,
        Key: { bookId },
        ConditionExpression: 'attribute_exists(#bookId)',
        UpdateExpression:
          `SET ${asignacionIsbn}#titulo = :titulo, #autor = :autor, #editorial = :editorial, ` +
          '#portadaUrl = :portadaUrl, #ubicacionId = :ubicacionId, #pvp = :pvp, ' +
          '#porcentajeDescuentoEditorial = :porcentajeDescuentoEditorial, #costo = :costo, ' +
          '#utilidadCatalogo = :utilidadCatalogo, #actualizadoEn = :actualizadoEn ' +
          `ADD #cantidadTotal :ejemplaresNuevos, #cantidadDisponible :ejemplaresNuevos${remocionIsbn}`,
        ExpressionAttributeNames: {
          '#bookId': 'bookId',
          '#isbn': 'isbn',
          '#titulo': 'titulo',
          '#autor': 'autor',
          '#editorial': 'editorial',
          '#portadaUrl': 'portadaUrl',
          '#ubicacionId': 'ubicacionId',
          '#pvp': 'pvp',
          '#porcentajeDescuentoEditorial': 'porcentajeDescuentoEditorial',
          '#costo': 'costo',
          '#utilidadCatalogo': 'utilidadCatalogo',
          '#actualizadoEn': 'actualizadoEn',
          '#cantidadTotal': 'cantidadTotal',
          '#cantidadDisponible': 'cantidadDisponible',
        },
        ExpressionAttributeValues: expressionAttributeValues,
        // `ALL_NEW` devuelve el ítem completo ya actualizado en la misma
        // llamada — evita un `GetItem` adicional (y el permiso IAM que
        // exigiría) solo para reportar el resultado al llamador.
        ReturnValues: 'ALL_NEW',
      }),
    );
    return resultado.Attributes as T;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ItemNoExisteError('El libro no existe.');
    }
    throw error;
  }
}
