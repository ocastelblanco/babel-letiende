import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const {
  verificarTokenDesdeHeaderMock,
  obtenerPorClaveMock,
  guardarMock,
  eliminarMock,
  escanearTodoMock,
} = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  guardarMock: vi.fn(),
  eliminarMock: vi.fn(),
  escanearTodoMock: vi.fn(),
}));

vi.mock('../lib/verificar-token', async () => {
  const real = await vi.importActual<typeof import('../lib/verificar-token')>('../lib/verificar-token');
  return {
    ...real,
    verificarTokenDesdeHeader: verificarTokenDesdeHeaderMock,
  };
});

vi.mock('../services/dynamodb', () => ({
  obtenerPorClave: obtenerPorClaveMock,
  guardar: guardarMock,
  eliminar: eliminarMock,
  escanearTodo: escanearTodoMock,
}));

const { handler, validarDatosEstante } = await import('./estantes');

const datosValidos = { espacio: 'Espacio principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 1' };

function eventoFalso(
  metodo: string,
  opciones: { body?: unknown; authorization?: string; estanteId?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.estanteId ? { estanteId: opciones.estanteId } : undefined,
    requestContext: { http: { method: metodo } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosEstante', () => {
  it('acepta un body válido', () => {
    expect(validarDatosEstante(datosValidos).valido).toBe(true);
  });

  it('rechaza sin espacio', () => {
    expect(validarDatosEstante({ ...datosValidos, espacio: '' }).valido).toBe(false);
  });

  it('rechaza sin mueble', () => {
    expect(validarDatosEstante({ ...datosValidos, mueble: '   ' }).valido).toBe(false);
  });

  it('rechaza un body que no es un objeto', () => {
    expect(validarDatosEstante(null).valido).toBe(false);
  });
});

describe('handler (/api/estantes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_ESTANTES'] = 'babel-estantes-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handler(eventoFalso('GET'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
  });

  it('responde 403 cuando el rol no es administrador', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handler(eventoFalso('GET', { authorization: 'Bearer token' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 403 });
  });

  describe('con un administrador autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValue({ email: 'admin@letiende.co', rol: 'administrador' });
    });

    it('GET responde 200 con la lista de estantes', async () => {
      const listaFalsa = [{ estanteId: 'e1', ...datosValidos }];
      escanearTodoMock.mockResolvedValue(listaFalsa);

      const respuesta = await handler(eventoFalso('GET', { authorization: 'Bearer token' }), {} as never, {} as never);

      expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    });

    it('POST con body inválido responde 400', async () => {
      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: { espacio: '' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con body válido responde 201 y guarda el estante', async () => {
      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      expect(guardarMock).toHaveBeenCalledTimes(1);
      const [, estanteGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(estanteGuardado['espacio']).toBe(datosValidos.espacio);
      expect(typeof estanteGuardado['estanteId']).toBe('string');
    });

    it('PUT sobre un estanteId inexistente responde 404', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' })
        .mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: datosValidos, estanteId: 'no-existe' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre un estanteId existente responde 200 y actualiza el estante', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' })
        .mockResolvedValueOnce({ estanteId: 'e1', ...datosValidos });

      const nuevosDatos = { ...datosValidos, ubicacion: 'Estante 2' };
      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: nuevosDatos, estanteId: 'e1' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-estantes-test', { estanteId: 'e1', ...nuevosDatos });
    });

    it('DELETE sobre un estanteId inexistente responde 404', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' })
        .mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', estanteId: 'no-existe' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre un estanteId existente responde 204 y elimina el estante', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' })
        .mockResolvedValueOnce({ estanteId: 'e1', ...datosValidos });

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', estanteId: 'e1' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-estantes-test', { estanteId: 'e1' });
    });
  });
});
