import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const { verificarTokenDesdeHeaderMock, obtenerPorClaveMock, guardarMock, decrementarSiPositivoMock } = vi.hoisted(
  () => ({
    verificarTokenDesdeHeaderMock: vi.fn(),
    obtenerPorClaveMock: vi.fn(),
    guardarMock: vi.fn(),
    decrementarSiPositivoMock: vi.fn(),
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
  decrementarSiPositivo: decrementarSiPositivoMock,
}));

const { handler, validarDatosNuevaVenta } = await import('./ventas');

const datosValidos = { bookId: 'book-1', formaDePago: 'efectivo', porcentajeDescuentoVenta: 0 };

const libroFalso = {
  isbn: '9780000000000',
  bookId: 'book-1',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  costo: 29250,
  utilidadCatalogo: 15750,
  cantidadTotal: 2,
  cantidadDisponible: 1,
  estanteId: 'estante-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
};

function eventoFalso(body: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

describe('validarDatosNuevaVenta', () => {
  it('acepta un body válido', () => {
    expect(validarDatosNuevaVenta(datosValidos).valido).toBe(true);
  });

  it('rechaza sin bookId', () => {
    expect(validarDatosNuevaVenta({ ...datosValidos, bookId: '' }).valido).toBe(false);
  });

  it('rechaza una formaDePago inválida', () => {
    expect(validarDatosNuevaVenta({ ...datosValidos, formaDePago: 'bitcoin' }).valido).toBe(false);
  });

  it('rechaza un porcentajeDescuentoVenta fuera de 0-100', () => {
    expect(validarDatosNuevaVenta({ ...datosValidos, porcentajeDescuentoVenta: 150 }).valido).toBe(false);
  });
});

describe('handler (POST /api/ventas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_VENTAS'] = 'babel-ventas-test';
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handler(eventoFalso(datosValidos), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handler(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 400 con un body inválido', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handler(
      eventoFalso({ ...datosValidos, formaDePago: 'bitcoin' }, 'Bearer token'),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 404 cuando el libro no existe', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock
      .mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' })
      .mockResolvedValueOnce(undefined);

    const respuesta = await handler(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 404 });
    expect(decrementarSiPositivoMock).not.toHaveBeenCalled();
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 400 cuando no quedan ejemplares disponibles', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock
      .mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' })
      .mockResolvedValueOnce(libroFalso);
    decrementarSiPositivoMock.mockResolvedValue(false);

    const respuesta = await handler(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 201 y guarda la venta con el snapshot correcto', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock
      .mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' })
      .mockResolvedValueOnce(libroFalso);
    decrementarSiPositivoMock.mockResolvedValue(true);

    const respuesta = await handler(
      eventoFalso({ ...datosValidos, porcentajeDescuentoVenta: 10 }, 'Bearer token'),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 201 });
    expect(decrementarSiPositivoMock).toHaveBeenCalledWith('babel-libros-test', { bookId: 'book-1' }, 'cantidadDisponible');
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const [, ventaGuardada] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(ventaGuardada['vendidoPor']).toBe('vendedor@letiende.co');
    expect(ventaGuardada['pvp']).toBe(45000);
    expect(ventaGuardada['costoLibro']).toBe(29250);
    expect(ventaGuardada['precioFinal']).toBe(40500);
    expect(ventaGuardada['utilidad']).toBe(11250);
    expect(typeof ventaGuardada['ventaId']).toBe('string');
  });

  it('responde 201 cuando el rol es administrador', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-2' });
    obtenerPorClaveMock
      .mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' })
      .mockResolvedValueOnce(libroFalso);
    decrementarSiPositivoMock.mockResolvedValue(true);

    const respuesta = await handler(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
  });
});
