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

const {
  handlerEspacios,
  handlerMuebles,
  handlerUbicaciones,
  validarDatosEspacio,
  validarDatosMueble,
  validarDatosUbicacion,
} = await import('./ubicacion-fisica');

function eventoFalso(
  metodo: string,
  opciones: { body?: unknown; authorization?: string; parametroRuta?: { nombre: string; valor: string } } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.parametroRuta ? { [opciones.parametroRuta.nombre]: opciones.parametroRuta.valor } : undefined,
    requestContext: { http: { method: metodo } },
  } as unknown as APIGatewayProxyEventV2;
}

const admin = { email: 'admin@letiende.co', rol: 'administrador' };
const vendedor = { email: 'vendedor@letiende.co', rol: 'vendedor' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TABLA_ESPACIOS'] = 'babel-espacios-test';
  process.env['TABLA_MUEBLES'] = 'babel-muebles-test';
  process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
  process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
});

describe('validarDatosEspacio', () => {
  it('acepta un body válido', () => {
    expect(validarDatosEspacio({ nombre: 'Espacio principal' }).valido).toBe(true);
  });

  it('rechaza sin nombre', () => {
    expect(validarDatosEspacio({ nombre: '' }).valido).toBe(false);
  });

  it('rechaza un body que no es un objeto', () => {
    expect(validarDatosEspacio(null).valido).toBe(false);
  });
});

describe('validarDatosMueble', () => {
  it('acepta un body válido', () => {
    expect(validarDatosMueble({ nombre: 'Biblioteca 1', espacioId: 'e1' }).valido).toBe(true);
  });

  it('rechaza sin nombre', () => {
    expect(validarDatosMueble({ nombre: '  ', espacioId: 'e1' }).valido).toBe(false);
  });

  it('rechaza sin espacioId', () => {
    expect(validarDatosMueble({ nombre: 'Biblioteca 1', espacioId: '' }).valido).toBe(false);
  });
});

describe('validarDatosUbicacion', () => {
  it('acepta un body válido', () => {
    expect(validarDatosUbicacion({ nombre: 'Estante 1', muebleId: 'm1' }).valido).toBe(true);
  });

  it('rechaza sin nombre', () => {
    expect(validarDatosUbicacion({ nombre: '', muebleId: 'm1' }).valido).toBe(false);
  });

  it('rechaza sin muebleId', () => {
    expect(validarDatosUbicacion({ nombre: 'Estante 1', muebleId: '  ' }).valido).toBe(false);
  });
});

describe('handlerEspacios (/api/espacios)', () => {
  it('GET responde 200 sin necesitar token (público)', async () => {
    const listaFalsa = [{ espacioId: 'e1', nombre: 'Espacio principal' }];
    escanearTodoMock.mockResolvedValue(listaFalsa);

    const respuesta = await handlerEspacios(eventoFalso('GET'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    expect(verificarTokenDesdeHeaderMock).not.toHaveBeenCalled();
  });

  it('POST responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerEspacios(
      eventoFalso('POST', { body: { nombre: 'Espacio' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 401 });
  });

  it('POST responde 403 para un vendedor', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: vendedor.email, uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(vendedor);

    const respuesta = await handlerEspacios(
      eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Espacio' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  describe('con un administrador autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: admin.email, uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValue(admin);
    });

    it('POST con body inválido responde 400', async () => {
      const respuesta = await handlerEspacios(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: '' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con body válido responde 201 y guarda el espacio', async () => {
      const respuesta = await handlerEspacios(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Espacio principal' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      expect(guardarMock).toHaveBeenCalledTimes(1);
      const [, espacioGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(espacioGuardado['nombre']).toBe('Espacio principal');
      expect(typeof espacioGuardado['espacioId']).toBe('string');
    });

    it('PUT sobre un espacioId inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerEspacios(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Espacio' },
          parametroRuta: { nombre: 'espacioId', valor: 'no-existe' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre un espacioId existente responde 200 y actualiza el espacio', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ espacioId: 'e1', nombre: 'Viejo' });

      const respuesta = await handlerEspacios(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Nuevo nombre' },
          parametroRuta: { nombre: 'espacioId', valor: 'e1' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-espacios-test', { espacioId: 'e1', nombre: 'Nuevo nombre' });
    });

    it('DELETE sobre un espacioId inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerEspacios(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'espacioId', valor: 'no-existe' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE responde 400 cuando hay muebles asociados', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ espacioId: 'e1', nombre: 'Espacio' });
      escanearTodoMock.mockResolvedValue([{ muebleId: 'm1', espacioId: 'e1', nombre: 'Mueble' }]);

      const respuesta = await handlerEspacios(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'espacioId', valor: 'e1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({
        statusCode: 400,
        body: JSON.stringify({ error: 'No se puede eliminar un espacio que tiene muebles asociados.' }),
      });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre un espacioId existente sin muebles asociados responde 204', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ espacioId: 'e1', nombre: 'Espacio' });
      escanearTodoMock.mockResolvedValue([]);

      const respuesta = await handlerEspacios(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'espacioId', valor: 'e1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-espacios-test', { espacioId: 'e1' });
    });
  });
});

describe('handlerMuebles (/api/muebles)', () => {
  it('GET responde 200 sin necesitar token (público)', async () => {
    const listaFalsa = [{ muebleId: 'm1', espacioId: 'e1', nombre: 'Biblioteca 1' }];
    escanearTodoMock.mockResolvedValue(listaFalsa);

    const respuesta = await handlerMuebles(eventoFalso('GET'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    expect(verificarTokenDesdeHeaderMock).not.toHaveBeenCalled();
  });

  it('POST responde 403 para un vendedor', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: vendedor.email, uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(vendedor);

    const respuesta = await handlerMuebles(
      eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Biblioteca 1', espacioId: 'e1' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  describe('con un administrador autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: admin.email, uid: 'uid-1' });
    });

    it('POST responde 400 cuando el espacioId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerMuebles(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Biblioteca 1', espacioId: 'no-existe' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400, body: JSON.stringify({ error: 'El espacio indicado no existe.' }) });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con espacioId existente responde 201 y guarda el mueble', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ espacioId: 'e1', nombre: 'Espacio' });

      const respuesta = await handlerMuebles(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Biblioteca 1', espacioId: 'e1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      const [, muebleGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(muebleGuardado['nombre']).toBe('Biblioteca 1');
      expect(muebleGuardado['espacioId']).toBe('e1');
    });

    it('PUT sobre un muebleId inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerMuebles(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Biblioteca 1', espacioId: 'e1' },
          parametroRuta: { nombre: 'muebleId', valor: 'no-existe' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT permite reasignar espacioId cuando el nuevo existe', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce({ muebleId: 'm1', espacioId: 'e1', nombre: 'Biblioteca 1' })
        .mockResolvedValueOnce({ espacioId: 'e2', nombre: 'Otro espacio' });

      const respuesta = await handlerMuebles(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Biblioteca 1', espacioId: 'e2' },
          parametroRuta: { nombre: 'muebleId', valor: 'm1' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-muebles-test', { muebleId: 'm1', nombre: 'Biblioteca 1', espacioId: 'e2' });
    });

    it('DELETE responde 400 cuando hay ubicaciones asociadas', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ muebleId: 'm1', espacioId: 'e1', nombre: 'Mueble' });
      escanearTodoMock.mockResolvedValue([{ ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' }]);

      const respuesta = await handlerMuebles(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'muebleId', valor: 'm1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({
        statusCode: 400,
        body: JSON.stringify({ error: 'No se puede eliminar un mueble que tiene ubicaciones asociadas.' }),
      });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre un muebleId existente sin ubicaciones asociadas responde 204', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ muebleId: 'm1', espacioId: 'e1', nombre: 'Mueble' });
      escanearTodoMock.mockResolvedValue([]);

      const respuesta = await handlerMuebles(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'muebleId', valor: 'm1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-muebles-test', { muebleId: 'm1' });
    });
  });
});

describe('handlerUbicaciones (/api/ubicaciones)', () => {
  it('GET responde 200 sin necesitar token (público)', async () => {
    const listaFalsa = [{ ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' }];
    escanearTodoMock.mockResolvedValue(listaFalsa);

    const respuesta = await handlerUbicaciones(eventoFalso('GET'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    expect(verificarTokenDesdeHeaderMock).not.toHaveBeenCalled();
  });

  it('POST responde 403 para un vendedor', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: vendedor.email, uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(vendedor);

    const respuesta = await handlerUbicaciones(
      eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Estante 1', muebleId: 'm1' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  describe('con un administrador autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: admin.email, uid: 'uid-1' });
    });

    it('POST responde 400 cuando el muebleId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerUbicaciones(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Estante 1', muebleId: 'no-existe' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400, body: JSON.stringify({ error: 'El mueble indicado no existe.' }) });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con muebleId existente responde 201 y guarda la ubicación', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ muebleId: 'm1', espacioId: 'e1', nombre: 'Mueble' });

      const respuesta = await handlerUbicaciones(
        eventoFalso('POST', { authorization: 'Bearer token', body: { nombre: 'Estante 1', muebleId: 'm1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      const [, ubicacionGuardada] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(ubicacionGuardada['nombre']).toBe('Estante 1');
      expect(ubicacionGuardada['muebleId']).toBe('m1');
    });

    it('PUT sobre un ubicacionId inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerUbicaciones(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Estante 1', muebleId: 'm1' },
          parametroRuta: { nombre: 'ubicacionId', valor: 'no-existe' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT permite reasignar muebleId cuando el nuevo existe', async () => {
      obtenerPorClaveMock
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce({ ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' })
        .mockResolvedValueOnce({ muebleId: 'm2', espacioId: 'e1', nombre: 'Otro mueble' });

      const respuesta = await handlerUbicaciones(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: { nombre: 'Estante 1', muebleId: 'm2' },
          parametroRuta: { nombre: 'ubicacionId', valor: 'u1' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-ubicaciones-test', { ubicacionId: 'u1', nombre: 'Estante 1', muebleId: 'm2' });
    });

    it('DELETE sobre un ubicacionId inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce(undefined);

      const respuesta = await handlerUbicaciones(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'ubicacionId', valor: 'no-existe' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre un ubicacionId existente responde 204 sin restricciones adicionales', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' });

      const respuesta = await handlerUbicaciones(
        eventoFalso('DELETE', { authorization: 'Bearer token', parametroRuta: { nombre: 'ubicacionId', valor: 'u1' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-ubicaciones-test', { ubicacionId: 'u1' });
      expect(escanearTodoMock).not.toHaveBeenCalled();
    });
  });
});
