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
  consultarPorIndiceMock,
  fusionarLibroDuplicadoMock,
} = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  guardarMock: vi.fn(),
  eliminarMock: vi.fn(),
  escanearMayorQueMock: vi.fn(),
  escanearTodoMock: vi.fn(),
  consultarPorIndiceMock: vi.fn(),
  fusionarLibroDuplicadoMock: vi.fn(),
}));

vi.mock('../lib/verificar-token', async () => {
  const real = await vi.importActual<typeof import('../lib/verificar-token')>('../lib/verificar-token');
  return {
    ...real,
    verificarTokenDesdeHeader: verificarTokenDesdeHeaderMock,
  };
});

// `importActual` conserva la clase real `ItemNoExisteError` — el handler
// hace `error instanceof ItemNoExisteError`, así que necesita la clase real,
// no un mock, para que esa comprobación siga funcionando en las pruebas.
vi.mock('../services/dynamodb', async () => {
  const real = await vi.importActual<typeof import('../services/dynamodb')>('../services/dynamodb');
  return {
    ...real,
    obtenerPorClave: obtenerPorClaveMock,
    guardar: guardarMock,
    eliminar: eliminarMock,
    escanearMayorQue: escanearMayorQueMock,
    escanearTodo: escanearTodoMock,
    consultarPorIndice: consultarPorIndiceMock,
    fusionarLibroDuplicado: fusionarLibroDuplicadoMock,
  };
});

const {
  handlerCrear,
  handlerEditar,
  handlerEliminar,
  handlerInventario,
  handlerExportarInventario,
  handlerDetalle,
  handlerBuscarPorIsbn,
  handlerFusionarDuplicado,
  validarDatosNuevoLibro,
  validarDatosEditarLibro,
  validarDatosFusionarDuplicado,
} = await import('./libros');
const { ItemNoExisteError } = await import('../services/dynamodb');

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

  // GSI `isbn-index` de `babel-libros`: tipa `isbn` como `S` estricto, así
  // que un ítem sin ISBN debe persistirse SIN la clave `isbn` (ausente), no
  // con `isbn: null` — de lo contrario DynamoDB responde `ValidationException`.
  it('cataloga un libro sin isbn: el objeto guardado no tiene la clave isbn, pero la respuesta HTTP sí trae isbn: null', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

    const { isbn: _isbn, ...datosSinIsbn } = datosValidos;

    const respuesta = await handlerCrear(eventoFalso(datosSinIsbn, 'Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 201 });
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(libroGuardado).not.toHaveProperty('isbn');

    const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
    expect(cuerpo['isbn']).toBeNull();
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

    // Mismo criterio que handlerCrear: el GSI `isbn-index` exige que el
    // atributo esté ausente (no `null`) para que el libro quede fuera del
    // índice disperso.
    it('edita quitando el isbn: el objeto guardado no tiene la clave isbn, pero la respuesta HTTP sigue trayendo isbn: null', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(libroFalso);
      obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);

      const { isbn: _isbn, ...datosSinIsbn } = datosEditarValidos;

      const respuesta = await handlerEditar(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosSinIsbn }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const [, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(libroGuardado).not.toHaveProperty('isbn');

      const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
      expect(cuerpo['isbn']).toBeNull();
    });
  });
});

const datosFusionarValidos = {
  isbn: '9780000000001',
  titulo: 'Cien años de soledad (editado)',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://example.com/portada.jpg',
  ubicacionId: 'ubicacion-2',
  pvp: 50000,
  porcentajeDescuentoEditorial: 35,
  ejemplaresNuevos: 2,
};

describe('validarDatosFusionarDuplicado', () => {
  it('acepta un body válido', () => {
    const resultado = validarDatosFusionarDuplicado(datosFusionarValidos);
    expect(resultado.valido).toBe(true);
  });

  it('rechaza sin título', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, titulo: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza sin ubicacionId', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, ubicacionId: '' });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza un PVP fuera de rango', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, pvp: -1 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza ejemplaresNuevos en 0 (a diferencia de cantidadTotal en PUT, aquí nunca puede ser 0: fusionar siempre suma)', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, ejemplaresNuevos: 0 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza ejemplaresNuevos negativo', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, ejemplaresNuevos: -1 });
    expect(resultado.valido).toBe(false);
  });

  it('rechaza ejemplaresNuevos no entero', () => {
    const resultado = validarDatosFusionarDuplicado({ ...datosFusionarValidos, ejemplaresNuevos: 1.5 });
    expect(resultado.valido).toBe(false);
  });

  it('acepta isbn/editorial/portadaUrl ausentes como null', () => {
    const { isbn: _isbn, editorial: _editorial, portadaUrl: _portadaUrl, ...sinOpcionales } = datosFusionarValidos;
    const resultado = validarDatosFusionarDuplicado(sinOpcionales);
    expect(resultado.valido).toBe(true);
    if (resultado.valido) {
      expect(resultado.datos.isbn).toBeNull();
      expect(resultado.datos.editorial).toBeNull();
      expect(resultado.datos.portadaUrl).toBeNull();
    }
  });
});

describe('handlerFusionarDuplicado (POST /api/libros/:bookId/fusionar-duplicado)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_LIBROS'] = 'babel-libros-test';
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
    process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerFusionarDuplicado(
      eventoConBookId({ bookId: 'libro-1', body: datosFusionarValidos }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(fusionarLibroDuplicadoMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios (rol insuficiente)', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handlerFusionarDuplicado(
      eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosFusionarValidos }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(fusionarLibroDuplicadoMock).not.toHaveBeenCalled();
  });

  describe('con un vendedor autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    });

    it('responde 400 con un body inválido', async () => {
      const respuesta = await handlerFusionarDuplicado(
        eventoConBookId({
          authorization: 'Bearer token',
          bookId: 'libro-1',
          body: { ...datosFusionarValidos, ejemplaresNuevos: 0 },
        }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(fusionarLibroDuplicadoMock).not.toHaveBeenCalled();
    });

    it('responde 400 cuando el ubicacionId no existe', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handlerFusionarDuplicado(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosFusionarValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 400 });
      expect(fusionarLibroDuplicadoMock).not.toHaveBeenCalled();
    });

    it('responde 404 cuando el bookId no existe (ConditionExpression de fusionarLibroDuplicado, sin GetItem previo)', async () => {
      obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);
      fusionarLibroDuplicadoMock.mockRejectedValueOnce(new ItemNoExisteError('El libro no existe.'));

      const respuesta = await handlerFusionarDuplicado(
        eventoConBookId({ authorization: 'Bearer token', bookId: 'no-existe', body: datosFusionarValidos }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 404 });
    });

    it(
      'responde 200, NUNCA lee el libro antes de escribir, y llama fusionarLibroDuplicado con el DELTA ' +
        '(ejemplaresNuevos) — nunca un total absoluto calculado en el handler (garantía central del fix de ' +
        'condición de carrera)',
      async () => {
        obtenerPorClaveMock.mockResolvedValueOnce(ubicacionFalsa);
        const libroFusionado = { ...libroFalso, cantidadTotal: 5, cantidadDisponible: 5 };
        fusionarLibroDuplicadoMock.mockResolvedValueOnce(libroFusionado);

        const respuesta = await handlerFusionarDuplicado(
          eventoConBookId({ authorization: 'Bearer token', bookId: 'libro-1', body: datosFusionarValidos }),
          {} as never,
          {} as never,
        );

        expect(respuesta).toMatchObject({ statusCode: 200 });
        const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>;
        // La respuesta es EXACTAMENTE lo que devolvió fusionarLibroDuplicado
        // (ReturnValues: ALL_NEW) — el handler no recalcula ni re-lee nada.
        expect(cuerpo).toEqual(libroFusionado);

        // Solo 2 lecturas puntuales: verificar el rol (babel-usuarios) y
        // validar el ubicacionId (babel-ubicaciones) — CERO lecturas de
        // babel-libros. Leer el libro antes de escribir es exactamente la
        // condición de carrera que este endpoint existe para evitar.
        expect(obtenerPorClaveMock).toHaveBeenCalledTimes(2);
        expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(1, 'babel-usuarios-test', {
          email: 'vendedor@letiende.co',
        });
        expect(obtenerPorClaveMock).toHaveBeenNthCalledWith(2, 'babel-ubicaciones-test', {
          ubicacionId: 'ubicacion-2',
        });

        expect(fusionarLibroDuplicadoMock).toHaveBeenCalledTimes(1);
        const [nombreTabla, bookId, campos, ejemplaresNuevos] = fusionarLibroDuplicadoMock.mock.calls[0] as [
          string,
          string,
          Record<string, unknown>,
          number,
        ];
        expect(nombreTabla).toBe('babel-libros-test');
        expect(bookId).toBe('libro-1');
        // El DELTA tal cual llegó en el body (2) — nunca un total absoluto
        // "existente + nuevo" calculado aquí (eso es lo que causaba la
        // pérdida de ejemplares en escrituras concurrentes).
        expect(ejemplaresNuevos).toBe(2);
        expect(campos['isbn']).toBe('9780000000001');
        expect(campos['titulo']).toBe('Cien años de soledad (editado)');
        expect(campos['autor']).toBe('Gabriel García Márquez');
        expect(campos['editorial']).toBe('Sudamericana');
        expect(campos['portadaUrl']).toBe('https://example.com/portada.jpg');
        expect(campos['ubicacionId']).toBe('ubicacion-2');
        expect(campos['pvp']).toBe(50000);
        expect(campos['porcentajeDescuentoEditorial']).toBe(35);
        expect(campos['costo']).toBe(32500);
        expect(campos['utilidadCatalogo']).toBe(17500);
        // `cantidadTotal`/`cantidadDisponible` NUNCA se calculan en el
        // handler — el incremento atómico (ADD) vive exclusivamente dentro
        // de `fusionarLibroDuplicado`.
        expect(campos).not.toHaveProperty('cantidadTotal');
        expect(campos).not.toHaveProperty('cantidadDisponible');
      },
    );
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

  it('devuelve isbn: null explícito para un libro persistido sin el atributo isbn', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    // Un libro catalogado sin ISBN se guarda con el atributo AUSENTE
    // (`omitirCamposNulos`, GSI `isbn-index` tipado `S`), así que el `Scan` lo
    // devuelve sin la clave — no con `isbn: null`. Regresión de producción
    // 2026-08-29: ese `undefined` llegaba al cliente y reventaba el filtro
    // por título/autor de la pestaña "Editar".
    const libroSinIsbn: Record<string, unknown> = { ...libroFalso, bookId: 'libro-sin-isbn' };
    delete libroSinIsbn['isbn'];
    escanearTodoMock.mockResolvedValue([libroSinIsbn]);

    const respuesta = await handlerInventario(
      eventoConBookId({ authorization: 'Bearer token' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse(respuesta.body as string) as { isbn: string | null }[];
    expect(cuerpo[0]).toHaveProperty('isbn', null);
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

function eventoPorIsbn(opciones: { isbn?: string; authorization?: string } = {}): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    pathParameters: opciones.isbn ? { isbn: opciones.isbn } : undefined,
  } as unknown as APIGatewayProxyEventV2;
}

describe('handlerBuscarPorIsbn (GET /api/libros/por-isbn/:isbn)', () => {
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

    const respuesta = await handlerBuscarPorIsbn(eventoPorIsbn({ isbn: '9780000000000' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(consultarPorIndiceMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'sin-rol@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue(undefined);

    const respuesta = await handlerBuscarPorIsbn(
      eventoPorIsbn({ authorization: 'Bearer token', isbn: '9780000000000' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(consultarPorIndiceMock).not.toHaveBeenCalled();
  });

  describe('con un vendedor autenticado', () => {
    beforeEach(() => {
      verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
      obtenerPorClaveMock.mockResolvedValueOnce({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    });

    it('responde 200 con [] cuando el isbn no tiene coincidencias', async () => {
      consultarPorIndiceMock.mockResolvedValue([]);

      const respuesta = await handlerBuscarPorIsbn(
        eventoPorIsbn({ authorization: 'Bearer token', isbn: '9780000000000' }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const cuerpo = JSON.parse(respuesta.body as string) as unknown[];
      expect(cuerpo).toEqual([]);
      expect(consultarPorIndiceMock).toHaveBeenCalledWith(
        'babel-libros-test',
        'isbn-index',
        'isbn',
        '9780000000000',
      );
    });

    it('responde 200 con 1 LibroConUbicacion cuando hay una sola coincidencia', async () => {
      consultarPorIndiceMock.mockResolvedValue([libroFalso]);
      obtenerPorClaveMock
        .mockResolvedValueOnce(ubicacionFalsa)
        .mockResolvedValueOnce(muebleFalso)
        .mockResolvedValueOnce(espacioFalso);

      const respuesta = await handlerBuscarPorIsbn(
        eventoPorIsbn({ authorization: 'Bearer token', isbn: libroFalso.isbn as string }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>[];
      expect(cuerpo).toHaveLength(1);
      expect(cuerpo[0]?.['bookId']).toBe(libroFalso.bookId);
      expect(cuerpo[0]?.['ubicacion']).toEqual({
        espacio: espacioFalso.nombre,
        mueble: muebleFalso.nombre,
        ubicacion: ubicacionFalsa.nombre,
      });
    });

    it('responde 200 con el arreglo completo cuando hay varias coincidencias', async () => {
      const segundoLibro = { ...libroFalso, bookId: 'libro-2', ubicacionId: ubicacionFalsa.ubicacionId };
      consultarPorIndiceMock.mockResolvedValue([libroFalso, segundoLibro]);
      obtenerPorClaveMock
        .mockResolvedValueOnce(ubicacionFalsa)
        .mockResolvedValueOnce(muebleFalso)
        .mockResolvedValueOnce(espacioFalso)
        .mockResolvedValueOnce(ubicacionFalsa)
        .mockResolvedValueOnce(muebleFalso)
        .mockResolvedValueOnce(espacioFalso);

      const respuesta = await handlerBuscarPorIsbn(
        eventoPorIsbn({ authorization: 'Bearer token', isbn: libroFalso.isbn as string }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>[];
      expect(cuerpo).toHaveLength(2);
      expect(cuerpo.map((libro) => libro['bookId'])).toEqual(['libro-1', 'libro-2']);
    });

    it('devuelve ubicacion: null (sin romper la respuesta) cuando un eslabón de ubicación ya no existe', async () => {
      consultarPorIndiceMock.mockResolvedValue([libroFalso]);
      obtenerPorClaveMock.mockResolvedValueOnce(undefined);

      const respuesta = await handlerBuscarPorIsbn(
        eventoPorIsbn({ authorization: 'Bearer token', isbn: libroFalso.isbn as string }),
        {} as never,
        {} as never,
      );

      expect(respuesta).toMatchObject({ statusCode: 200 });
      const cuerpo = JSON.parse(respuesta.body as string) as Record<string, unknown>[];
      expect(cuerpo[0]?.['ubicacion']).toBeNull();
    });
  });
});
