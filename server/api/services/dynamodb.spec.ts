import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', async () => {
  const real = await vi.importActual<typeof import('@aws-sdk/client-dynamodb')>('@aws-sdk/client-dynamodb');
  return { ...real, DynamoDBClient: vi.fn() };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const real = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return { ...real, DynamoDBDocumentClient: { from: () => ({ send: sendMock }) } };
});

const { escanearMayorQue, escanearProyeccion, escanearTodo } = await import('./dynamodb');

/**
 * `Scan` de DynamoDB tiene un límite de ~1 MB de datos por página — la
 * respuesta trae `LastEvaluatedKey` cuando queda más por recorrer. Estas
 * pruebas confirman que las 3 funciones de `Scan` de `dynamodb.ts`
 * (`escanearTodo`/`escanearMayorQue`/`escanearProyeccion`) recorren TODAS
 * las páginas antes de devolver el resultado — regresión real encontrada en
 * producción (2026-08-19): con `babel-libros` ya sobre las ~1 MB, el
 * buscador de la pestaña Editar (`GET /api/libros/inventario`) solo veía
 * una fracción del catálogo, sin ningún error visible.
 */
describe('paginación de Scan (escanearTodo / escanearMayorQue / escanearProyeccion)', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  describe('escanearTodo', () => {
    it('con una sola página, no repite la llamada', async () => {
      sendMock.mockResolvedValueOnce({ Items: [{ id: '1' }] });

      const resultado = await escanearTodo('tabla-falsa');

      expect(resultado).toEqual([{ id: '1' }]);
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('agrega los ítems de TODAS las páginas hasta que LastEvaluatedKey deja de venir', async () => {
      sendMock
        .mockResolvedValueOnce({ Items: [{ id: '1' }, { id: '2' }], LastEvaluatedKey: { id: '2' } })
        .mockResolvedValueOnce({ Items: [{ id: '3' }], LastEvaluatedKey: { id: '3' } })
        .mockResolvedValueOnce({ Items: [{ id: '4' }] });

      const resultado = await escanearTodo('tabla-falsa');

      expect(resultado).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]);
      expect(sendMock).toHaveBeenCalledTimes(3);
    });

    it('pasa el LastEvaluatedKey de una página como ExclusiveStartKey de la siguiente', async () => {
      sendMock
        .mockResolvedValueOnce({ Items: [{ id: '1' }], LastEvaluatedKey: { id: '1' } })
        .mockResolvedValueOnce({ Items: [{ id: '2' }] });

      await escanearTodo('tabla-falsa');

      const primeraLlamada = sendMock.mock.calls[0]?.[0] as { input: { ExclusiveStartKey?: unknown } };
      const segundaLlamada = sendMock.mock.calls[1]?.[0] as { input: { ExclusiveStartKey?: unknown } };
      expect(primeraLlamada.input.ExclusiveStartKey).toBeUndefined();
      expect(segundaLlamada.input.ExclusiveStartKey).toEqual({ id: '1' });
    });

    it('una tabla vacía (sin Items) devuelve [] sin lanzar', async () => {
      sendMock.mockResolvedValueOnce({});

      const resultado = await escanearTodo('tabla-falsa');

      expect(resultado).toEqual([]);
    });
  });

  describe('escanearMayorQue', () => {
    it('mantiene el FilterExpression/ExpressionAttributeValues en cada página', async () => {
      sendMock
        .mockResolvedValueOnce({ Items: [{ id: '1', cantidad: 5 }], LastEvaluatedKey: { id: '1' } })
        .mockResolvedValueOnce({ Items: [{ id: '2', cantidad: 3 }] });

      const resultado = await escanearMayorQue('tabla-falsa', 'cantidad', 0);

      expect(resultado).toEqual([
        { id: '1', cantidad: 5 },
        { id: '2', cantidad: 3 },
      ]);
      expect(sendMock).toHaveBeenCalledTimes(2);
      for (const llamada of sendMock.mock.calls) {
        const entrada = (llamada[0] as { input: Record<string, unknown> }).input;
        expect(entrada['FilterExpression']).toBe('#atributo > :valor');
        expect(entrada['ExpressionAttributeValues']).toEqual({ ':valor': 0 });
      }
    });
  });

  describe('escanearProyeccion', () => {
    it('mantiene el ProjectionExpression en cada página', async () => {
      sendMock
        .mockResolvedValueOnce({ Items: [{ id: '1' }], LastEvaluatedKey: { id: '1' } })
        .mockResolvedValueOnce({ Items: [{ id: '2' }] });

      const resultado = await escanearProyeccion('tabla-falsa', ['id']);

      expect(resultado).toEqual([{ id: '1' }, { id: '2' }]);
      expect(sendMock).toHaveBeenCalledTimes(2);
      for (const llamada of sendMock.mock.calls) {
        const entrada = (llamada[0] as { input: Record<string, unknown> }).input;
        expect(entrada['ProjectionExpression']).toBe('#atributo0');
      }
    });
  });
});
