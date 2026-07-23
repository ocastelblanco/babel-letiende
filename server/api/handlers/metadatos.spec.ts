import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenInvalidoError } from '../lib/verificar-token';
import type { ResultadoScraping, SitioScraping } from '../services/scraping';

const {
  verificarTokenDesdeHeaderMock,
  obtenerPorClaveMock,
  escanearTodoMock,
  obtenerMetadatosPorIsbnMock,
  buscarLibrosPorTextoMock,
  scrapearSitioMock,
  buscarLernerPorTextoMock,
  buscarNacionalPorTextoMock,
} = vi.hoisted(() => ({
  verificarTokenDesdeHeaderMock: vi.fn(),
  obtenerPorClaveMock: vi.fn(),
  escanearTodoMock: vi.fn(),
  obtenerMetadatosPorIsbnMock: vi.fn(),
  buscarLibrosPorTextoMock: vi.fn(),
  scrapearSitioMock: vi.fn(),
  buscarLernerPorTextoMock: vi.fn(),
  buscarNacionalPorTextoMock: vi.fn(),
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
  escanearTodo: escanearTodoMock,
}));

vi.mock('../services/api-letiende', () => ({
  obtenerMetadatosPorIsbn: obtenerMetadatosPorIsbnMock,
  buscarLibrosPorTexto: buscarLibrosPorTextoMock,
}));

vi.mock('../services/scraping', () => ({
  scrapearSitio: scrapearSitioMock,
  buscarLernerPorTexto: buscarLernerPorTextoMock,
  buscarNacionalPorTexto: buscarNacionalPorTextoMock,
}));

const { handler, handlerBuscar } = await import('./metadatos');

/** Crea una promesa que solo se resuelve cuando el test invoca `resolve` explícitamente — usada para controlar el orden de llegada de red en los tests de paralelismo/prioridad. */
function crearDiferida<T>(): { promise: Promise<T>; resolve: (valor: T) => void } {
  let resolve!: (valor: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null };
const metadatosEncontrados = {
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://books.google.com/portada.jpg',
};

function sitio(datos: Partial<SitioScraping> & { dominio: string; prioridad: number }): SitioScraping {
  return {
    nombre: datos.dominio,
    url: `https://${datos.dominio}`,
    info: false,
    pvp: false,
    ...datos,
  };
}

function eventoFalso(
  opciones: { authorization?: string; isbn?: string; query?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opciones.authorization ? { authorization: opciones.authorization } : {},
    pathParameters: opciones.isbn ? { isbn: opciones.isbn } : undefined,
    queryStringParameters: opciones.query,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('handler (/api/metadatos/:isbn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
    process.env['TABLA_SITIOS_SCRAPING'] = 'babel-sitios-scraping-test';
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    // Por defecto no hay sitios configurados — las pruebas de scraping
    // sobrescriben esta resolución con `mockResolvedValueOnce`/`mockResolvedValue`.
    escanearTodoMock.mockResolvedValue([]);
    scrapearSitioMock.mockResolvedValue({});
    buscarLibrosPorTextoMock.mockResolvedValue([]);
    buscarLernerPorTextoMock.mockResolvedValue([]);
    buscarNacionalPorTextoMock.mockResolvedValue([]);
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handler(eventoFalso({ isbn: '9780000000001' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(obtenerMetadatosPorIsbnMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el correo no tiene fila en babel-usuarios', async () => {
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
    obtenerPorClaveMock.mockResolvedValue({ email: 'otro@letiende.co', rol: 'invitado' });

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000001' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
  });

  it('responde 400 cuando falta el isbn en la ruta', async () => {
    const respuesta = await handler(eventoFalso({ authorization: 'Bearer token' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
  });

  it(
    'cuando api.letiende.co resuelve toda la info, igual dispara scraping en paralelo SOLO para los sitios ' +
      'con pvp=true (nunca resuelve pvp por sí sola)',
    async () => {
      obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosEncontrados);
      const sitioConInfoYPvp = sitio({ dominio: 'con-info-y-pvp.com', info: true, pvp: true, prioridad: 2 });
      const sitioSoloInfo = sitio({ dominio: 'solo-info.com', info: true, pvp: false, prioridad: 1 });
      const sitioSoloPvpMenorPrioridad = sitio({ dominio: 'solo-pvp.com', info: false, pvp: true, prioridad: 3 });
      escanearTodoMock.mockResolvedValue([sitioConInfoYPvp, sitioSoloInfo, sitioSoloPvpMenorPrioridad]);
      scrapearSitioMock.mockImplementation(async (s: SitioScraping): Promise<ResultadoScraping> => {
        if (s.dominio === 'con-info-y-pvp.com') {
          return { pvp: 50_000 };
        }
        if (s.dominio === 'solo-pvp.com') {
          return { pvp: 60_000 };
        }
        return {};
      });

      const respuesta = await handler(
        eventoFalso({ authorization: 'Bearer token', isbn: '9780000000001' }),
        {} as never,
        {} as never,
      );

      // El sitio "solo-info.com" no tiene pvp=true y toda la info ya estaba
      // resuelta por api.letiende.co, así que NUNCA debió consultarse.
      expect(scrapearSitioMock).not.toHaveBeenCalledWith(sitioSoloInfo, '9780000000001');
      expect(scrapearSitioMock).toHaveBeenCalledWith(sitioConInfoYPvp, '9780000000001');
      expect(scrapearSitioMock).toHaveBeenCalledWith(sitioSoloPvpMenorPrioridad, '9780000000001');
      expect(scrapearSitioMock).toHaveBeenCalledTimes(2);

      // Entre los dos sitios que sí resolvieron pvp, gana el de menor
      // `prioridad` (con-info-y-pvp.com, prioridad 2 < solo-pvp.com, prioridad 3).
      expect(respuesta).toMatchObject({
        statusCode: 200,
        body: JSON.stringify({ ...metadatosEncontrados, pvp: 50_000 }),
      });
    },
  );

  it('api.letiende.co no resuelve nada, el scraping paralelo llena los campos', async () => {
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosVacios);
    const unicoSitio = sitio({ dominio: 'unico.com', info: true, pvp: true, prioridad: 1 });
    escanearTodoMock.mockResolvedValue([unicoSitio]);
    scrapearSitioMock.mockResolvedValue({
      titulo: 'Título scrapeado',
      autor: 'Autor scrapeado',
      editorial: 'Editorial scrapeada',
      portadaUrl: 'https://unico.com/portada.jpg',
      pvp: 70_000,
    });

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000002' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({
        titulo: 'Título scrapeado',
        autor: 'Autor scrapeado',
        editorial: 'Editorial scrapeada',
        portadaUrl: 'https://unico.com/portada.jpg',
        pvp: 70_000,
      }),
    });
  });

  it(
    'un empate de campo entre dos sitios se resuelve por prioridad ascendente, sin importar el orden en que ' +
      'resuelven las promesas',
    async () => {
      obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosVacios);
      const sitioMejorPrioridad = sitio({ dominio: 'mejor-prioridad.com', info: true, pvp: false, prioridad: 1 });
      const sitioPeorPrioridad = sitio({ dominio: 'peor-prioridad.com', info: true, pvp: false, prioridad: 2 });
      // Orden de la tabla deliberadamente invertido respecto a `prioridad` —
      // tampoco debe importar.
      escanearTodoMock.mockResolvedValue([sitioPeorPrioridad, sitioMejorPrioridad]);

      const diferidaMejor = crearDiferida<ResultadoScraping>();
      const diferidaPeor = crearDiferida<ResultadoScraping>();
      scrapearSitioMock.mockImplementation((s: SitioScraping): Promise<ResultadoScraping> => {
        return s.dominio === 'mejor-prioridad.com' ? diferidaMejor.promise : diferidaPeor.promise;
      });

      const promesaHandler = handler(
        eventoFalso({ authorization: 'Bearer token', isbn: '9780000000003' }),
        {} as never,
        {} as never,
      );

      // Resuelve PRIMERO el sitio de peor prioridad (simulando que respondió
      // antes por red) y DESPUÉS el de mejor prioridad — el resultado final
      // no debe reflejar el orden de llegada, sino `prioridad`.
      diferidaPeor.resolve({ titulo: 'Título de peor prioridad' });
      await Promise.resolve();
      await Promise.resolve();
      diferidaMejor.resolve({ titulo: 'Título de mejor prioridad' });

      const respuesta = await promesaHandler;
      const cuerpo = JSON.parse(respuesta.body as string) as { titulo: string | null };
      expect(cuerpo.titulo).toBe('Título de mejor prioridad');
    },
  );

  it('los sitios aplicables se consultan en paralelo, sin esperar a que uno termine antes de invocar el siguiente', async () => {
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosVacios);
    const sitioA = sitio({ dominio: 'a.com', info: true, pvp: false, prioridad: 1 });
    const sitioB = sitio({ dominio: 'b.com', info: true, pvp: false, prioridad: 2 });
    escanearTodoMock.mockResolvedValue([sitioA, sitioB]);

    const diferidaA = crearDiferida<ResultadoScraping>();
    const diferidaB = crearDiferida<ResultadoScraping>();
    scrapearSitioMock.mockImplementation((s: SitioScraping): Promise<ResultadoScraping> => {
      return s.dominio === 'a.com' ? diferidaA.promise : diferidaB.promise;
    });

    const promesaHandler = handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000004' }),
      {} as never,
      {} as never,
    );

    // Espera (con reintentos, sin depender de contar microtasks a mano) hasta
    // el punto donde el handler ya debió haber invocado `scrapearSitio` para
    // AMBOS sitios — ninguna de las dos diferidas se ha resuelto todavía, así
    // que si la invocación fuera secuencial por prioridad, `scrapearSitioMock`
    // solo tendría 1 llamada en este punto.
    await vi.waitFor(() => {
      expect(scrapearSitioMock).toHaveBeenCalledTimes(2);
    });

    diferidaA.resolve({});
    diferidaB.resolve({});
    await promesaHandler;
  });

  it('ningún sitio resuelve nada → todo null, sigue 200', async () => {
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosVacios);
    const unicoSitio = sitio({ dominio: 'vacio.com', info: true, pvp: true, prioridad: 1 });
    escanearTodoMock.mockResolvedValue([unicoSitio]);
    scrapearSitioMock.mockResolvedValue({});

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '0000000000000' }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ ...metadatosVacios, pvp: null }),
    });
  });

  it('la tabla de sitios de scraping vacía degrada a solo lo que ya tenía de api.letiende.co, sin lanzar', async () => {
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosEncontrados);
    escanearTodoMock.mockResolvedValue([]);

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000005' }),
      {} as never,
      {} as never,
    );

    expect(scrapearSitioMock).not.toHaveBeenCalled();
    expect(respuesta).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ ...metadatosEncontrados, pvp: null }),
    });
  });

  it('el Scan de babel-sitios-scraping falla y no lanza, degrada a lo que ya tenía de api.letiende.co', async () => {
    obtenerMetadatosPorIsbnMock.mockResolvedValue(metadatosEncontrados);
    escanearTodoMock.mockRejectedValue(new Error('DynamoDB no disponible'));

    const respuesta = await handler(
      eventoFalso({ authorization: 'Bearer token', isbn: '9780000000006' }),
      {} as never,
      {} as never,
    );

    expect(scrapearSitioMock).not.toHaveBeenCalled();
    expect(respuesta).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ ...metadatosEncontrados, pvp: null }),
    });
  });
});

describe('handlerBuscar (/api/metadatos/buscar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLA_USUARIOS'] = 'babel-usuarios-test';
    verificarTokenDesdeHeaderMock.mockResolvedValue({ email: 'vendedor@letiende.co', uid: 'uid-1' });
    obtenerPorClaveMock.mockResolvedValue({ email: 'vendedor@letiende.co', rol: 'vendedor' });
    buscarLibrosPorTextoMock.mockResolvedValue([]);
    buscarLernerPorTextoMock.mockResolvedValue([]);
    buscarNacionalPorTextoMock.mockResolvedValue([]);
  });

  it('responde 401 sin token válido', async () => {
    verificarTokenDesdeHeaderMock.mockRejectedValue(new TokenInvalidoError('Falta el header.'));

    const respuesta = await handlerBuscar(
      eventoFalso({ query: { titulo: 'cien años de soledad' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 401 });
    expect(buscarLibrosPorTextoMock).not.toHaveBeenCalled();
  });

  it('responde 403 cuando el rol no es vendedor ni administrador', async () => {
    obtenerPorClaveMock.mockResolvedValue({ email: 'otro@letiende.co', rol: 'invitado' });

    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'cien años de soledad' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 403 });
    expect(buscarLibrosPorTextoMock).not.toHaveBeenCalled();
  });

  it('responde 400 cuando faltan tanto titulo como autor', async () => {
    const respuesta = await handlerBuscar(eventoFalso({ authorization: 'Bearer token' }), {} as never, {} as never);

    expect(respuesta).toMatchObject({ statusCode: 400 });
    expect(buscarLibrosPorTextoMock).not.toHaveBeenCalled();
  });

  it('responde 400 cuando titulo y autor vienen vacíos', async () => {
    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: '  ', autor: '' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 400 });
  });

  it('orquesta las 3 fuentes EN PARALELO y concatena api.letiende.co + Lerner + Nacional en ese orden', async () => {
    buscarLibrosPorTextoMock.mockResolvedValue([
      { titulo: 'De api.letiende.co', autor: null, editorial: null, portadaUrl: null, isbn: null },
    ]);
    buscarLernerPorTextoMock.mockResolvedValue([
      { titulo: 'De Lerner', autor: null, editorial: null, portadaUrl: null, isbn: null },
    ]);
    buscarNacionalPorTextoMock.mockResolvedValue([
      { titulo: 'De Nacional', autor: null, editorial: null, portadaUrl: null, isbn: null },
    ]);

    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'cien años de soledad' } }),
      {} as never,
      {} as never,
    );

    expect(buscarLibrosPorTextoMock).toHaveBeenCalledWith('cien años de soledad', null);
    const cuerpo = JSON.parse(respuesta.body as string) as { candidatos: Array<{ titulo: string }> };
    expect(cuerpo.candidatos.map((c) => c.titulo)).toEqual(['De api.letiende.co', 'De Lerner', 'De Nacional']);
    expect(respuesta).toMatchObject({ statusCode: 200 });
  });

  it('pasa titulo y autor a las 3 fuentes cuando ambos vienen', async () => {
    await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'titulo', autor: 'autor' } }),
      {} as never,
      {} as never,
    );

    expect(buscarLibrosPorTextoMock).toHaveBeenCalledWith('titulo', 'autor');
    expect(buscarLernerPorTextoMock).toHaveBeenCalledWith('titulo', 'autor');
    expect(buscarNacionalPorTextoMock).toHaveBeenCalledWith('titulo', 'autor');
  });

  it('cero candidatos en las 3 fuentes → 200 con candidatos: []', async () => {
    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'libro inexistente' } }),
      {} as never,
      {} as never,
    );

    expect(respuesta).toMatchObject({ statusCode: 200, body: JSON.stringify({ candidatos: [] }) });
  });

  it('si una fuente rechaza su promesa, Promise.all hace caer toda la respuesta a 500 (no degrada a 200)', async () => {
    buscarLernerPorTextoMock.mockRejectedValue(new Error('fallo inesperado de Lerner'));
    buscarLibrosPorTextoMock.mockResolvedValue([
      { titulo: 'De api.letiende.co', autor: null, editorial: null, portadaUrl: null, isbn: null },
    ]);

    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'titulo' } }),
      {} as never,
      {} as never,
    );

    // Como Promise.all rechaza si CUALQUIERA de las 3 promesas rechaza, el
    // handler cae en su catch genérico y responde 500 — documentado aquí
    // como comportamiento real: cada función de búsqueda YA nunca lanza por
    // contrato (CLAUDE.md A08), así que este caso solo ocurriría ante un bug
    // de programación en una de las 3, no ante un fallo normal de red/sitio.
    expect(respuesta).toMatchObject({ statusCode: 500 });
  });

  it('limita el total de candidatos a 20', async () => {
    const generarCandidatos = (prefijo: string, cantidad: number) =>
      Array.from({ length: cantidad }, (_valor, indice) => ({
        titulo: `${prefijo}-${indice}`,
        autor: null,
        editorial: null,
        portadaUrl: null,
        isbn: null,
      }));
    buscarLibrosPorTextoMock.mockResolvedValue(generarCandidatos('api', 10));
    buscarLernerPorTextoMock.mockResolvedValue(generarCandidatos('lerner', 10));
    buscarNacionalPorTextoMock.mockResolvedValue(generarCandidatos('nacional', 10));

    const respuesta = await handlerBuscar(
      eventoFalso({ authorization: 'Bearer token', query: { titulo: 'titulo' } }),
      {} as never,
      {} as never,
    );

    const cuerpo = JSON.parse(respuesta.body as string) as { candidatos: unknown[] };
    expect(cuerpo.candidatos).toHaveLength(20);
  });
});
