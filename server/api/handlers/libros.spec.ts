import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const {
  verificarTokenDesdeHeaderMock,
  obtenerPorClaveMock,
  guardarMock,
  eliminarMock,
  escanearMayorQueMock,
  escanearTodoMock,
} = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  guardarMock: vi.fn(),
  eliminarMock: vi.fn(),
  escanearMayorQueMock: vi.fn(),
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
  escanearMayorQue: escanearMayorQueMock,
  escanearTodo: escanearTodoMock,
}));

const {
  handlerCrear,
  handlerEditar,
  handlerEliminar,
  handlerInventario,
  handlerExportarInventario,
  handlerDetalle,
  validarDatosNuevoLibro,
  validarDatosEditarLibro,
} = await import('./libros');

const datosValidos = {
  isbn: '9780000000000',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 2,
  ubicacionId: 'ubicacion-1',
};

function eventoFalso(body: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

function eventoDetalle(bookId?: string): APIGatewayProxyEventV2 {
  return {
    headers: {},
    pathParameters: bookId ? { bookId } : undefined,
  } as unknown as APIGatewayProxyEventV2;
}

function eventoConBookId(
  opciones: { body?: unknown; authorization?: string; bookId?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    pathParameters: opciones.bookId ? { bookId: opciones.bookId } : undefined,
  } as unknown as APIGatewayProxyEventV2;
}

const libroFalso = {
  bookId: 'libro-1',
  isbn: '9780000000000',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  costo: 29250,
  utilidadCatalogo: 15750,
  cantidadTotal: 2,
  cantidadDisponible: 2,
  ubicacionId: 'ubicacion-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
};

const ubicacionFalsa = { ubicacionId: 'ubicacion-2', muebleId: 'mueble-1', nombre: 'Estante 2' };
const muebleFalso = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const espacioFalso = { espacioId: 'espacio-1', nombre: 'Sala principal' };

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
    process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
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

  it('responde 400 cuando el ubicacionId no existe', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    obtenerPorClaveMock.mockResolvedValueOnce(undefined);

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 201 y guarda el libro cuando el rol es vendedor y el ubicacionId es válido', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(libroGuardado['creadoPor']).toBe('vendedor@letiende.co');
    expect(libroGuardado['cantidadDisponible']).toBe(datosValidos.cantidadTotal);
    expect(libroGuardado['costo']).toBe(29250);
    expect(libroGuardado['utilidadCatalogo']).toBe(15750);
    expect(libroGuardado['ubicacionId']).toBe('ubicacion-1');
    expect(typeof libroGuardado['bookId']).toBe('string');
  });

  it('responde 201 cuando el rol es administrador', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-2' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' });
    obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

    const respuesta = await handlerCrear(eventoFalso(datosValidos, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
  });
});

const datosEditarValidos = {
  isbn: '9780000000001',
  titulo: 'Cien años de soledad (editado)',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://example.com/portada.jpg',
  ubicacionId: 'ubicacion-2',
  cantidadTotal: 3,
  pvp: 50000,
  porcentajeDescuentoEditorial: 35,
};

describe('validarDatosEditarLibro', () => {
  it('acepta un body válido', () => {
    const resultado = validarDatosEditarLibro(datosEditarValidos);
    expect(resultado.valido).toBe(true);
  });

  it('acepta cantidadTotal en 0 (a diferencia de validarDatosNuevoLibro)', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, cantidadTotal: 0 });
    expect(resultado.valido).toBe(true);
  });

  it('acepta isbn/editorial/portadaUrl ausentes como null', () => {
    const { isbn: _isbn, editorial: _editorial, portadaUrl: _portadaUrl, ...sinOpcionales } = datosEditarValidos;
    const resultado = validarDatosEditarLibro(sinOpcionales);
    expect(resultado.valido).toBe(true);
    if (resultado.valido) {
      expect(resultado.datos.isbn).toBeNull();
      expect(resultado.datos.editorial).toBeNull();
      expect(resultado.datos.portadaUrl).toBeNull();
    }
  });

  it('rechaza sin título', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, titulo: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza sin autor', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, autor: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza sin ubicacionId', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, ubicacionId: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza un PVP fuera de rango', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, pvp: -1 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza una cantidadTotal negativa', () => {
    const resultado = validarDatosEditarLibro({ ...datosEditarValidos, cantidadTotal: -1 });
    expect(resultado.valido).toBe(false);
  });
});

describe('handlerEditar (PUT /api/libros/:bookId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
    process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerEditar(eventoConBookId({}), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios (rol insuficiente)', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handlerEditar(
      eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosEditarValidos }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  describe('con un vendedor autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    });

    it('responde 404 cuando el bookId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handlerEditar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'no-existe', body: datosEditarValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('responde 400 con un body inválido', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);

      const respuesta = await handlerEditar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: { ...datosEditarValidos, pvp: -1 } }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('responde 400 cuando el ubicacionId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handlerEditar(
        eventoConBookId({
          authorization: 'Bearer token',
          bookId: 'libro-1',
          body: { ...datosEditarValidos, ubicacionId: 'no-existe' },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('responde 200, actualiza ubicación/cantidad/pvp/descuento y recalcula costo/utilidad cuando todo es válido', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);
      obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

      const respuesta = await handlerEditar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosEditarValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      expect(guardarMock).toHaveBeenCalledTimes(1);
      const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(libroGuardado['ubicacionId']).toBe('ubicacion-2');
      expect(libroGuardado['bookId']).toBe('libro-1');
      expect(libroGuardado['cantidadTotal']).toBe(3);
      // libroFalso: cantidadTotal 2, cantidadDisponible 2 → delta +1 → 3.
      expect(libroGuardado['cantidadDisponible']).toBe(3);
      expect(libroGuardado['pvp']).toBe(50000);
      expect(libroGuardado['costo']).toBe(32500);
      expect(libroGuardado['utilidadCatalogo']).toBe(17500);
      expect(libroGuardado['isbn']).toBe('9780000000001');
      expect(libroGuardado['titulo']).toBe('Cien años de soledad (editado)');
      expect(libroGuardado['autor']).toBe('Gabriel García Márquez');
      expect(libroGuardado['editorial']).toBe('Sudamericana');
      expect(libroGuardado['portadaUrl']).toBe('https://example.com/portada.jpg');
      expect(libroGuardado['actualizadoEn']).not.toBe(libroFalso.actualizadoEn);
    });

    it('permite bajar cantidadTotal a 0 y recorta cantidadDisponible a 0', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);
      obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

      const respuesta = await handlerEditar(
        eventoConBookId({
          authorization: 'Bearer token',
          bookId: 'libro-1',
          body: { ...datosEditarValidos, cantidadTotal: 0 },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(libroGuardado['cantidadTotal']).toBe(0);
      expect(libroGuardado['cantidadDisponible']).toBe(0);
    });
  });
});

describe('handlerEliminar (DELETE /api/libros/:bookId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerEliminar(eventoConBookId({ bookId: 'libro-1' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(eliminarMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el rol es vendedor (exige administrador exclusivamente)', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handlerEliminar(
      eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(eliminarMock).not.toHaveBeenCalled();
  });

  describe('con un administrador autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-2' });
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' });
    });

    it('responde 404 cuando el bookId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handlerEliminar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'no-existe' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
      expect(eliminarMock).not.toHaveBeenCalled();
    });

    it('responde 204 y elimina el libro cuando el bookId existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);

      const respuesta = await handlerEliminar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 204 });
      expect(eliminarMock).toHaveBeenCalledWith('babel-libros-test', { bookId: 'libro-1' });
    });
  });
});

describe('handlerInventario (GET /api/libros/inventario)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerInventario(eventoConBookId({}), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(escanearTodoMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handlerInventario(
      eventoConBookId({ authorization: 'Bearer token' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(escanearTodoMock).not.toHaveBeenCalled();
  });

  it('responde 200 con el listado completo (incluidos libros con cantidadDisponible: 0) para un vendedor', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    const libroAgotado = { ...libroFalso, bookId: 'libro-2', cantidadDisponible: 0 };
    escanearTodoMock.mockResolvedValue([libroFalso, libroAgotado]);

    const respuesta = await handlerInventario(
      eventoConBookId({ authorization: 'Bearer token' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as unknown[];
    expect(cuerpo).toHaveLength(2);
    expect(escanearTodoMock).toHaveBeenCalledWith('babel-libros-test');
  });
});

/** Decodifica el `body` base64 de `handlerExportarInventario` a filas planas — mismo patrón que `ventas.spec.ts`, `handlerExportar`. */
function filasDelXlsx(bodyBase64: string): Record<string, unknown>[] {
  const libroExcel = XLSX.read(bodyBase64, { type: 'base64' });
  const hoja = libroExcel.Sheets[libroExcel.SheetNames[0] as string];
  return XLSX.utils.sheet_to_json(hoja as XLSX.WorkSheet);
}

describe('handlerExportarInventario (GET /api/libros/exportar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
    process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
    process.env['TABLA_MUEBLES'] = 'babel-muebles-test';
    process.env['TABLA_ESPACIOS'] = 'babel-espacios-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerExportarInventario(eventoConBookId({}), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(escanearTodoMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el rol es vendedor (exige administrador exclusivamente)', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });

    const respuesta = await handlerExportarInventario(
      eventoConBookId({ authorization: 'Bearer token' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(escanearTodoMock).not.toHaveBeenCalled();
  });

  it('responde 200 con un .xlsx cuyas filas resuelven Espacio/Mueble/Ubicación por nombre', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'admin@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'admin@letiende.co', rol: 'administrador' });
    // `libroFalso.ubicacionId` es 'ubicacion-1' (no 'ubicacion-2', el id de `ubicacionFalsa`) — se usa una
    // ubicación propia que sí resuelve la cadena completa hasta `muebleFalso`/`espacioFalso`.
    const ubicacionDeLibroFalso = { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1' };
    const libroAgotado = {
      ...libroFalso,
      bookId: 'libro-2',
      isbn: null,
      editorial: null,
      cantidadDisponible: 0,
      ubicacionId: 'ubicacion-no-existe',
    };
    escanearTodoMock
      .mockResolvedValueOnce([libroFalso, libroAgotado])
      .mockResolvedValueOnce([ubicacionDeLibroFalso])
      .mockResolvedValueOnce([muebleFalso])
      .mockResolvedValueOnce([espacioFalso]);

    const respuesta = await handlerExportarInventario(
      eventoConBookId({ authorization: 'Bearer token' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="reporte-inventario.xlsx"',
      },
    });
    const filas = filasDelXlsx(respuesta.body as string);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      'Fecha de catalogación': libroFalso.creadoEn,
      ISBN: libroFalso.isbn,
      Título: libroFalso.titulo,
      Autor: libroFalso.autor,
      Editorial: libroFalso.editorial,
      PVP: libroFalso.pvp,
      'Descuento editorial (%)': libroFalso.porcentajeDescuentoEditorial,
      Cantidad: libroFalso.cantidadDisponible,
      Espacio: espacioFalso.nombre,
      Mueble: muebleFalso.nombre,
      Ubicación: ubicacionDeLibroFalso.nombre,
      'Catalogado por': libroFalso.creadoPor,
    });
    // libroAgotado tiene isbn/editorial null y una ubicacionId ('ubicacion-no-existe') que no resuelve — datos inconsistentes, no debe romper el reporte (CLAUDE.md A08).
    expect(filas[1]).toMatchObject({
      ISBN: '—',
      Editorial: '—',
      Espacio: '—',
      Mueble: '—',
      Ubicación: '—',
      // libroAgotado (cantidadDisponible: 0) sigue apareciendo en el reporte con Cantidad 0 — no se excluye como en el catálogo público.
      Cantidad: 0,
    });
  });
});

describe('handlerDetalle (GET /api/libros/:bookId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
    process.env['TABLA_MUEBLES'] = 'babel-muebles-test';
    process.env['TABLA_ESPACIOS'] = 'babel-espacios-test';
  });

  it('responde 400 sin bookId en la ruta', async () => {
    const respuesta = await handlerDetalle(eventoDetalle(), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(obtenerPorClaveMock).not.toHaveBeenCalled();
  });

  it('responde 404 cuando el bookId no existe — sin exigir ningún token (endpoint público)', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce(undefined);

    const respuesta = await handlerDetalle(eventoDetalle('no-existe'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 404 });
    expect(verificarTokenDesdeHeaderMock).not.toHaveBeenCalled();
  });

  it('responde 200 con el libro y su ubicación física resuelta (Espacio → Mueble → Ubicación, 3 GetItem puntuales)', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce(libroFalso)
      .mockResolvedValueOnce(ubicacionFalsa)
      .mockResolvedValueOnce(muebleFalso)
      .mockResolvedValueOnce(espacioFalso);

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['titulo']).toBe(libroFalso.titulo);
    expect(cuerpo['ubicacion']).toEqual({
      espacio: espacioFalso.nombre,
      mueble: muebleFalso.nombre,
      ubicacion: ubicacionFalsa.nombre,
    });
    expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(1, 'babel-libros-test', { bookId: 'libro-1' });
    expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(2, 'babel-ubicaciones-test', {
      ubicacionId: libroFalso.ubicacionId,
    });
    expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(3, 'babel-muebles-test', { muebleId: ubicacionFalsa.muebleId });
    expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(4, 'babel-espacios-test', { espacioId: muebleFalso.espacioId });
  });

  it('responde 200 con ubicacion: null (sin 500) para un libro catalogado antes de la migración a ubicacionId', async () => {
    const { ubicacionId: _ubicacionId, ...libroSinUbicacionId } = libroFalso;
    obtenerPorClaveMock.mockResolvedValueOnce({ ...libroSinUbicacionId, ubicacionId: undefined });

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['ubicacion']).toBeNull();
    expect(obtenerPorClaveMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve ubicacion: null (sin romper la ficha) cuando el ubicacionId ya no existe', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce(libroFalso).mockResolvedValueOnce(undefined);

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['ubicacion']).toBeNull();
  });

  it('devuelve ubicacion: null cuando el mueble referenciado ya no existe', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce(libroFalso)
      .mockResolvedValueOnce(ubicacionFalsa)
      .mockResolvedValueOnce(undefined);

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['ubicacion']).toBeNull();
  });

  it('devuelve ubicacion: null cuando el espacio referenciado ya no existe', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce(libroFalso)
      .mockResolvedValueOnce(ubicacionFalsa)
      .mockResolvedValueOnce(muebleFalso)
      .mockResolvedValueOnce(undefined);

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['ubicacion']).toBeNull();
  });

  it('responde 200 aunque el libro esté agotado (cantidadDisponible: 0) — a diferencia del listado', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce({ ...libroFalso, cantidadDisponible: 0 })
      .mockResolvedValueOnce(ubicacionFalsa)
      .mockResolvedValueOnce(muebleFalso)
      .mockResolvedValueOnce(espacioFalso);

    const respuesta = await handlerDetalle(eventoDetalle('libro-1'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 200 });
  });
});
