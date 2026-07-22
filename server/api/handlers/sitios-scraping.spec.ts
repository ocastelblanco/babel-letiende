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

const { handler, validarDatosSitioScraping, validarDatosNuevoSitioScraping } = await import('./sitios-scraping');

const datosNuevoValidos = {
  dominio: 'www.librerialerner.com.co',
  nombre: 'Librería Lerner',
  url: 'https://www.librerialerner.com.co',
  info: true,
  pvp: true,
  prioridad: 1,
};
const datosActualizacionValidos = {
  nombre: 'Librería Lerner',
  url: 'https://www.librerialerner.com.co',
  info: true,
  pvp: false,
  prioridad: 2,
};

const administradorFalso = { email: 'admin@letiende.co', nombre: 'Admin', fotoUrl: null, rol: 'administrador' };

function eventoFalso(
  metodo: string,
  opciones: { body?: unknown; authorization?: string; dominio?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.dominio ? { dominio: opciones.dominio } : undefined,
    requestContext: { http: { method: metodo } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosSitioScraping', () => {
  it('acepta un body válido', () => {
    expect(validarDatosSitioScraping(datosActualizacionValidos).valido).toBe(true);
  });

  it('rechaza un nombre vacío', () => {
    expect(validarDatosSitioScraping({ ...datosActualizacionValidos, nombre: '   ' }).valido).toBe(false);
  });

  it('rechaza una url que no empieza con https://', () => {
    expect(
      validarDatosSitioScraping({ ...datosActualizacionValidos, url: 'http://www.librerialerner.com.co' }).valido,
    ).toBe(false);
  });

  it('rechaza cuando info no es booleano', () => {
    expect(validarDatosSitioScraping({ ...datosActualizacionValidos, info: 'true' }).valido).toBe(false);
  });

  it('rechaza cuando pvp no es booleano', () => {
    expect(validarDatosSitioScraping({ ...datosActualizacionValidos, pvp: 'false' }).valido).toBe(false);
  });

  it('rechaza una prioridad no numérica', () => {
    expect(validarDatosSitioScraping({ ...datosActualizacionValidos, prioridad: 'primero' }).valido).toBe(false);
  });

  it('rechaza una prioridad no finita', () => {
    expect(validarDatosSitioScraping({ ...datosActualizacionValidos, prioridad: Infinity }).valido).toBe(false);
  });

  it('rechaza un body que no es un objeto', () => {
    expect(validarDatosSitioScraping(null).valido).toBe(false);
  });
});

describe('validarDatosNuevoSitioScraping', () => {
  it('acepta un body válido', () => {
    expect(validarDatosNuevoSitioScraping(datosNuevoValidos).valido).toBe(true);
  });

  it('rechaza sin dominio', () => {
    expect(validarDatosNuevoSitioScraping({ ...datosNuevoValidos, dominio: '   ' }).valido).toBe(false);
  });

  it('rechaza un dominio con espacios', () => {
    expect(validarDatosNuevoSitioScraping({ ...datosNuevoValidos, dominio: 'www librerialerner com' }).valido).toBe(
      false,
    );
  });

  it('rechaza un dominio con protocolo', () => {
    expect(
      validarDatosNuevoSitioScraping({ ...datosNuevoValidos, dominio: 'https://www.librerialerner.com.co' }).valido,
    ).toBe(false);
  });

  it('rechaza un dominio sin punto', () => {
    expect(validarDatosNuevoSitioScraping({ ...datosNuevoValidos, dominio: 'localhost' }).valido).toBe(false);
  });

  it('rechaza un resto inválido (url sin https)', () => {
    expect(
      validarDatosNuevoSitioScraping({ ...datosNuevoValidos, url: 'http://www.librerialerner.com.co' }).valido,
    ).toBe(false);
  });
});

describe('handler (/api/sitios-scraping)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_SITIOS_SCRAPING'] = 'babel-sitios-scraping-test';
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

    it('GET responde 200 con la lista de sitios', async () => {
      const listaFalsa = [datosNuevoValidos];
      escanearTodoMock.mockResolvedValue(listaFalsa);

      const respuesta = await handler(eventoFalso('GET', { authorization: 'Bearer token' }), {} as never, {} as never);

      expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(listaFalsa) });
    });

    it('POST con body inválido responde 400', async () => {
      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: { ...datosNuevoValidos, url: 'ftp://no-https' } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST sobre un dominio que ya existe responde 409', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 409 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('POST con body válido responde 201 y guarda el sitio', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('POST', { authorization: 'Bearer token', body: datosNuevoValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 201 });
      expect(guardarMock).toHaveBeenCalledWith('babel-sitios-scraping-test', datosNuevoValidos);
    });

    it('PUT sobre un dominio inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: datosActualizacionValidos,
          dominio: 'no-existe.com',
        }),
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
          body: { ...datosActualizacionValidos, prioridad: 'no-es-numero' },
          dominio: 'www.librerialerner.com.co',
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('PUT sobre un dominio existente responde 200 y actualiza', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('PUT', {
          authorization: 'Bearer token',
          body: datosActualizacionValidos,
          dominio: 'www.librerialerner.com.co',
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledWith('babel-sitios-scraping-test', {
        dominio: 'www.librerialerner.com.co',
        ...datosActualizacionValidos,
      });
    });

    it('DELETE sobre un dominio inexistente responde 404', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', dominio: 'no-existe.com' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('DELETE sobre un dominio existente responde 204 y elimina', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(datosNuevoValidos);

      const respuesta = await handler(
        eventoFalso('DELETE', { authorization: 'Bearer token', dominio: 'www.librerialerner.com.co' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-sitios-scraping-test', { dominio: 'www.librerialerner.com.co' });
    });
  });
});
