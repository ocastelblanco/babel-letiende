import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
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
 * Escanea toda la tabla filtrando por un atributo numérico estrictamente
 * mayor que un valor. Un `Scan` recorre toda la tabla (no usa índice), así
 * que solo es aceptable para tablas pequeñas/alcance inicial — ver
 * TODO.md/MEMORY.md sobre filtros más finos como tarea futura.
 */
export async function escanearMayorQue<T extends object>(
  nombreTabla: string,
  nombreAtributo: string,
  valorMinimoExcluido: number,
): Promise<T[]> {
  const resultado = await documento.send(
    new ScanCommand({
      TableName: nombreTabla,
      FilterExpression: '#atributo > :valor',
      ExpressionAttributeNames: { '#atributo': nombreAtributo },
      ExpressionAttributeValues: { ':valor': valorMinimoExcluido },
    }),
  );
  return (resultado.Items ?? []) as T[];
}

/**
 * Escanea toda la tabla sin filtro. Igual que `escanearMayorQue`, solo
 * aceptable para tablas pequeñas (ej. `babel-estantes`, sin `Query`/GSI
 * propio) — ver TODO.md/MEMORY.md sobre filtros más finos como tarea futura.
 */
export async function escanearTodo<T extends object>(nombreTabla: string): Promise<T[]> {
  const resultado = await documento.send(new ScanCommand({ TableName: nombreTabla }));
  return (resultado.Items ?? []) as T[];
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
  try {
    const resultado = await documento.send(
      new UpdateCommand({
        TableName: nombreTabla,
        Key: { bookId },
        ConditionExpression: 'attribute_exists(#bookId)',
        UpdateExpression:
          'SET #isbn = :isbn, #titulo = :titulo, #autor = :autor, #editorial = :editorial, ' +
          '#portadaUrl = :portadaUrl, #ubicacionId = :ubicacionId, #pvp = :pvp, ' +
          '#porcentajeDescuentoEditorial = :porcentajeDescuentoEditorial, #costo = :costo, ' +
          '#utilidadCatalogo = :utilidadCatalogo, #actualizadoEn = :actualizadoEn ' +
          'ADD #cantidadTotal :ejemplaresNuevos, #cantidadDisponible :ejemplaresNuevos',
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
        ExpressionAttributeValues: {
          ':isbn': campos.isbn,
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
        },
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
