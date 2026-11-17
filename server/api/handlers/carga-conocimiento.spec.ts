import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';

const { verificarTokenMock, escanearProyeccionMock, guardarMock, obtenerPorClaveMock, resolverMock, lambdaSendMock } = vi.hoisted(
  () => ({
    verificarTokenMock: vi.fn(),
    escanearProyeccionMock: vi.fn(),
    guardarMock: vi.fn(),
    obtenerPorClaveMock: vi.fn(),
    resolverMock: vi.fn(),
    lambdaSendMock: vi.fn(),
  }),
);

vi.mock('../lib/verificar-token', async () => {
  const real = await vi.importActual<typeof import('../lib/verificar-token')>('../lib/verificar-token');
  return { ...real, verificarTokenDesdeHeader: verificarTokenMock };
});
vi.mock('../services/dynamodb', () => ({
  escanearProyeccion: escanearProyeccionMock,
  guardar: guardarMock,
  obtenerPorClave: obtenerPorClaveMock,
}));
vi.mock('./metadatos', () => ({ resolverMetadatosCompletos: resolverMock }));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = lambdaSendMock;
  },
  InvokeCommand: class {
    constructor(input: unknown) {
      Object.assign(this, input as object);
    }
  },
}));

const { handlerIniciar, handlerWorker, handlerConsultar, acumularResultado, combinarConocimiento, procesarLibro } =
  await import('./carga-conocimiento');
type Carga = Parameters<typeof acumularResultado>[0];

const ADMIN = { email: 'admin@letiende.co', uid: 'u' };
const SINOPSIS_UTIL = 'x'.repeat(250);

function evento(extra: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return { headers: { authorization: 'Bearer t' }, ...extra } as unknown as APIGatewayProxyEventV2;
}

function cargaBase(datos: Partial<Carga> = {}): Carga {
  return {
    cargaId: 'c-1',
    estado: 'en_progreso',
    iniciadoPor: ADMIN.email,
    iniciadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
    colaBookIds: ['a', 'b'],
    indiceActual: 0,
    totalLibros: 2,
    librosRevisados: 0,
    guardados: 0,
    yaTenian: 0,
    sinIsbn: 0,
    sinDatos: 0,
    errores: 0,
    conSinopsisUtil: 0,
    conSinopsisCorta: 0,
    sinSinopsis: 0,
    porIdioma: {},
    porFuente: {},
    ...datos,
  };
}

function conocimiento(datos: Record<string, unknown> = {}) {
  return {
    bookId: 'a',
    sinopsis: SINOPSIS_UTIL,
    categorias: ['Fantasía'],
    idioma: 'es',
    paginas: 100,
    clasificacionEdad: null,
    fuenteSinopsis: 'sitio:tornamesa.co',
    actualizadoEn: '2026-11-17T00:00:00.000Z',
    ...datos,
  };
}

function metadatos(datos: Record<string, unknown> = {}) {
  return {
    titulo: 'T',
    autor: 'A',
    editorial: null,
    portadaUrl: null,
    pvp: null,
    sinopsis: SINOPSIS_UTIL,
    categorias: ['Fantasía'],
    idioma: 'es',
    paginas: 100,
    clasificacionEdad: null,
    fuenteSinopsis: 'google-books',
    ...datos,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TABLA_LIBROS'] = 'libros';
  process.env['TABLA_CONOCIMIENTO'] = 'conocimiento';
  process.env['TABLA_USUARIOS'] = 'usuarios';
  process.env['TABLA_CARGA_CONOCIMIENTO'] = 'cargas';
  process.env['NOMBRE_FUNCION_WORKER'] = 'worker';
  verificarTokenMock.mockResolvedValue(ADMIN);
});

describe('acumularResultado', () => {
  it('clasifica por utilidad, idioma y fuente sin guardar texto', () => {
    let carga = cargaBase();
    carga = acumularResultado(carga, { tipo: 'guardado', conocimiento: conocimiento() });
    carga = acumularResultado(carga, {
      tipo: 'guardado',
      conocimiento: conocimiento({ sinopsis: 'corta', idioma: 'en', fuenteSinopsis: 'google-books' }),
    });
    carga = acumularResultado(carga, { tipo: 'sinDatos', conocimiento: null });
    expect(carga).toMatchObject({ librosRevisados: 3, guardados: 2, sinDatos: 1, conSinopsisUtil: 1, conSinopsisCorta: 1, sinSinopsis: 1 });
    expect(carga.porIdioma).toEqual({ es: { total: 1, utiles: 1 }, en: { total: 1, utiles: 0 }, desconocido: { total: 1, utiles: 0 } });
    expect(carga.porFuente['sin-sinopsis']).toEqual({ total: 1, utiles: 0 });
    expect(JSON.stringify(carga)).not.toContain(SINOPSIS_UTIL);
  });

  it('un libro omitido no cuenta como revisado', () => {
    expect(acumularResultado(cargaBase(), { tipo: 'omitido' }).librosRevisados).toBe(0);
  });

  it('un error cuenta como revisado y como error, sin tocar la cobertura', () => {
    const carga = acumularResultado(cargaBase(), { tipo: 'error' });
    expect(carga).toMatchObject({ librosRevisados: 1, errores: 1, sinSinopsis: 0 });
  });
});

describe('combinarConocimiento', () => {
  const nuevo = { sinopsis: 'nueva', categorias: ['Nueva'], idioma: 'en', paginas: 5, clasificacionEdad: 'MATURE' as const, fuenteSinopsis: 'google-books' };

  it('sin registro previo usa lo encontrado', () => {
    expect(combinarConocimiento('a', null, nuevo, 'ahora')).toMatchObject({ sinopsis: 'nueva', fuenteSinopsis: 'google-books', idioma: 'en' });
  });

  it('conserva los campos que ya tenían valor y llena solo los vacíos', () => {
    const existente = conocimiento({ sinopsis: null, fuenteSinopsis: null, idioma: 'es', categorias: [], paginas: null });
    const resultado = combinarConocimiento('a', existente, nuevo, 'ahora');
    expect(resultado).toMatchObject({ sinopsis: 'nueva', idioma: 'es', categorias: ['Nueva'], paginas: 5, clasificacionEdad: 'MATURE' });
  });

  it('sin sinopsis nueva no deja una fuente huérfana', () => {
    expect(combinarConocimiento('a', null, { ...nuevo, sinopsis: null }, 'ahora').fuenteSinopsis).toBeNull();
  });
});

describe('procesarLibro', () => {
  it('omite un libro que ya no existe', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce(undefined);
    expect(await procesarLibro('a')).toEqual({ tipo: 'omitido' });
  });

  it('no consulta fuentes ni escribe si el libro ya tiene sinopsis', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ bookId: 'a', isbn: '1' }).mockResolvedValueOnce(conocimiento());
    expect((await procesarLibro('a')).tipo).toBe('yaTenia');
    expect(resolverMock).not.toHaveBeenCalled();
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('a un libro con sinopsis y sin idioma le infiere el idioma sin consultar fuentes ni tocar lo demás', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce({ bookId: 'a', isbn: '9789586390125' })
      .mockResolvedValueOnce(conocimiento({ idioma: null }));
    const resultado = await procesarLibro('a');
    expect(resultado.tipo).toBe('yaTenia');
    expect(resolverMock).not.toHaveBeenCalled();
    expect(guardarMock).toHaveBeenCalledWith(
      'conocimiento',
      expect.objectContaining({ idioma: 'es', sinopsis: SINOPSIS_UTIL, fuenteSinopsis: 'sitio:tornamesa.co', categorias: ['Fantasía'] }),
    );
  });

  it('nunca cambia un idioma que ya estaba', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce({ bookId: 'a', isbn: '9780140449136' })
      .mockResolvedValueOnce(conocimiento({ idioma: 'fr' }));
    await procesarLibro('a');
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('si el idioma no es inferible, no escribe', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce({ bookId: 'a', isbn: '9789999999999' })
      .mockResolvedValueOnce(conocimiento({ idioma: null }));
    await procesarLibro('a');
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('un libro sin ISBN se omite sin consultar', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ bookId: 'a', isbn: null }).mockResolvedValueOnce(undefined);
    expect((await procesarLibro('a')).tipo).toBe('sinIsbn');
    expect(resolverMock).not.toHaveBeenCalled();
  });

  it('guarda lo encontrado y pide los metadatos sin PVP', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ bookId: 'a', isbn: '123' }).mockResolvedValueOnce(undefined);
    resolverMock.mockResolvedValueOnce(metadatos());
    expect((await procesarLibro('a')).tipo).toBe('guardado');
    expect(resolverMock).toHaveBeenCalledWith('123', { conPvp: false });
    expect(guardarMock).toHaveBeenCalledWith('conocimiento', expect.objectContaining({ bookId: 'a', fuenteSinopsis: 'google-books' }));
  });

  it('si ninguna fuente devuelve nada, no escribe', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ bookId: 'a', isbn: '123' }).mockResolvedValueOnce(undefined);
    resolverMock.mockResolvedValueOnce(metadatos({ sinopsis: null, categorias: [], idioma: null, paginas: null, fuenteSinopsis: null }));
    expect((await procesarLibro('a')).tipo).toBe('sinDatos');
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('un fallo no lanza: se cuenta como error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    obtenerPorClaveMock.mockRejectedValueOnce(new Error('boom'));
    expect((await procesarLibro('a')).tipo).toBe('error');
  });
});

describe('handlerIniciar', () => {
  it('401 con token inválido', async () => {
    verificarTokenMock.mockRejectedValueOnce(new TokenInvalidoError('no'));
    const r = (await handlerIniciar(evento(), {} as never, () => undefined)) as { statusCode: number };
    expect(r.statusCode).toBe(401);
  });

  it('403 si no es administrador', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'vendedor' });
    const r = (await handlerIniciar(evento(), {} as never, () => undefined)) as { statusCode: number };
    expect(r.statusCode).toBe(403);
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('409 con el cargaId si ya hay una carga en curso', async () => {
    obtenerPorClaveMock
      .mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' })
      .mockResolvedValueOnce(cargaBase());
    escanearProyeccionMock.mockResolvedValueOnce([{ cargaId: 'c-1', estado: 'en_progreso', actualizadoEn: new Date().toISOString() }]);
    const r = (await handlerIniciar(evento(), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).cargaId).toBe('c-1');
  });

  it('una carga abandonada (>10 min) se marca error y deja iniciar otra', async () => {
    const vieja = cargaBase({ actualizadoEn: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' }).mockResolvedValueOnce(vieja);
    escanearProyeccionMock
      .mockResolvedValueOnce([{ cargaId: 'c-1', estado: 'en_progreso', actualizadoEn: vieja.actualizadoEn }])
      .mockResolvedValueOnce([{ bookId: 'a' }]);
    const r = (await handlerIniciar(evento(), {} as never, () => undefined)) as { statusCode: number };
    expect(r.statusCode).toBe(202);
    expect(guardarMock).toHaveBeenCalledWith('cargas', expect.objectContaining({ cargaId: 'c-1', estado: 'error' }));
  });

  it('crea la carga con la cola ordenada y dispara el worker', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' });
    escanearProyeccionMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ bookId: 'b' }, { bookId: 'a' }]);
    const r = (await handlerIniciar(evento(), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(r.statusCode).toBe(202);
    expect(guardarMock).toHaveBeenCalledWith('cargas', expect.objectContaining({ colaBookIds: ['a', 'b'], totalLibros: 2, estado: 'en_progreso' }));
    expect(lambdaSendMock).toHaveBeenCalledOnce();
  });

  it('con inventario vacío termina de inmediato y no dispara el worker', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' });
    escanearProyeccionMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await handlerIniciar(evento(), {} as never, () => undefined);
    expect(guardarMock).toHaveBeenCalledWith('cargas', expect.objectContaining({ estado: 'completado' }));
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });
});

describe('handlerWorker', () => {
  it('no hace nada si la carga no existe o ya terminó', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce(undefined);
    await handlerWorker({ cargaId: 'x' }, {} as never, () => undefined);
    obtenerPorClaveMock.mockResolvedValueOnce(cargaBase({ estado: 'completado' }));
    await handlerWorker({ cargaId: 'c-1' }, {} as never, () => undefined);
    expect(guardarMock).not.toHaveBeenCalled();
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('procesa el lote, avanza el índice y se auto-invoca mientras queden libros', async () => {
    const cola = Array.from({ length: 12 }, (_, i) => `b${String(i).padStart(2, '0')}`);
    obtenerPorClaveMock.mockImplementation(async (tabla: string, clave: Record<string, string>) => {
      if (tabla === 'cargas') return cargaBase({ colaBookIds: cola, totalLibros: 12 });
      if (tabla === 'libros') return { bookId: clave['bookId'], isbn: '1' };
      return undefined;
    });
    resolverMock.mockResolvedValue(metadatos());
    await handlerWorker({ cargaId: 'c-1' }, {} as never, () => undefined);
    const guardadoCarga = guardarMock.mock.calls.find(([tabla]) => tabla === 'cargas')?.[1];
    expect(guardadoCarga).toMatchObject({ indiceActual: 9, librosRevisados: 9, guardados: 9, estado: 'en_progreso' });
    expect(lambdaSendMock).toHaveBeenCalledOnce();
  }, 15_000);

  it('el último lote marca la carga completada y no se auto-invoca', async () => {
    obtenerPorClaveMock.mockImplementation(async (tabla: string) => (tabla === 'cargas' ? cargaBase() : undefined));
    await handlerWorker({ cargaId: 'c-1' }, {} as never, () => undefined);
    const guardadoCarga = guardarMock.mock.calls.find(([tabla]) => tabla === 'cargas')?.[1];
    expect(guardadoCarga).toMatchObject({ estado: 'completado', indiceActual: 2 });
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });
});

describe('handlerConsultar', () => {
  it('403 para quien no es administrador', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'vendedor' });
    const r = (await handlerConsultar(evento({ pathParameters: { cargaId: 'c-1' } }), {} as never, () => undefined)) as { statusCode: number };
    expect(r.statusCode).toBe(403);
  });

  it('404 si no existe', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' }).mockResolvedValueOnce(undefined);
    const r = (await handlerConsultar(evento({ pathParameters: { cargaId: 'c-1' } }), {} as never, () => undefined)) as { statusCode: number };
    expect(r.statusCode).toBe(404);
  });

  it('devuelve el resumen sin la cola de bookId', async () => {
    obtenerPorClaveMock.mockResolvedValueOnce({ email: ADMIN.email, rol: 'administrador' }).mockResolvedValueOnce(cargaBase());
    const r = (await handlerConsultar(evento({ pathParameters: { cargaId: 'c-1' } }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).not.toHaveProperty('colaBookIds');
  });
});
