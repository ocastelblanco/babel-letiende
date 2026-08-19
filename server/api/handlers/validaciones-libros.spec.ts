import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';
import type { SitioScraping } from '../services/scraping';

const {
  verificarTokenDesdeHeaderMock,
  escanearProyeccionMock,
  escanearTodoMock,
  guardarMock,
  obtenerPorClaveMock,
  scrapearSitioMock,
  lambdaSendMock,
} = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  escanearProyeccionMock: vi.fn(),
  escanearTodoMock: vi.fn(),
  guardarMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  scrapearSitioMock: vi.fn(),
  lambdaSendMock: vi.fn(),
}));

vi.mock('../lib/verificar-token', async () => {
  const real = await vi.importActual<typeof import('../lib/verificar-token')>('../lib/verificar-token');
  return {
    ...real,
    verificarTokenDesdeHeader: verificarTokenDesdeHeaderMock,
  };
});

vi.mock('../services/dynamodb', async () => {
  const real = await vi.importActual<typeof import('../services/dynamodb')>('../services/dynamodb');
  return {
    ...real,
    escanearProyeccion: escanearProyeccionMock,
    escanearTodo: escanearTodoMock,
    guardar: guardarMock,
    obtenerPorClave: obtenerPorClaveMock,
  };
});

vi.mock('../services/scraping', async () => {
  // `portadaEsInvalida` es lógica pura (sin red) — se usa la implementación
  // real, mismo criterio que `metadatos.spec.ts`.
  const real = await vi.importActual<typeof import('../services/scraping')>('../services/scraping');
  return {
    portadaEsInvalida: real.portadaEsInvalida,
    scrapearSitio: scrapearSitioMock,
  };
});

vi.mock('@aws-sdk/client-lambda', () => ({
  // El código real hace `new LambdaClient({})` y `new InvokeCommand({...})`
  // — un mock con arrow function no sirve (no se puede invocar con `new`),
  // se usan clases reales.
  LambdaClient: class {
    send = lambdaSendMock;
  },
  InvokeCommand: class {
    constructor(input: unknown) {
      Object.assign(this, input as object);
    }
  },
}));

const { handlerIniciar, handlerWorker, handlerConsultar, construirColaPorMueble, nombreMuebleDesdeIndice } =
  await import('./validaciones-libros');

const ADMIN = { email: 'admin@letiende.co', uid: 'uid-admin' };

function libro(datos: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isbn: '9780000000001',
    bookId: 'book-1',
    titulo: 'Libro de prueba',
    autor: 'Autor',
    editorial: 'Editorial',
    portadaUrl: 'https://example.com/portada.jpg',
    pvp: 50000,
    porcentajeDescuentoEditorial: 35,
    costo: 32500,
    utilidadCatalogo: 17500,
    cantidadTotal: 1,
    cantidadDisponible: 1,
    ubicacionId: 'ubicacion-1',
    creadoPor: 'vendedor@letiende.co',
    creadoEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    ...datos,
  };
}

function mueble(datos: Record<string, unknown> = {}): Record<string, unknown> {
  return { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1', ...datos };
}

function ubicacion(datos: Record<string, unknown> = {}): Record<string, unknown> {
  return { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1', ...datos };
}

function sitio(datos: Partial<SitioScraping> & { dominio: string }): SitioScraping {
  return {
    nombre: datos.dominio,
    url: `https://${datos.dominio}`,
    info: false,
    pvp: false,
    prioridad: 1,
    palabrasClaveInvalidas: [],
    ...datos,
  };
}

function eventoPost(authorization?: string): APIGatewayProxyEventV2 {
  return {
    headers: authorization ? { authorization } : {},
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

function eventoGet(opciones: { authorization?: string; validacionId?: string } = {}): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    pathParameters: opciones.validacionId ? { validacionId: opciones.validacionId } : undefined,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['TABLA_LIBROS'] = 'babel-libros-test';
  process.env['TABLA_UBICACIONES'] = 'babel-ubicaciones-test';
  process.env['TABLA_MUEBLES'] = 'babel-muebles-test';
  process.env['TABLA_VALIDACIONES_LIBROS'] = 'babel-validaciones-libros-test';
  process.env['TABLA_SITIOS_SCRAPING'] = 'babel-sitios-scraping-test';
  process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
  process.env['NOMBRE_FUNCION_WORKER'] = 'babel-letiende-test-validarLibrosWorker';
  lambdaSendMock.mockResolvedValue({});
});

describe('construirColaPorMueble', () => {
  it('agrupa por mueble en orden alfabético y por título dentro de cada mueble', () => {
    const libros = [
      libro({ bookId: 'b-zeta', titulo: 'Zeta', ubicacionId: 'u-biblioteca-2' }),
      libro({ bookId: 'b-alfa', titulo: 'Alfa', ubicacionId: 'u-biblioteca-1' }),
      libro({ bookId: 'b-beta', titulo: 'Beta', ubicacionId: 'u-biblioteca-1' }),
    ];
    const ubicaciones = [
      ubicacion({ ubicacionId: 'u-biblioteca-1', muebleId: 'm-1' }),
      ubicacion({ ubicacionId: 'u-biblioteca-2', muebleId: 'm-2' }),
    ];
    const muebles = [
      mueble({ muebleId: 'm-2', nombre: 'Biblioteca 2' }),
      mueble({ muebleId: 'm-1', nombre: 'Biblioteca 1' }),
    ];

    const { colaBookIds, limitesMueble } = construirColaPorMueble(
      libros as never,
      ubicaciones as never,
      muebles as never,
    );

    expect(colaBookIds).toEqual(['b-alfa', 'b-beta', 'b-zeta']);
    expect(limitesMueble).toEqual([
      { nombre: 'Biblioteca 1', hasta: 2 },
      { nombre: 'Biblioteca 2', hasta: 3 },
    ]);
  });

  it('agrupa los libros con ubicacionId roto en "Sin mueble asignado", al final', () => {
    const libros = [
      libro({ bookId: 'b-huerfano', titulo: 'Huérfano', ubicacionId: 'ubicacion-inexistente' }),
      libro({ bookId: 'b-alfa', titulo: 'Alfa', ubicacionId: 'u-1' }),
    ];
    const ubicaciones = [ubicacion({ ubicacionId: 'u-1', muebleId: 'm-1' })];
    const muebles = [mueble({ muebleId: 'm-1', nombre: 'Biblioteca 1' })];

    const { colaBookIds, limitesMueble } = construirColaPorMueble(
      libros as never,
      ubicaciones as never,
      muebles as never,
    );

    expect(colaBookIds).toEqual(['b-alfa', 'b-huerfano']);
    expect(limitesMueble).toEqual([
      { nombre: 'Biblioteca 1', hasta: 1 },
      { nombre: 'Sin mueble asignado', hasta: 2 },
    ]);
  });

  it('devuelve cola y límites vacíos sin libros', () => {
    const resultado = construirColaPorMueble([], [], []);
    expect(resultado).toEqual({ colaBookIds: [], limitesMueble: [] });
  });
});

describe('nombreMuebleDesdeIndice', () => {
  const limites = [
    { nombre: 'Biblioteca 1', hasta: 2 },
    { nombre: 'Biblioteca 2', hasta: 5 },
  ];

  it('devuelve el mueble correspondiente al índice', () => {
    expect(nombreMuebleDesdeIndice(0, limites)).toBe('Biblioteca 1');
    expect(nombreMuebleDesdeIndice(1, limites)).toBe('Biblioteca 1');
    expect(nombreMuebleDesdeIndice(2, limites)).toBe('Biblioteca 2');
    expect(nombreMuebleDesdeIndice(4, limites)).toBe('Biblioteca 2');
  });

  it('devuelve null cuando el índice ya superó el último límite (corrida terminada)', () => {
    expect(nombreMuebleDesdeIndice(5, limites)).toBeNull();
  });
});

describe('handlerIniciar (POST /api/validaciones-libros)', () => {
  beforeEach(() => {
    verificarTokenDesdeHeaderMock.mockResolvedValue(ADMIN);
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) {
        return { ...ADMIN, nombre: 'Admin', fotoUrl: null, rol: 'administrador', creadoEn: '2026-01-01T00:00:00.000Z' };
      }
      return undefined;
    });
    escanearProyeccionMock.mockResolvedValue([]);
    escanearTodoMock.mockResolvedValue([]);
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerIniciar(eventoPost(), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no es administrador', async () => {
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) =>
      'email' in clave ? { ...ADMIN, rol: 'vendedor' } : undefined,
    );

    const respuesta = await handlerIniciar(eventoPost('Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('responde 409 con el validacionId en curso si ya hay una corrida en_progreso reciente', async () => {
    escanearProyeccionMock.mockResolvedValue([
      { validacionId: 'v-activa', estado: 'en_progreso', actualizadoEn: new Date().toISOString() },
    ]);
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) return { ...ADMIN, rol: 'administrador' };
      if ('validacionId' in clave) {
        return { validacionId: 'v-activa', estado: 'en_progreso', actualizadoEn: new Date().toISOString() };
      }
      return undefined;
    });

    const respuesta = await handlerIniciar(eventoPost('Bearer token'), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 409 });
    expect(JSON.parse((respuesta as { body: string }).body)).toMatchObject({ validacionId: 'v-activa' });
    expect(guardarMock).not.toHaveBeenCalled();
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('trata una corrida en_progreso abandonada (>10 min sin avanzar) como error y arranca una nueva', async () => {
    const actualizadoHaceRato = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    escanearProyeccionMock.mockResolvedValue([
      { validacionId: 'v-vieja', estado: 'en_progreso', actualizadoEn: actualizadoHaceRato },
    ]);
    const corridaVieja = {
      validacionId: 'v-vieja',
      estado: 'en_progreso',
      actualizadoEn: actualizadoHaceRato,
      colaBookIds: ['book-x'],
      indiceActual: 0,
      totalLibros: 1,
      limitesMueble: [],
      librosRevisados: 0,
      pvpActualizados: 0,
      portadasCorregidas: 0,
      portadasPendientes: [],
      erroresLibro: [],
      muebleActualNombre: null,
      iniciadoPor: 'otro@letiende.co',
      iniciadoEn: actualizadoHaceRato,
    };
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) return { ...ADMIN, rol: 'administrador' };
      if ('validacionId' in clave) return corridaVieja;
      return undefined;
    });
    escanearTodoMock.mockResolvedValue([]);

    const respuesta = await handlerIniciar(eventoPost('Bearer token'), {} as never, {} as never);

    // Primer guardar() libera la corrida abandonada (estado: error), el
    // segundo crea la corrida nueva (sin libros en este caso, por eso queda
    // "completado" de inmediato).
    expect(guardarMock).toHaveBeenCalledTimes(2);
    expect(guardarMock.mock.calls[0]?.[1]).toMatchObject({ validacionId: 'v-vieja', estado: 'error' });
    expect(respuesta).toMatchObject({ statusCode: 202 });
  });

  it('crea la corrida como "completado" de inmediato y no invoca al worker si no hay libros', async () => {
    escanearTodoMock.mockResolvedValue([]);

    const respuesta = await handlerIniciar(eventoPost('Bearer token'), {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(1);
    expect(guardarMock.mock.calls[0]?.[1]).toMatchObject({ estado: 'completado', totalLibros: 0, colaBookIds: [] });
    expect(lambdaSendMock).not.toHaveBeenCalled();
    expect(respuesta).toMatchObject({ statusCode: 202 });
  });

  it('crea la cola agrupada por mueble, guarda estado en_progreso e invoca al worker', async () => {
    escanearTodoMock.mockImplementation(async (tabla: string) => {
      if (tabla === 'babel-libros-test') return [libro({ bookId: 'book-1', titulo: 'Uno', ubicacionId: 'ubicacion-1' })];
      if (tabla === 'babel-ubicaciones-test') return [ubicacion()];
      if (tabla === 'babel-muebles-test') return [mueble()];
      return [];
    });

    const respuesta = await handlerIniciar(eventoPost('Bearer token'), {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(1);
    const validacionGuardada = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(validacionGuardada).toMatchObject({
      estado: 'en_progreso',
      totalLibros: 1,
      indiceActual: 0,
      colaBookIds: ['book-1'],
      iniciadoPor: ADMIN.email,
    });

    expect(lambdaSendMock).toHaveBeenCalledTimes(1);
    const invocacion = lambdaSendMock.mock.calls[0]?.[0] as { FunctionName: string; InvocationType: string };
    expect(invocacion.FunctionName).toBe('babel-letiende-test-validarLibrosWorker');
    expect(invocacion.InvocationType).toBe('Event');

    expect(respuesta).toMatchObject({ statusCode: 202 });
    expect(JSON.parse((respuesta as { body: string }).body)).toMatchObject({
      validacionId: validacionGuardada['validacionId'],
    });
  });
});

describe('handlerWorker (Lambda interna, sin ruta HTTP)', () => {
  const validacionBase = {
    validacionId: 'v-1',
    estado: 'en_progreso' as const,
    iniciadoPor: 'admin@letiende.co',
    iniciadoEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    colaBookIds: ['book-1'],
    indiceActual: 0,
    totalLibros: 1,
    limitesMueble: [{ nombre: 'Biblioteca 1', hasta: 1 }],
    librosRevisados: 0,
    pvpActualizados: 0,
    portadasCorregidas: 0,
    portadasPendientes: [],
    erroresLibro: [],
    muebleActualNombre: 'Biblioteca 1',
  };

  function mockConValidacionYLibro(
    validacion: Record<string, unknown>,
    libroActual: Record<string, unknown> | undefined,
  ): void {
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('validacionId' in clave) return validacion;
      if ('bookId' in clave) return libroActual;
      return undefined;
    });
  }

  it('termina sin hacer nada si la validación no existe', async () => {
    obtenerPorClaveMock.mockResolvedValue(undefined);

    await handlerWorker({ validacionId: 'no-existe' }, {} as never, {} as never);

    expect(guardarMock).not.toHaveBeenCalled();
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('termina sin hacer nada si el estado ya no es en_progreso (protección ante reintentos)', async () => {
    mockConValidacionYLibro({ ...validacionBase, estado: 'completado' }, undefined);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(guardarMock).not.toHaveBeenCalled();
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('omite en silencio un bookId cuyo libro ya no existe (se eliminó mientras esperaba turno)', async () => {
    mockConValidacionYLibro(validacionBase, undefined);
    escanearTodoMock.mockResolvedValue([]);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(1);
    const actualizada = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(actualizada).toMatchObject({ estado: 'completado', librosRevisados: 1, erroresLibro: [] });
  });

  it('reemplaza el PVP por el más alto entre los sitios scrapeados, solo si difiere del vigente', async () => {
    mockConValidacionYLibro(validacionBase, libro({ pvp: 50000, portadaUrl: null }));
    escanearTodoMock.mockResolvedValue([
      sitio({ dominio: 'sitio-a.com', pvp: true }),
      sitio({ dominio: 'sitio-b.com', pvp: true }),
    ]);
    scrapearSitioMock.mockImplementation(async (sitioLlamado: SitioScraping) =>
      sitioLlamado.dominio === 'sitio-a.com' ? { pvp: 60000 } : { pvp: 55000 },
    );

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(2); // 1: libro actualizado, 2: progreso de la corrida
    const [tablaLibro, libroGuardado] = guardarMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(tablaLibro).toBe('babel-libros-test');
    expect(libroGuardado).toMatchObject({ pvp: 60000 });

    const progreso = guardarMock.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ pvpActualizados: 1 });
  });

  it('no toca el PVP si el más alto scrapeado es igual al vigente', async () => {
    mockConValidacionYLibro(validacionBase, libro({ pvp: 60000, portadaUrl: null }));
    escanearTodoMock.mockResolvedValue([sitio({ dominio: 'sitio-a.com', pvp: true })]);
    scrapearSitioMock.mockResolvedValue({ pvp: 60000 });

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(1); // solo el progreso, el libro no cambió
    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ pvpActualizados: 0 });
  });

  it('salta la validación de PVP para libros sin ISBN', async () => {
    mockConValidacionYLibro(validacionBase, libro({ isbn: null, pvp: 50000, portadaUrl: null }));
    escanearTodoMock.mockResolvedValue([sitio({ dominio: 'sitio-a.com', pvp: true })]);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(scrapearSitioMock).not.toHaveBeenCalled();
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ pvpActualizados: 0 });
  });

  it('reemplaza una portada inválida por la primera portada válida según prioridad', async () => {
    mockConValidacionYLibro(
      validacionBase,
      libro({ isbn: '9780000000001', portadaUrl: 'https://sitio-a.com/no-disponible.jpg', pvp: 50000 }),
    );
    escanearTodoMock.mockResolvedValue([
      sitio({ dominio: 'sitio-a.com', info: true, prioridad: 1, palabrasClaveInvalidas: ['no-disponible'] }),
      sitio({ dominio: 'sitio-b.com', info: true, prioridad: 2 }),
    ]);
    scrapearSitioMock.mockImplementation(async (sitioLlamado: SitioScraping) =>
      sitioLlamado.dominio === 'sitio-b.com' ? { portadaUrl: 'https://sitio-b.com/portada-real.jpg' } : {},
    );

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    const libroGuardado = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(libroGuardado).toMatchObject({ portadaUrl: 'https://sitio-b.com/portada-real.jpg' });
    const progreso = guardarMock.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ portadasCorregidas: 1, portadasPendientes: [] });
  });

  it('marca la portada como pendiente (sin borrarla) si ningún sitio devuelve un reemplazo válido', async () => {
    mockConValidacionYLibro(
      validacionBase,
      libro({
        bookId: 'book-1',
        titulo: 'Libro sin portada válida',
        isbn: '9780000000001',
        portadaUrl: 'https://sitio-a.com/no-disponible.jpg',
        pvp: 50000,
      }),
    );
    escanearTodoMock.mockResolvedValue([
      sitio({ dominio: 'sitio-a.com', info: true, palabrasClaveInvalidas: ['no-disponible'] }),
    ]);
    scrapearSitioMock.mockResolvedValue({});

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(guardarMock).toHaveBeenCalledTimes(1); // el libro no cambió, solo el progreso
    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({
      portadasCorregidas: 0,
      portadasPendientes: [{ bookId: 'book-1', titulo: 'Libro sin portada válida', portadaUrl: 'https://sitio-a.com/no-disponible.jpg' }],
    });
  });

  it('libros sin ISBN con portada inválida quedan pendientes (no hay forma de buscar un reemplazo)', async () => {
    mockConValidacionYLibro(
      validacionBase,
      libro({ isbn: null, portadaUrl: 'https://sitio-a.com/no-disponible.jpg', pvp: 50000 }),
    );
    escanearTodoMock.mockResolvedValue([
      sitio({ dominio: 'sitio-a.com', info: true, palabrasClaveInvalidas: ['no-disponible'] }),
    ]);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    expect(scrapearSitioMock).not.toHaveBeenCalled();
    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ portadasCorregidas: 0 });
    expect((progreso['portadasPendientes'] as unknown[]).length).toBe(1);
  });

  it('registra un error puntual sin detener el resto de la corrida si un libro falla inesperadamente', async () => {
    mockConValidacionYLibro(validacionBase, libro());
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('validacionId' in clave) return validacionBase;
      if ('bookId' in clave) throw new Error('DynamoDB no disponible');
      return undefined;
    });
    escanearTodoMock.mockResolvedValue([]);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ librosRevisados: 1 });
    expect((progreso['erroresLibro'] as Array<{ bookId: string }>)[0]).toMatchObject({ bookId: 'book-1' });
  });

  it('marca la corrida como completado y NO se auto-invoca cuando el lote agota la cola', async () => {
    mockConValidacionYLibro(validacionBase, libro({ portadaUrl: null }));
    escanearTodoMock.mockResolvedValue([]);

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ estado: 'completado', indiceActual: 1, muebleActualNombre: null });
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('se auto-invoca con el mismo validacionId cuando queda cola pendiente', async () => {
    // TAMANO_LOTE es 20 — para probar la auto-invocación con cola pendiente
    // hace falta más de 20 libros en una sola corrida.
    escanearTodoMock.mockResolvedValue([]);
    const colaLarga = Array.from({ length: 25 }, (_, indice) => `book-${indice}`);
    const validacionColaLarga = {
      ...validacionBase,
      colaBookIds: colaLarga,
      totalLibros: colaLarga.length,
      limitesMueble: [{ nombre: 'Biblioteca 1', hasta: colaLarga.length }],
    };
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('validacionId' in clave) return validacionColaLarga;
      if ('bookId' in clave) return libro({ bookId: clave['bookId'], portadaUrl: null });
      return undefined;
    });

    await handlerWorker({ validacionId: 'v-1' }, {} as never, {} as never);

    const progreso = guardarMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(progreso).toMatchObject({ estado: 'en_progreso', indiceActual: 20 });
    expect(lambdaSendMock).toHaveBeenCalledTimes(1);
    const invocacion = lambdaSendMock.mock.calls[0]?.[0] as { FunctionName: string };
    expect(invocacion.FunctionName).toBe('babel-letiende-test-validarLibrosWorker');
  });
});

describe('handlerConsultar (GET /api/validaciones-libros/:validacionId)', () => {
  beforeEach(() => {
    verificarTokenDesdeHeaderMock.mockResolvedValue(ADMIN);
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) return { ...ADMIN, rol: 'administrador' };
      return undefined;
    });
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerConsultar(eventoGet({ validacionId: 'v-1' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
  });

  it('responde 403 cuando el correo no es administrador', async () => {
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) =>
      'email' in clave ? { ...ADMIN, rol: 'vendedor' } : undefined,
    );

    const respuesta = await handlerConsultar(
      eventoGet({ authorization: 'Bearer token', validacionId: 'v-1' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
  });

  it('responde 400 si falta el validacionId en la ruta', async () => {
    const respuesta = await handlerConsultar(eventoGet({ authorization: 'Bearer token' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
  });

  it('responde 404 si la validación no existe', async () => {
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) return { ...ADMIN, rol: 'administrador' };
      if ('validacionId' in clave) return undefined;
      return undefined;
    });

    const respuesta = await handlerConsultar(
      eventoGet({ authorization: 'Bearer token', validacionId: 'no-existe' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 404 });
  });

  it('responde 200 con el resumen, sin colaBookIds ni limitesMueble', async () => {
    const validacionCompleta = {
      validacionId: 'v-1',
      estado: 'en_progreso',
      iniciadoPor: ADMIN.email,
      iniciadoEn: '2026-01-01T00:00:00.000Z',
      actualizadoEn: '2026-01-01T00:00:00.000Z',
      colaBookIds: ['book-1', 'book-2'],
      indiceActual: 1,
      totalLibros: 2,
      limitesMueble: [{ nombre: 'Biblioteca 1', hasta: 2 }],
      librosRevisados: 1,
      pvpActualizados: 0,
      portadasCorregidas: 0,
      portadasPendientes: [],
      erroresLibro: [],
      muebleActualNombre: 'Biblioteca 1',
    };
    obtenerPorClaveMock.mockImplementation(async (_tabla: string, clave: Record<string, string>) => {
      if ('email' in clave) return { ...ADMIN, rol: 'administrador' };
      if ('validacionId' in clave) return validacionCompleta;
      return undefined;
    });

    const respuesta = await handlerConsultar(
      eventoGet({ authorization: 'Bearer token', validacionId: 'v-1' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200 });
    const cuerpo = JSON.parse((respuesta as { body: string }).body);
    expect(cuerpo).toMatchObject({ validacionId: 'v-1', estado: 'en_progreso', librosRevisados: 1 });
    expect(cuerpo.colaBookIds).toBeUndefined();
    expect(cuerpo.limitesMueble).toBeUndefined();
  });
});
