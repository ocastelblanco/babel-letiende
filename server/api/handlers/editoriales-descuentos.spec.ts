import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const { verificarTokenDesdeHeaderMock, obtenerPorClaveMock, guardarMock, eliminarMock, escanearTodoMock } =
  vi.hoisted(() => ({
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

const { handler, validarDatosDescuentoEditorial, validarDatosNuevoDescuentoEditorial } = await import(
  './editoriales-descuentos'
);

const datosNuevoValidos = { editorial: 'Sudamericana', porcentajePorDefecto: 35, porcentajesDisponibles: [30, 35, 40] };
const datosActualizacionValidos = { porcentajePorDefecto: 40, porcentajesDisponibles: [40] };

const administradorFalso = { email: 'admin@letiende.co', nombre: 'Admin', fotoUrl: null, rol: 'administrador' };

function eventoFalso(
  metodo: string,
  opciones: { body?: unknown; authorization?: string; editorial?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.editorial ? { editorial: opciones.editorial } : undefined,
    requestContext: { http: { method: metodo } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosDescuentoEditorial', () => {
  it('acepta un body válido', () => {
    expect(validarDatosDescuentoEditorial(datosActualizacionValidos).valido).toBe(true);
  });

  it('rechaza un porcentajePorDefecto fuera de rango', () => {
    expect(validarDatosDescuentoEditorial({ ...datosActualizacionValidos, porcentajePorDefecto: 101 }).valido).toBe(
      false,
    );
  });

  it('rechaza un porcentajesDisponibles con un valor fuera de rango', () => {
    expect(
      validarDatosDescuentoEditorial({ ...datosActualizacionValidos, porcentajesDisponibles: [30, -5] }).valido,
    ).toBe(false);
  });

  it('acepta un porcentajesDisponibles vacío', () => {
    expect(
      validarDatosDescuentoEditorial({ ...datosActualizacionValidos, porcentajesDisponibles: [] }).valido,
    ).toBe(true);
  });

  it('rechaza un body que no es un objeto', () => {
    expect(validarDatosDescuentoEditorial(null).valido).toBe(false);
  });
});

describe('validarDatosNuevoDescuentoEditorial', () => {
  it('acepta un body válido', () => {
    expect(validarDatosNuevoDescuentoEditorial(datosNuevoValidos).valido).toBe(true);
  });

  it('rechaza sin editorial', () => {
    expect(validarDatosNuevoDescuentoEditorial({ ...datosNuevoValidos, editorial: '   ' }).valido).toBe(false);
  });

  it('rechaza un porcentajePorDefecto inválido', () => {
    expect(validarDatosNuevoDescuentoEditorial({ ...datosNuevoValidos, porcentajePorDefecto: -1 }).valido).toBe(
      false,
    );
  });
});

describe('handler (/api/editoriales-descuentos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_EDITORIALES_DESCUENTOS'] = 'babel-editoriales-descuentos-test';
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
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: administradorFalso.email, uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValueOnce(administradorFalso);
    });

    it('GET responde 200 con la lista de descuentos', async () => {
      const listaFalsa = [datosNuevoValidos];
      escanearTodoMock.mockResolvedValue(listaFalsa);

      const respuesta = await handler(eventoFalso('GET', { authorization: 'Bearer token' }), {} as never, {} as never);

      expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    });

    it('POST con body inválido responde 400', async () => {
      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: { ...datosNuevoValidos, porcentajePorDefecto: 200 } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST sobre una editorial que ya existe responde 409', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 409 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con body válido responde 201 y guarda el descuento', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      expect(guardarMock).toHaveBeenCalledWith('babel-editoriales-descuentos-test', datosNuevoValidos);
    });

    it('PUT sobre una editorial inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: datosActualizacionValidos, editorial: 'No existe' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT con body inválido responde 400', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { porcentajePorDefecto: 40, porcentajesDisponibles: ['no-es-numero'] },
          editorial: 'Sudamericana',
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre una editorial existente responde 200 y actualiza', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: datosActualizacionValidos, editorial: 'Sudamericana' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-editoriales-descuentos-test', {
        editorial: 'Sudamericana',
        ...datosActualizacionValidos,
      });
    });

    it('DELETE sobre una editorial inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', editorial: 'No existe' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre una editorial existente responde 204 y elimina', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', editorial: 'Sudamericana' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-editoriales-descuentos-test', { editorial: 'Sudamericana' });
    });
  });
});
