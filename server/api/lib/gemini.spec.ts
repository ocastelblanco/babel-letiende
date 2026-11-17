import { describe, expect, it, vi } from 'vitest';
import { crearProveedorLlm, ProveedorGemini } from './gemini';
import { ErrorProveedorLlm } from './proveedor-llm';

const CLAVE = 'clave-secreta-de-prueba';

function respuesta(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

function vector(n: number, valor = 0.1): number[] {
  return Array.from({ length: n }, () => valor);
}

function crear(fetchMock: ReturnType<typeof vi.fn>, extra = {}): ProveedorGemini {
  return new ProveedorGemini({
    claveApi: CLAVE,
    fetchImpl: fetchMock as unknown as typeof fetch,
    esperar: async () => undefined,
    ...extra,
  });
}

function cuerpoEnviado(fetchMock: ReturnType<typeof vi.fn>, llamada = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[llamada][1] as { body: string }).body) as Record<
    string,
    unknown
  >;
}

describe('ProveedorGemini — embeddings', () => {
  it('pide un vector por documento, con prefijo de documento y dimensión 768, y la clave solo en la cabecera', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respuesta({
        embeddings: [{ values: vector(768) }, { values: vector(768) }],
        usageMetadata: { promptTokenCount: 40 },
      }),
    );
    const resultado = await crear(fetchMock).incrustarDocumentos([
      { titulo: 'Cien años de soledad', texto: 'Macondo' },
      { titulo: null, texto: 'Sin título' },
    ]);

    expect(resultado.vectores).toHaveLength(2);
    expect(resultado.tokensEntrada).toBe(40);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
    );
    expect(url).not.toContain(CLAVE);
    expect(init.headers['x-goog-api-key']).toBe(CLAVE);
    const pedidos = cuerpoEnviado(fetchMock)['requests'] as {
      content: { parts: { text: string }[] };
      output_dimensionality: number;
    }[];
    expect(pedidos[0].content.parts[0].text).toBe('title: Cien años de soledad | text: Macondo');
    expect(pedidos[1].content.parts[0].text).toBe('title: none | text: Sin título');
    expect(pedidos[0].output_dimensionality).toBe(768);
    expect(JSON.stringify(cuerpoEnviado(fetchMock))).not.toContain('task_type');
  });

  it('la consulta lleva el prefijo de búsqueda', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuesta({ embeddings: [{ values: vector(768) }] }));
    await crear(fetchMock).incrustarConsulta('algo de fantasía');
    const pedidos = cuerpoEnviado(fetchMock)['requests'] as {
      content: { parts: { text: string }[] };
    }[];
    expect(pedidos[0].content.parts[0].text).toBe('task: search result | query: algo de fantasía');
  });

  it('parte en lotes de 50 y conserva el orden', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuesta({ embeddings: Array.from({ length: 50 }, () => ({ values: vector(768, 0.1) })) }),
      )
      .mockResolvedValueOnce(
        respuesta({ embeddings: Array.from({ length: 5 }, () => ({ values: vector(768, 0.2) })) }),
      );
    const documentos = Array.from({ length: 55 }, (_, i) => ({ titulo: `t${i}`, texto: 'x' }));
    const resultado = await crear(fetchMock).incrustarDocumentos(documentos);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.vectores).toHaveLength(55);
    expect(resultado.vectores[0][0]).toBe(0.1);
    expect(resultado.vectores[54][0]).toBe(0.2);
  });

  it('falla si el número de vectores no coincide con el de textos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuesta({ embeddings: [{ values: vector(768) }] }));
    await expect(
      crear(fetchMock).incrustarDocumentos([
        { titulo: 'a', texto: 'a' },
        { titulo: 'b', texto: 'b' },
      ]),
    ).rejects.toThrow(/1 vectores para 2/);
  });

  it('falla si la dimensión no es la esperada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuesta({ embeddings: [{ values: vector(3072) }] }));
    await expect(crear(fetchMock).incrustarConsulta('x')).rejects.toThrow(/dimensión inesperada/);
  });
});

describe('ProveedorGemini — generación (Interactions API)', () => {
  const peticion = {
    instrucciones: 'Eres un asistente.',
    mensajes: [
      { rol: 'usuario' as const, texto: 'hola' },
      { rol: 'asistente' as const, texto: 'qué buscas' },
      { rol: 'usuario' as const, texto: 'fantasía' },
    ],
    esquemaSalida: { type: 'object', properties: { texto: { type: 'string' } } },
    maximoTokensSalida: 500,
  };

  function interaccion(pasos: unknown[], estado = 'completed', uso: Record<string, number> = {}) {
    return respuesta({
      status: estado,
      steps: pasos,
      usage: { total_input_tokens: 38, total_output_tokens: 70, total_thought_tokens: 0, ...uso },
    });
  }
  const salida = (texto: string) => ({
    type: 'model_output',
    status: 'done',
    content: [{ type: 'text', text: texto }],
  });

  it('arma la petición con pasos user_input/model_output, sin estado, con esquema JSON, y la envía a /v1/interactions', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        interaccion([{ type: 'thought', signature: 'x' }, salida('{"texto":"ok"}')], 'completed', {
          total_thought_tokens: 8,
        }),
      );
    const r = await crear(fetchMock).generarJson(peticion);

    expect(r).toMatchObject({
      texto: '{"texto":"ok"}',
      tokensEntrada: 38,
      tokensSalida: 78,
      tokensPensamiento: 8,
      bloqueado: false,
      truncado: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1/interactions');
    expect(init.headers['x-goog-api-key']).toBe(CLAVE);
    expect(init.headers['Api-Revision']).toBe('2026-05-20');
    const cuerpo = cuerpoEnviado(fetchMock) as {
      model: string;
      system_instruction: string;
      store: boolean;
      input: { type: string; content: { text: string }[] }[];
      generation_config: Record<string, unknown>;
      response_format: Record<string, unknown>;
    };
    expect(cuerpo.model).toBe('gemini-3.5-flash-lite');
    expect(cuerpo.system_instruction).toBe('Eres un asistente.');
    expect(cuerpo.store).toBe(false);
    expect(cuerpo.input.map((paso) => paso.type)).toEqual([
      'user_input',
      'model_output',
      'user_input',
    ]);
    expect(cuerpo.input[2].content[0].text).toBe('fantasía');
    expect(cuerpo.generation_config).toEqual({ max_output_tokens: 500, thinking_level: 'low' });
    expect(cuerpo.response_format).toMatchObject({
      type: 'text',
      mime_type: 'application/json',
      schema: peticion.esquemaSalida,
    });
  });

  it('respeta el nivel de pensamiento pedido', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => interaccion([salida('{}')]));
    await crear(fetchMock).generarJson({ ...peticion, nivelPensamiento: 'minimal' });
    expect(
      (cuerpoEnviado(fetchMock)['generation_config'] as Record<string, unknown>)['thinking_level'],
    ).toBe('minimal');
  });

  it('une el texto de varios pasos model_output e ignora los pasos de pensamiento', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        interaccion([
          { type: 'thought', signature: 'x', summary: 'pienso' },
          salida('{"a":'),
          salida('1}'),
        ]),
      );
    expect((await crear(fetchMock).generarJson(peticion)).texto).toBe('{"a":1}');
  });

  it('marca como truncada una respuesta incompleta con texto', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => interaccion([salida('{"a"')], 'incomplete'));
    const r = await crear(fetchMock).generarJson(peticion);
    expect(r.truncado).toBe(true);
    expect(r.bloqueado).toBe(false);
  });

  it('una respuesta sin texto y sin terminar con normalidad se trata como bloqueada', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => interaccion([], 'failed'));
    const r = await crear(fetchMock).generarJson(peticion);
    expect(r.bloqueado).toBe(true);
    expect(r.texto).toBe('');
  });

  it('el pensamiento se suma a la salida (se factura como salida)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        interaccion([salida('{}')], 'completed', {
          total_output_tokens: 50,
          total_thought_tokens: 339,
        }),
      );
    const r = await crear(fetchMock).generarJson(peticion);
    expect(r.tokensSalida).toBe(389);
    expect(r.tokensPensamiento).toBe(339);
  });
});

describe('ProveedorGemini — errores', () => {
  it('reintenta ante 429 y 5xx y termina bien si se recupera', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429))
      .mockResolvedValueOnce(respuesta({ error: { status: 'UNAVAILABLE' } }, 503))
      .mockResolvedValueOnce(respuesta({ embeddings: [{ values: vector(768) }] }));
    const esperar = vi.fn().mockResolvedValue(undefined);
    const r = await crear(fetchMock, { esperar }).incrustarConsulta('x');
    expect(r.vectores).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('agota los reintentos y lanza un error reintentable sin texto del proveedor', async () => {
    const fetchMock = vi
      .fn()
      // Un Response solo se puede leer una vez: cada reintento necesita el suyo.
      .mockImplementation(async () =>
        respuesta(
          { error: { status: 'RESOURCE_EXHAUSTED', message: `clave ${CLAVE} agotada` } },
          429,
        ),
      );
    const error = (await crear(fetchMock)
      .incrustarConsulta('x')
      .catch((e: unknown) => e)) as ErrorProveedorLlm;
    expect(error).toBeInstanceOf(ErrorProveedorLlm);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.estadoHttp).toBe(429);
    expect(error.codigo).toBe('RESOURCE_EXHAUSTED');
    expect(error.reintentable).toBe(true);
    expect(error.message).not.toContain(CLAVE);
  });

  it('no reintenta un 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuesta({ error: { status: 'INVALID_ARGUMENT' } }, 400));
    const error = (await crear(fetchMock)
      .incrustarConsulta('x')
      .catch((e: unknown) => e)) as ErrorProveedorLlm;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.reintentable).toBe(false);
  });

  it('un fallo de red es reintentable y su mensaje es genérico', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error(`ECONNRESET con ${CLAVE}`));
    const error = (await crear(fetchMock)
      .incrustarConsulta('x')
      .catch((e: unknown) => e)) as ErrorProveedorLlm;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.message).toBe('No se pudo conectar con Gemini.');
  });
});

describe('crearProveedorLlm', () => {
  it('sin clave falla de entrada, sin llamar a nadie', () => {
    expect(() => crearProveedorLlm({})).toThrow(/clave/);
  });

  it('lee la clave y los modelos del entorno', () => {
    const proveedor = crearProveedorLlm({
      GEMINI_API_KEY: CLAVE,
      GEMINI_MODELO_TEXTO: 'otro-modelo',
    });
    expect(proveedor.modeloTexto).toBe('otro-modelo');
    expect(proveedor.modeloEmbeddings).toBe('gemini-embedding-2');
    expect(proveedor.nombre).toBe('gemini');
  });
});
