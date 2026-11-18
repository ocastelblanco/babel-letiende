#!/usr/bin/env node
/**
 * Verifica contra la API real de Gemini cómo funciona el llamado de herramientas
 * (function calling) en la Interactions API estable, para la Fase 3 del asistente
 * (T-0030). La documentación se leyó solo en parte y no dice qué estado tiene una
 * interacción que espera el resultado de una herramienta, ni si hay que devolver los
 * pasos de pensamiento: se comprueba aquí en vez de suponerlo.
 *
 * Solo textos sintéticos y herramientas de mentira. Imprime estados HTTP, nombres de
 * campos y los argumentos que el modelo pone a las herramientas de prueba (sintéticos);
 * nunca la clave.
 *
 *   GEMINI_API_KEY=... node asistente-ia/scripts/verificar-herramientas-gemini.mjs
 */

const URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const CLAVE = process.env.GEMINI_API_KEY;
const MODELO = process.env.GEMINI_MODELO_TEXTO ?? 'gemini-3.5-flash-lite';

if (!CLAVE) {
  console.error('Falta GEMINI_API_KEY.');
  process.exit(1);
}

const hallazgos = [];
const anotar = (clave, valor) => {
  hallazgos.push([clave, valor]);
  console.log(`   => ${clave}: ${valor}`);
};

const HERRAMIENTAS = [
  {
    type: 'function',
    name: 'buscar_libros',
    description: 'Busca libros disponibles en el inventario de la librería por tema o descripción.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué busca la persona.' },
        idioma: { type: 'string', description: 'Código de idioma, por ejemplo es o en.' },
        precio_maximo: { type: 'number', description: 'Precio máximo en pesos colombianos.' },
      },
      required: ['consulta'],
    },
  },
  {
    type: 'function',
    name: 'consultar_disponibilidad',
    description: 'Consulta precio y existencias actuales de libros por su identificador.',
    parameters: {
      type: 'object',
      properties: { book_ids: { type: 'array', items: { type: 'string' } } },
      required: ['book_ids'],
    },
  },
];

const SISTEMA =
  'Eres un asistente de una librería. Usa las herramientas para consultar el inventario; nunca inventes libros ni precios.';

const usuario = (texto) => ({ type: 'user_input', content: [{ type: 'text', text: texto }] });

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
/** La clave de staging es de nivel gratuito (15 peticiones por minuto): se deja un margen entre llamadas. */
const PAUSA_ENTRE_LLAMADAS_MS = 5000;
let ultimaLlamada = 0;

async function interaccion(nombre, cuerpo) {
  const inicio = Date.now();
  let r;
  let texto;
  for (let intento = 0; intento < 4; intento += 1) {
    const espera = ultimaLlamada + PAUSA_ENTRE_LLAMADAS_MS - Date.now();
    if (espera > 0) await esperar(espera);
    r = await fetch(URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': CLAVE, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({ model: MODELO, store: false, system_instruction: SISTEMA, ...cuerpo }),
    });
    ultimaLlamada = Date.now();
    texto = await r.text();
    if (r.status !== 429 && r.status < 500) break;
    console.log(`   (HTTP ${r.status}, se espera y se reintenta: intento ${intento + 1})`);
    await esperar(r.status === 429 ? 40_000 : 12_000);
  }
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // no JSON
  }
  console.log(`\n## ${nombre}\nHTTP ${r.status} en ${Date.now() - inicio} ms`);
  if (!r.ok) {
    console.log(`   error: ${json?.error?.status ?? '?'} — ${String(json?.error?.message ?? texto).slice(0, 300)}`);
  }
  return { ok: r.ok, estado: r.status, json };
}

const tiposDePasos = (json) => (json?.steps ?? []).map((p) => p.type).join(', ') || '(sin pasos)';
const llamadas = (json) => (json?.steps ?? []).filter((p) => p.type === 'function_call');
const textoFinal = (json) =>
  (json?.steps ?? [])
    .filter((p) => p.type === 'model_output')
    .flatMap((p) => p.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');

// ---------------------------------------------------------------------------
// A. Declaración plana en `tools` y forma del function_call
// ---------------------------------------------------------------------------
const peticionA = {
  input: [usuario('Necesito un libro de fantasía en inglés que cueste menos de 50000 pesos.')],
  tools: HERRAMIENTAS,
  generation_config: { max_output_tokens: 600, thinking_level: 'low' },
};
const A = await interaccion('A. declaración plana en `tools`', peticionA);
if (!A.ok) {
  console.log('\nSin la declaración básica no hay nada más que probar.');
  process.exit(1);
}
const llamadaA = llamadas(A.json)[0];
anotar('A.status', A.json.status);
anotar('A.pasos', tiposDePasos(A.json));
anotar('A.function_call.campos', llamadaA ? Object.keys(llamadaA).join(',') : 'NO HAY function_call');
anotar('A.arguments.tipo', llamadaA ? typeof llamadaA.arguments : '-');
anotar('A.arguments', llamadaA ? JSON.stringify(llamadaA.arguments) : '-');
anotar('A.id', llamadaA?.id ? 'presente' : 'ausente');
anotar('A.uso', JSON.stringify(A.json.usage ?? {}));
if (!llamadaA) {
  process.exit(1);
}

const resultadoBuscar = {
  libros: [
    { book_id: 'l-1', titulo: 'The Hobbit (prueba)', precio: 45000, existencias: 2 },
    { book_id: 'l-2', titulo: 'Un libro inventado de prueba', precio: 30000, existencias: 1 },
  ],
};

const pasosEco = A.json.steps; // todos los pasos tal como llegaron (con pensamiento, si lo hubo)
const sinPensamiento = pasosEco.filter((p) => p.type !== 'thought');

/** Devuelve el resultado de la llamada y pide la respuesta final. */
async function continuar(nombre, pasosPrevios, resultadoPaso, extra = {}) {
  const r = await interaccion(nombre, {
    input: [usuario(peticionA.input[0].content[0].text), ...pasosPrevios, ...resultadoPaso],
    tools: HERRAMIENTAS,
    generation_config: { max_output_tokens: 600, thinking_level: 'low' },
    ...extra,
  });
  if (r.ok) {
    anotar(`${nombre.split('.')[0]}.status`, r.json.status);
    anotar(`${nombre.split('.')[0]}.pasos`, tiposDePasos(r.json));
    anotar(`${nombre.split('.')[0]}.texto`, `${textoFinal(r.json).length} caracteres${textoFinal(r.json).includes('Hobbit') ? ', usa el dato de la herramienta' : ', NO usa el dato'}`);
  }
  return r;
}

const paso = (formaResultado) => [
  { type: 'function_result', name: llamadaA.name, call_id: llamadaA.id, result: formaResultado },
];

// ---------------------------------------------------------------------------
// B. Devolver el resultado sin estado: ¿qué hay que reenviar y en qué forma?
// ---------------------------------------------------------------------------
await continuar('B1. todos los pasos + resultado como lista de partes de texto', pasosEco, paso([{ type: 'text', text: JSON.stringify(resultadoBuscar) }]));
await continuar('B2. sin pasos de pensamiento + resultado como lista de partes', sinPensamiento, paso([{ type: 'text', text: JSON.stringify(resultadoBuscar) }]));
await continuar('B3. todos los pasos + resultado como texto plano', pasosEco, paso(JSON.stringify(resultadoBuscar)));
await continuar('B4. todos los pasos + resultado como objeto', pasosEco, paso(resultadoBuscar));
await continuar('B5. solo el function_call (sin model_output ni pensamiento) + resultado como lista de partes', [llamadaA], paso([{ type: 'text', text: JSON.stringify(resultadoBuscar) }]));

// Un fallo de herramienta también se devuelve como resultado
await continuar('B6. la herramienta falló (resultado de error controlado)', pasosEco, paso([{ type: 'text', text: JSON.stringify({ error: 'servicio_no_disponible' }) }]));

// ---------------------------------------------------------------------------
// C. Herramientas + salida JSON con esquema en la misma petición
// ---------------------------------------------------------------------------
const esquema = {
  type: 'object',
  properties: { texto: { type: 'string' }, recomendaciones: { type: 'array', items: { type: 'object', properties: { bookId: { type: 'string' }, motivo: { type: 'string' } }, required: ['bookId', 'motivo'] } }, sinResultados: { type: 'boolean' } },
  required: ['texto', 'recomendaciones', 'sinResultados'],
};
const formatoJson = { type: 'text', mime_type: 'application/json', schema: esquema };

const C1 = await interaccion('C1. herramientas + response_format en el primer turno', { ...peticionA, response_format: formatoJson });
if (C1.ok) {
  anotar('C1.pasos', tiposDePasos(C1.json));
  anotar('C1.status', C1.json.status);
  anotar('C1.hay_function_call', String(llamadas(C1.json).length > 0));
}
const llamadaC = C1.ok ? llamadas(C1.json)[0] : undefined;
if (llamadaC) {
  const C2 = await interaccion('C2. respuesta final con herramientas + response_format', {
    input: [usuario(peticionA.input[0].content[0].text), ...C1.json.steps, { type: 'function_result', name: llamadaC.name, call_id: llamadaC.id, result: [{ type: 'text', text: JSON.stringify(resultadoBuscar) }] }],
    tools: HERRAMIENTAS,
    generation_config: { max_output_tokens: 600, thinking_level: 'low' },
    response_format: formatoJson,
  });
  if (C2.ok) {
    let objeto = null;
    try {
      objeto = JSON.parse(textoFinal(C2.json));
    } catch {
      // se reporta abajo
    }
    anotar('C2.status', C2.json.status);
    anotar('C2.salida_es_json_con_esquema', String(Boolean(objeto && Array.isArray(objeto.recomendaciones) && typeof objeto.sinResultados === 'boolean')));
    anotar('C2.bookId_recomendados', JSON.stringify((objeto?.recomendaciones ?? []).map((r) => r.bookId)));
  }
}

if (llamadaC) {
  const C3 = await interaccion('C3. respuesta final SIN tools, solo response_format (con la historia de la llamada en el input)', {
    input: [usuario(peticionA.input[0].content[0].text), ...C1.json.steps, { type: 'function_result', name: llamadaC.name, call_id: llamadaC.id, result: [{ type: 'text', text: JSON.stringify(resultadoBuscar) }] }],
    generation_config: { max_output_tokens: 600, thinking_level: 'low' },
    response_format: formatoJson,
  });
  if (C3.ok) {
    let objeto = null;
    try {
      objeto = JSON.parse(textoFinal(C3.json));
    } catch {
      // se reporta abajo
    }
    anotar('C3.status', C3.json.status);
    anotar('C3.salida_es_json_con_esquema', String(Boolean(objeto && Array.isArray(objeto.recomendaciones) && typeof objeto.sinResultados === 'boolean')));
  }
}

// ---------------------------------------------------------------------------
// D. tool_choice
// ---------------------------------------------------------------------------
const D1 = await interaccion('D1. tool_choice any con lista permitida (generation_config.tool_choice.allowed_tools)', {
  input: [usuario('Hola, ¿cómo estás?')],
  tools: HERRAMIENTAS,
  generation_config: { max_output_tokens: 300, thinking_level: 'low', tool_choice: { allowed_tools: { mode: 'any', tools: ['buscar_libros'] } } },
});
if (D1.ok) {
  anotar('D1.pasos', tiposDePasos(D1.json));
  anotar('D1.fuerza_la_llamada', String(llamadas(D1.json).length > 0));
}
const D2 = await interaccion('D2. sin tool_choice, saludo sin necesidad de herramienta', {
  input: [usuario('Hola, ¿cómo estás?')],
  tools: HERRAMIENTAS,
  generation_config: { max_output_tokens: 300, thinking_level: 'low' },
});
if (D2.ok) {
  anotar('D2.pasos', tiposDePasos(D2.json));
  anotar('D2.llama_herramienta_sin_necesidad', String(llamadas(D2.json).length > 0));
}

// ---------------------------------------------------------------------------
// E. Llamadas en paralelo
// ---------------------------------------------------------------------------
const E1 = await interaccion('E1. dos necesidades independientes', {
  input: [usuario('Busca un libro de cocina colombiana y, aparte, consulta el precio y las existencias de los libros l-7 y l-8.')],
  tools: HERRAMIENTAS,
  generation_config: { max_output_tokens: 600, thinking_level: 'low' },
});
if (E1.ok) {
  const lls = llamadas(E1.json);
  anotar('E1.pasos', tiposDePasos(E1.json));
  anotar('E1.llamadas', `${lls.length}: ${lls.map((l) => l.name).join(', ')}`);
  anotar('E1.ids_distintos', String(new Set(lls.map((l) => l.id)).size === lls.length));
  if (lls.length >= 1) {
    const resultados = lls.map((l) => ({
      type: 'function_result',
      name: l.name,
      call_id: l.id,
      result: [{ type: 'text', text: JSON.stringify(l.name === 'buscar_libros' ? resultadoBuscar : { libros: [{ book_id: 'l-7', precio: 25000, existencias: 1 }, { book_id: 'l-8', precio: 38000, existencias: 0 }] }) }],
    }));
    const E2 = await interaccion('E2. devolver todos los resultados en una sola petición', {
      input: [usuario(E1.json.steps.length ? 'Busca un libro de cocina colombiana y, aparte, consulta el precio y las existencias de los libros l-7 y l-8.' : ''), ...E1.json.steps, ...resultados],
      tools: HERRAMIENTAS,
      generation_config: { max_output_tokens: 600, thinking_level: 'low' },
    });
    if (E2.ok) {
      anotar('E2.status', E2.json.status);
      anotar('E2.pasos', tiposDePasos(E2.json));
      anotar('E2.texto', `${textoFinal(E2.json).length} caracteres`);
    }
  }
}

// ---------------------------------------------------------------------------
// F. Argumentos que no cumplen el esquema (para decidir cuánto validar en el servidor)
// ---------------------------------------------------------------------------
const F = await interaccion('F. consulta absurda: ¿el modelo respeta los tipos?', {
  input: [usuario('Busca libros baratos, que cuesten como mucho "doce mil pesos colombianos", en francés.')],
  tools: HERRAMIENTAS,
  generation_config: { max_output_tokens: 400, thinking_level: 'low' },
});
if (F.ok) {
  const l = llamadas(F.json)[0];
  anotar('F.arguments', l ? JSON.stringify(l.arguments) : 'sin llamada');
  anotar('F.precio_maximo.tipo', l ? typeof l.arguments?.precio_maximo : '-');
}

console.log('\n==== RESUMEN ====');
for (const [clave, valor] of hallazgos) {
  console.log(`${clave}: ${valor}`);
}
