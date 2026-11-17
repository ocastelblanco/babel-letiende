#!/usr/bin/env node
/**
 * Verifica contra la API real de Gemini el contrato que va a usar el asistente
 * (T-0021): modelos disponibles, embeddings y generación con salida JSON.
 *
 * Existe porque la documentación oficial cambió (ahora describe la «Interactions
 * API») y no se debe escribir un cliente sobre un contrato supuesto. Solo envía
 * textos sintéticos de prueba, nunca datos reales ni de visitantes.
 *
 * Imprime únicamente estados HTTP, nombres de campos, tamaños y cifras de uso.
 * Nunca imprime la clave ni el contenido de las respuestas del modelo.
 *
 *   GEMINI_API_KEY=... node asistente-ia/scripts/verificar-gemini.mjs
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CLAVE = process.env.GEMINI_API_KEY;
const MODELO_TEXTO = process.env.GEMINI_MODELO_TEXTO ?? 'gemini-3.5-flash-lite';
const MODELO_EMBEDDINGS = process.env.GEMINI_MODELO_EMBEDDINGS ?? 'gemini-embedding-2';

if (!CLAVE) {
  console.error('Falta GEMINI_API_KEY.');
  process.exit(1);
}

/** Forma de un valor sin su contenido: claves, tipos y largos. */
function forma(valor, profundidad = 0) {
  if (Array.isArray(valor)) {
    return profundidad > 3 ? `array(${valor.length})` : [`array(${valor.length})`, valor.length > 0 ? forma(valor[0], profundidad + 1) : null];
  }
  if (valor && typeof valor === 'object') {
    if (profundidad > 3) return 'object';
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, forma(v, profundidad + 1)]));
  }
  if (typeof valor === 'string') return `string(${valor.length})`;
  return typeof valor === 'number' || typeof valor === 'boolean' ? valor : String(valor);
}

async function llamar(nombre, metodo, ruta, cuerpo, extraCabeceras = {}) {
  const inicio = Date.now();
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { 'x-goog-api-key': CLAVE, 'Content-Type': 'application/json', ...extraCabeceras },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch (error) {
    console.log(`\n## ${nombre}\nERROR de red: ${error instanceof Error ? error.message : 'desconocido'}`);
    return { ok: false };
  }
  const texto = await respuesta.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // respuesta no JSON
  }
  console.log(`\n## ${nombre}\nHTTP ${respuesta.status} en ${Date.now() - inicio} ms`);
  if (!respuesta.ok) {
    const error = json?.error;
    console.log(`error.status=${error?.status ?? '?'} error.message=${String(error?.message ?? texto).slice(0, 300)}`);
    return { ok: false, json };
  }
  return { ok: true, json };
}

function norma(vector) {
  return Math.sqrt(vector.reduce((suma, x) => suma + x * x, 0));
}

// 1. Modelos que la clave puede ver
{
  const r = await llamar('Modelos disponibles', 'GET', '/models?pageSize=200');
  if (r.ok) {
    const ids = (r.json.models ?? []).map((m) => m.name.replace('models/', ''));
    const interes = ids.filter((id) => /^gemini-(embedding|3\.5|3\.1|3\.6|3\.8|4)/.test(id));
    console.log(`total=${ids.length}; de interés: ${interes.join(', ')}`);
    for (const id of [MODELO_TEXTO, MODELO_EMBEDDINGS]) {
      console.log(`${id}: ${ids.includes(id) ? 'disponible' : 'NO aparece en la lista'}`);
    }
  }
}

// 2. Embeddings: un texto, dimensión reducida, sin task_type (gemini-embedding-2 no lo admite)
{
  const texto = 'title: Cien años de soledad | text: La historia de la familia Buendía en Macondo.';
  const r = await llamar('embedContent (768 dim)', 'POST', `/models/${MODELO_EMBEDDINGS}:embedContent`, {
    content: { parts: [{ text: texto }] },
    output_dimensionality: 768,
  });
  if (r.ok) {
    console.log('forma:', JSON.stringify(forma(r.json)));
    const valores = r.json.embedding?.values ?? r.json.embeddings?.[0]?.values;
    if (Array.isArray(valores)) {
      console.log(`dimensión=${valores.length} norma=${norma(valores).toFixed(4)} (1.0000 = ya normalizado)`);
    }
  }
}

// 3. Embeddings en lote: un vector por texto
{
  const r = await llamar('batchEmbedContents (2 textos)', 'POST', `/models/${MODELO_EMBEDDINGS}:batchEmbedContents`, {
    requests: ['uno', 'dos'].map((t) => ({
      model: `models/${MODELO_EMBEDDINGS}`,
      content: { parts: [{ text: `title: none | text: libro de prueba ${t}` }] },
      output_dimensionality: 768,
    })),
  });
  if (r.ok) {
    console.log('forma:', JSON.stringify(forma(r.json)));
  }
}

const ESQUEMA = {
  type: 'object',
  properties: {
    texto: { type: 'string' },
    recomendaciones: {
      type: 'array',
      items: { type: 'object', properties: { bookId: { type: 'string' }, motivo: { type: 'string' } }, required: ['bookId', 'motivo'] },
    },
    sinResultados: { type: 'boolean' },
  },
  required: ['texto', 'recomendaciones', 'sinResultados'],
};
const SISTEMA = 'Eres un asistente de prueba. Responde solo con el JSON pedido.';
const PREGUNTA = 'Recomiéndame un libro de la lista: [{"bookId":"a1","titulo":"Prueba"}].';

// 4. Interactions API (la que describe la documentación actual)
for (const nivel of ['minimal', 'low']) {
  const r = await llamar(
    `Interactions API (thinking_level=${nivel})`,
    'POST',
    '/interactions',
    {
      model: MODELO_TEXTO,
      system_instruction: SISTEMA,
      input: PREGUNTA,
      store: false,
      generation_config: { max_output_tokens: 400, thinking_level: nivel },
      response_format: { type: 'text', mime_type: 'application/json', schema: ESQUEMA },
    },
    { 'Api-Revision': '2026-05-20' },
  );
  if (r.ok) {
    console.log('forma:', JSON.stringify(forma(r.json)));
    break;
  }
}

// 5. generateContent clásico (para saber si sigue vivo y cómo reporta el uso)
{
  const r = await llamar('generateContent clásico', 'POST', `/models/${MODELO_TEXTO}:generateContent`, {
    systemInstruction: { parts: [{ text: SISTEMA }] },
    contents: [{ role: 'user', parts: [{ text: PREGUNTA }] }],
    generationConfig: { maxOutputTokens: 400, responseMimeType: 'application/json', responseSchema: ESQUEMA },
  });
  if (r.ok) {
    console.log('forma:', JSON.stringify(forma(r.json)));
    console.log('usageMetadata:', JSON.stringify(r.json.usageMetadata ?? null));
    const salida = r.json.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      const objeto = JSON.parse(salida);
      console.log(`la salida es JSON válido; claves: ${Object.keys(objeto).join(', ')}`);
    } catch {
      console.log('la salida NO es JSON válido');
    }
  }
}
