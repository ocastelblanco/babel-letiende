import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const { verificarTokenDesdeHeaderMock, obtenerPorClaveMock, obtenerMetadatosPorIsbnMock } = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  obtenerMetadatosPorIsbnMock: vi.fn(),
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
}));

vi.mock('../services/api-letiende', () => ({
  obtenerMetadatosPorIsbn: obtenerMetadatosPorIsbnMock,
}));

const { handler } = await import('./metadatos');

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null };
const metadatosEncontrados = {
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://books.google.com/portada.jpg',
};

function eventoFalso(opciones: { authorization?: string; isbn?: string } = {}): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    pathParameters: opciones.isbn ? { isbn: opciones.isbn } : undefined,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('handler (/api/metadatos/:isbn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handler(eventoFalso({ isbn: '9780000000001' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(obtenerMetadatosPorIsbnMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'desconocido@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000001' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(obtenerMetadatosPorIsbnMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el rol no es vendedor ni administrador', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'otro@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'otro@letiende.co', rol: 'invitado' });

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000001' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
  });

  it('responde 400 cuando falta el isbn en la ruta', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handler(eventoFalso({ authorization: 'Bearer token' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
  });

  it('un vendedor responde 200 con los metadatos encontrados', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosEncontrados);

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000001' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(metadatosEncontrados) });
    expect(obtenerMetadatosPorIsbnMock).toHaveBeenCalledWith('9780000000001');
  });

  it('un administrador responde 200 con campos en null cuando no se encuentra nada', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'admin@letiende.co', rol: 'administrador' });
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosVacios);

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '0000000000000' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify(metadatosVacios) });
  });
});
