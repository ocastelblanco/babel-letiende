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

const { handler, validarDatosNuevoUsuario, validarActualizacionUsuario } = await import('./usuarios');

const datosNuevoValidos = { email: 'nuevo@letiende.co', nombre: 'Usuario Nuevo', rol: 'vendedor' };
const datosActualizacionValidos = { nombre: 'Usuario Actualizado', rol: 'vendedor' };

const administradorFalso = { email: 'admin@letiende.co', nombre: 'Admin', fotoUrl: null, rol: 'administrador' };

function eventoFalso(
  metodo: string,
  opciones: { body?: unknown; authorization?: string; email?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.email ? { email: opciones.email } : undefined,
    requestContext: { http: { method: metodo } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosNuevoUsuario', () => {
  it('acepta un body válido', () => {
    expect(validarDatosNuevoUsuario(datosNuevoValidos).valido).toBe(true);
  });

  it('rechaza un email con formato inválido', () => {
    expect(validarDatosNuevoUsuario({ ...datosNuevoValidos, email: 'no-es-un-email' }).valido).toBe(false);
  });

  it('rechaza sin nombre', () => {
    expect(validarDatosNuevoUsuario({ ...datosNuevoValidos, nombre: '   ' }).valido).toBe(false);
  });

  it('rechaza un rol inválido', () => {
    expect(validarDatosNuevoUsuario({ ...datosNuevoValidos, rol: 'superadmin' }).valido).toBe(false);
  });

  it('rechaza un body que no es un objeto', () => {
    expect(validarDatosNuevoUsuario(null).valido).toBe(false);
  });
});

describe('validarActualizacionUsuario', () => {
  it('acepta un body válido', () => {
    expect(validarActualizacionUsuario(datosActualizacionValidos).valido).toBe(true);
  });

  it('rechaza sin nombre', () => {
    expect(validarActualizacionUsuario({ ...datosActualizacionValidos, nombre: '' }).valido).toBe(false);
  });

  it('rechaza un rol inválido', () => {
    expect(validarActualizacionUsuario({ ...datosActualizacionValidos, rol: 'superadmin' }).valido).toBe(false);
  });
});

describe('handler (/api/usuarios)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    it('GET responde 200 con la lista de usuarios', async () => {
      const listaFalsa = [administradorFalso];
      escanearTodoMock.mockResolvedValue(listaFalsa);

      const respuesta = await handler(eventoFalso('GET', { authorization: 'Bearer token' }), {} as never, {} as never);

      expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    });

    it('POST con body inválido responde 400', async () => {
      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: { ...datosNuevoValidos, email: 'invalido' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST sobre un email que ya existe responde 409', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce({ email: datosNuevoValidos.email, rol: 'vendedor' });

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 409 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con body válido responde 201 y guarda el usuario', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      expect(guardarMock).toHaveBeenCalledTimes(1);
      const [, usuarioGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(usuarioGuardado['email']).toBe(datosNuevoValidos.email);
      expect(usuarioGuardado['fotoUrl']).toBeNull();
      expect(typeof usuarioGuardado['creadoEn']).toBe('string');
    });

    it('PUT sobre un email inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: datosActualizacionValidos, email: 'no-existe@letiende.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT con body inválido responde 400', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'otro@letiende.co', rol: 'vendedor' });

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: { nombre: '', rol: 'vendedor' }, email: 'otro@letiende.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre otro usuario responde 200 y actualiza', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce({
        email: 'otro@letiende.co',
        nombre: 'Otro',
        fotoUrl: null,
        rol: 'administrador',
        creadoEn: '2026-01-01T00:00:00.000Z',
      });

      const respuesta = await handler(
        eventoFalso('PUT', { authorization: 'Bearer token', body: datosActualizacionValidos, email: 'otro@letiende.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith(
        'babel-usuarios-test',
        expect.objectContaining({ email: 'otro@letiende.co', nombre: 'Usuario Actualizado', rol: 'vendedor' }),
      );
    });

    it('PUT sobre el propio email degradándose de administrador responde 400 y no guarda', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(administradorFalso);

      const respuesta = await handler(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: administradorFalso.nombre, rol: 'vendedor' },
          email: administradorFalso.email,
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre el propio email manteniendo el rol administrador responde 200', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(administradorFalso);

      const respuesta = await handler(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Nuevo nombre', rol: 'administrador' },
          email: administradorFalso.email,
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledTimes(1);
    });

    it('DELETE sobre un email inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', email: 'no-existe@letiende.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre otro usuario responde 204 y elimina', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'otro@letiende.co', rol: 'vendedor' });

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', email: 'otro@letiende.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-usuarios-test', { email: 'otro@letiende.co' });
    });

    it('DELETE sobre el propio email responde 400 y no elimina', async () => {
      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', email: administradorFalso.email }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });
  });
});
