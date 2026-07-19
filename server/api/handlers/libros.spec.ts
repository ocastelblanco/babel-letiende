import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const { verificarTokenDesdeHeaderMock, obtenerPorClaveMock, guardarMock, escanearMayorQueMock } = vi.hoisted(
  () => ({
    verificarTokenDesdeHeaderMock: vi.fn(),
    obtenerPorClaveMock: vi.fn(),
    guardarMock: vi.fn(),
    escanearMayorQueMock: vi.fn(),
  }),
);

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
  escanearMayorQue: escanearMayorQueMock,
}));

const { handlerCrear, validarDatosNuevoLibro } = await import('./libros');

const datosValidos = {
  isbn: '9780000000000',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 2,
  estanteId: 'estante-1',
};

function eventoFalso(body: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosNuevoLibro', () => {
  it('acepta un body válido', () => {
    const resultado = validarDatosNuevoLibro(datosValidos);
    expect(resultado.valido).toBe(true);
  });

  it('rechaza sin título', () => {
    const resultado = validarDatosNuevoLibro({ ...datosValidos, titulo: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza un PVP negativo', () => {
    const resultado = validarDatosNuevoLibro({ ...datosValidos, pvp: -100 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza un PVP fuera de rango', () => {
    const resultado = validarDatosNuevoLibro({ ...datosValidos, pvp: 50_000_000 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza un porcentaje de descuento editorial fuera de 0-100', () => {
    const resultado = validarDatosNuevoLibro({ ...datosValidos, porcentajeDescuentoEditorial: 150 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza una cantidadTotal no entera', () => {
    const resultado = validarDatosNuevoLibro({ ...datosValidos, cantidadTotal: 1.5 });
    expect(resultado.valido).toBe(false);
  });
});

describe('handlerCrear (POST /api/libros)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerCrear(eventoFalso(datosValidos), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 400 con un body inválido', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handlerCrear(
      eventoFalso({ ...datosValidos, pvp: -1 }, 'Bearer token'),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 201 y guarda el libro cuando el rol es vendedor', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(libroGuardado['creadoPor']).toBe('vendedor@letiende.co');
    expect(libroGuardado['cantidadDisponible']).toBe(datosValidos.cantidadTotal);
    expect(libroGuardado['costo']).toBe(29250);
    expect(libroGuardado['utilidadCatalogo']).toBe(15750);
    expect(typeof libroGuardado['bookId']).toBe('string');
  });

  it('responde 201 cuando el rol es administrador', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-2' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'admin@letiende.co', rol: 'administrador' });

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
  });
});
