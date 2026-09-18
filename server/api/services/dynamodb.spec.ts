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

const {
  consultarPorIndice,
  escanearMayorQue,
  escanearProyeccion,
  escanearTodo,
  decrementarPorCantidadSiSuficiente,
  removerAtributo,
  fusionarLibroDuplicado,
} = await import('./dynamodb');

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
        expect(entrada['ProjectionExpression']).toBeUndefined();
      }
    });

    it('sin cuarto parámetro no agrega ProjectionExpression (regresión de retrocompatibilidad)', async () => {
      sendMock.mockResolvedValueOnce({ Items: [{ id: '1', cantidad: 5 }] });

      await escanearMayorQue('tabla-falsa', 'cantidad', 0);

      const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(entrada['ProjectionExpression']).toBeUndefined();
      expect(entrada['ExpressionAttributeNames']).toEqual({ '#atributo': 'cantidad' });
    });

    it('con cuarto parámetro agrega ProjectionExpression/ExpressionAttributeNames sin chocar con el placeholder del FilterExpression', async () => {
      sendMock.mockResolvedValueOnce({ Items: [{ id: '1', cantidad: 5 }] });

      const resultado = await escanearMayorQue('tabla-falsa', 'cantidad', 0, ['id', 'titulo']);

      expect(resultado).toEqual([{ id: '1', cantidad: 5 }]);
      const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(entrada['FilterExpression']).toBe('#atributo > :valor');
      expect(entrada['ProjectionExpression']).toBe('#atributo0, #atributo1');
      expect(entrada['ExpressionAttributeNames']).toEqual({
        '#atributo': 'cantidad',
        '#atributo0': 'id',
        '#atributo1': 'titulo',
      });
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

/**
 * `consultarPorIndice` (`Query` sobre un GSI) — igual que un `Scan`, tiene el
 * mismo límite de ~1 MB por página, así que recorre todas las páginas
 * (`docs/plan-rendimiento-catalogo.md` §3, fase 2: `GET /api/libros` pasa a
 * consultar el GSI disperso `disponible-index` con 1.000+ libros, mismo
 * riesgo que el bug real de producción del 2026-08-19 con `Scan`).
 */
describe('consultarPorIndice', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('con una sola página, no repite la llamada', async () => {
    sendMock.mockResolvedValueOnce({ Items: [{ id: '1' }] });

    const resultado = await consultarPorIndice('tabla-falsa', 'mi-indice', 'clave', 'valor-1');

    expect(resultado).toEqual([{ id: '1' }]);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('agrega los ítems de TODAS las páginas hasta que LastEvaluatedKey deja de venir', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: '1' }, { id: '2' }], LastEvaluatedKey: { id: '2' } })
      .mockResolvedValueOnce({ Items: [{ id: '3' }] });

    const resultado = await consultarPorIndice('tabla-falsa', 'mi-indice', 'clave', 'valor-1');

    expect(resultado).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('pasa el LastEvaluatedKey de una página como ExclusiveStartKey de la siguiente, manteniendo IndexName/KeyConditionExpression', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: '1' }], LastEvaluatedKey: { id: '1' } })
      .mockResolvedValueOnce({ Items: [{ id: '2' }] });

    await consultarPorIndice('tabla-falsa', 'mi-indice', 'clave', 'valor-1');

    const primeraLlamada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    const segundaLlamada = (sendMock.mock.calls[1]?.[0] as { input: Record<string, unknown> }).input;
    expect(primeraLlamada['ExclusiveStartKey']).toBeUndefined();
    expect(segundaLlamada['ExclusiveStartKey']).toEqual({ id: '1' });
    for (const entrada of [primeraLlamada, segundaLlamada]) {
      expect(entrada['IndexName']).toBe('mi-indice');
      expect(entrada['KeyConditionExpression']).toBe('#clave = :valor');
      expect(entrada['ExpressionAttributeValues']).toEqual({ ':valor': 'valor-1' });
    }
  });

  it('sin quinto parámetro no agrega ProjectionExpression (regresión de retrocompatibilidad de isbn-index)', async () => {
    sendMock.mockResolvedValueOnce({ Items: [{ id: '1' }] });

    await consultarPorIndice('tabla-falsa', 'isbn-index', 'isbn', '9780000000000');

    const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(entrada['ProjectionExpression']).toBeUndefined();
    expect(entrada['ExpressionAttributeNames']).toEqual({ '#clave': 'isbn' });
  });

  it('con quinto parámetro agrega ProjectionExpression/ExpressionAttributeNames sin chocar con el placeholder #clave', async () => {
    sendMock.mockResolvedValueOnce({ Items: [{ id: '1' }] });

    const resultado = await consultarPorIndice('tabla-falsa', 'disponible-index', 'disponibleParaCatalogo', 'SI', [
      'bookId',
      'titulo',
    ]);

    expect(resultado).toEqual([{ id: '1' }]);
    const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(entrada['KeyConditionExpression']).toBe('#clave = :valor');
    expect(entrada['ProjectionExpression']).toBe('#atributo0, #atributo1');
    expect(entrada['ExpressionAttributeNames']).toEqual({
      '#clave': 'disponibleParaCatalogo',
      '#atributo0': 'bookId',
      '#atributo1': 'titulo',
    });
  });

  it('mantiene el ProjectionExpression en cada página', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: '1' }], LastEvaluatedKey: { id: '1' } })
      .mockResolvedValueOnce({ Items: [{ id: '2' }] });

    await consultarPorIndice('tabla-falsa', 'disponible-index', 'disponibleParaCatalogo', 'SI', ['bookId']);

    for (const llamada of sendMock.mock.calls) {
      const entrada = (llamada[0] as { input: Record<string, unknown> }).input;
      expect(entrada['ProjectionExpression']).toBe('#atributo0');
    }
  });

  it('una tabla/índice vacío (sin Items) devuelve [] sin lanzar', async () => {
    sendMock.mockResolvedValueOnce({});

    const resultado = await consultarPorIndice('tabla-falsa', 'mi-indice', 'clave', 'valor-1');

    expect(resultado).toEqual([]);
  });
});

/**
 * `disponibleParaCatalogo` (GSI disperso `disponible-index`,
 * `docs/plan-rendimiento-catalogo.md` §3, fase 1): estas pruebas cubren los 3
 * únicos lugares donde `dynamodb.ts` mantiene ese atributo — `decrementarPorCantidadSiSuficiente`
 * (venta), `removerAtributo` (nueva función genérica) y `fusionarLibroDuplicado`.
 */
describe('mantenimiento de disponibleParaCatalogo', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  describe('decrementarPorCantidadSiSuficiente', () => {
    it('envía ReturnValues UPDATED_NEW en el UpdateCommand', async () => {
      sendMock.mockResolvedValueOnce({ Attributes: { cantidadDisponible: 3 } });

      await decrementarPorCantidadSiSuficiente('tabla-falsa', { bookId: 'libro-1' }, 'cantidadDisponible', 1);

      const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(entrada['ReturnValues']).toBe('UPDATED_NEW');
    });

    it('devuelve exito true con el nuevoValor real cuando queda mayor a 0', async () => {
      sendMock.mockResolvedValueOnce({ Attributes: { cantidadDisponible: 3 } });

      const resultado = await decrementarPorCantidadSiSuficiente('tabla-falsa', { bookId: 'libro-1' }, 'cantidadDisponible', 1);

      expect(resultado).toEqual({ exito: true, nuevoValor: 3 });
    });

    it('devuelve exito true con nuevoValor 0 cuando el decremento agota el atributo', async () => {
      sendMock.mockResolvedValueOnce({ Attributes: { cantidadDisponible: 0 } });

      const resultado = await decrementarPorCantidadSiSuficiente('tabla-falsa', { bookId: 'libro-1' }, 'cantidadDisponible', 1);

      expect(resultado).toEqual({ exito: true, nuevoValor: 0 });
    });

    it('devuelve exito false cuando la ConditionExpression falla (sin ejemplares suficientes)', async () => {
      const { ConditionalCheckFailedException } = await import('@aws-sdk/client-dynamodb');
      sendMock.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: 'falló la condición', $metadata: {} }),
      );

      const resultado = await decrementarPorCantidadSiSuficiente('tabla-falsa', { bookId: 'libro-1' }, 'cantidadDisponible', 5);

      expect(resultado).toEqual({ exito: false });
    });
  });

  describe('removerAtributo', () => {
    it('envía un UpdateCommand con UpdateExpression REMOVE sobre el atributo indicado', async () => {
      sendMock.mockResolvedValueOnce({});

      await removerAtributo('tabla-falsa', { bookId: 'libro-1' }, 'disponibleParaCatalogo');

      const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(entrada['UpdateExpression']).toBe('REMOVE #atributo');
      expect(entrada['ExpressionAttributeNames']).toEqual({ '#atributo': 'disponibleParaCatalogo' });
      expect(entrada['Key']).toEqual({ bookId: 'libro-1' });
    });
  });

  describe('fusionarLibroDuplicado', () => {
    const camposFalsos = {
      isbn: '9780000000000',
      titulo: 'Cien años de soledad',
      autor: 'Gabriel García Márquez',
      editorial: 'Sudamericana',
      portadaUrl: null,
      ubicacionId: 'ubicacion-1',
      pvp: 45000,
      porcentajeDescuentoEditorial: 35,
      costo: 29250,
      utilidadCatalogo: 15750,
      actualizadoEn: '2026-09-18T00:00:00.000Z',
    };

    it('incluye disponibleParaCatalogo en el SET del UpdateCommand, de forma incondicional', async () => {
      sendMock.mockResolvedValueOnce({ Attributes: { bookId: 'libro-1' } });

      await fusionarLibroDuplicado('tabla-falsa', 'libro-1', camposFalsos, 2);

      const entrada = (sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(entrada['UpdateExpression']).toContain('#disponibleParaCatalogo = :disponibleParaCatalogo');
      expect((entrada['ExpressionAttributeNames'] as Record<string, string>)['#disponibleParaCatalogo']).toBe(
        'disponibleParaCatalogo',
      );
      expect((entrada['ExpressionAttributeValues'] as Record<string, unknown>)[':disponibleParaCatalogo']).toBe('SI');
    });
  });
});
