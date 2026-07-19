import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
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
