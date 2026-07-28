import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Espacio, Mueble } from './tipos';

/**
 * Cliente DynamoDB propio de esta herramienta (no importa `server/`, ver
 * CLAUDE.md de la tarea). Región fija `us-east-1`; usa la cadena de
 * credenciales por defecto del SDK, que en esta máquina resuelve al perfil
 * `default` de `~/.aws/config`.
 */
const clienteBase = new DynamoDBClient({ region: 'us-east-1' });
const documento = DynamoDBDocumentClient.from(clienteBase);

/** Escanea toda la tabla dada, paginando con `LastEvaluatedKey` hasta agotarla. */
async function escanearTablaCompleta<T extends object>(nombreTabla: string): Promise<T[]> {
  const items: T[] = [];
  let claveExclusiva: Record<string, unknown> | undefined;

  do {
    const resultado = await documento.send(
      new ScanCommand({
        TableName: nombreTabla,
        ExclusiveStartKey: claveExclusiva,
      }),
    );
    items.push(...((resultado.Items ?? []) as T[]));
    claveExclusiva = resultado.LastEvaluatedKey;
  } while (claveExclusiva !== undefined);

  return items;
}

export async function obtenerEspacios(stage: string): Promise<Espacio[]> {
  return escanearTablaCompleta<Espacio>(`babel-espacios-${stage}`);
}

export async function obtenerMuebles(stage: string): Promise<Mueble[]> {
  return escanearTablaCompleta<Mueble>(`babel-muebles-${stage}`);
}
