#!/usr/bin/env node
/**
 * Regression tests. Run with: node scripts/test.mjs
 *
 * The cache-semantics tests are the ones that matter. Normalising a provider's
 * usage wrongly does not throw — it produces a presentable, wrong number — so
 * the only defence is pinning real payload shapes and asserting they agree.
 */

import assert from 'node:assert/strict';
import { normaliseUsage, NORMALISERS } from './adapters/api-wrapper/node/index.mjs';
import { computeCost, billableTokens, allocateFlatRate, marginalCost } from './core/cost.mjs';
import { validateEvent, parseCsv, migrateRow, ulid } from './core/ledger.mjs';
import { toRawUsageRecords, aggregateToWorkUnit } from './adapters/claude-code-transcript.mjs';
import { indicators } from './core/report.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}
function group(name) { console.log(`\n${name}`); }

// ------------------------------------------------- cache semantics (critical)

group('Normalización de caché entre proveedores');

// The same real work, reported natively three different ways.
const NATIVE = {
  anthropic: { input_tokens: 1840, cache_read_input_tokens: 12400, output_tokens: 620 },
  openai: { prompt_tokens: 14240, prompt_tokens_details: { cached_tokens: 12400 }, completion_tokens: 620 },
  deepseek: { prompt_tokens: 14240, prompt_cache_hit_tokens: 12400, prompt_cache_miss_tokens: 1840, completion_tokens: 620 },
};
const EXPECTED = { input_uncached: 1840, cache_read: 12400, output: 620 };

for (const [provider, native] of Object.entries(NATIVE)) {
  test(`${provider}: payload nativo -> vocabulario canónico`, () => {
    const t = normaliseUsage(provider, native);
    assert.equal(t.input_uncached, EXPECTED.input_uncached);
    assert.equal(t.cache_read, EXPECTED.cache_read);
    assert.equal(t.output, EXPECTED.output);
  });
}

test('input_uncached y cache_read son disjuntos en los tres', () => {
  for (const [provider, native] of Object.entries(NATIVE)) {
    const t = normaliseUsage(provider, native);
    const declaredInput = native.input_tokens ?? native.prompt_tokens;
    const total = t.input_uncached + t.cache_read;
    // Anthropic reports input excluding cache; the others include it.
    const expectedTotal = provider === 'anthropic' ? declaredInput + t.cache_read : declaredInput;
    assert.equal(total, expectedTotal, `${provider}: ${total} != ${expectedTotal}`);
  }
});

test('OpenAI sin restar la caché daría 3.23x el costo real', () => {
  const pricing = { providers: { p: {
    cost_model: 'openai', status: 'ok', as_of: 'test',
    models: { m: { input: 1.00, cached_input: 0.10, output: 4.00 } },
  } } };
  const good = normaliseUsage('openai', NATIVE.openai);
  const naive = { ...good, input_uncached: NATIVE.openai.prompt_tokens };
  const a = computeCost({ provider: 'p', model: 'm', tokens: good, pricing }).usd;
  const b = computeCost({ provider: 'p', model: 'm', tokens: naive, pricing }).usd;
  assert.equal(a, 0.00556);
  assert.equal(b, 0.01796);
  assert.equal(Number((b / a).toFixed(2)), 3.23);
});

test('thinking es subconjunto de output, no un sumando', () => {
  const t = normaliseUsage('openai', {
    prompt_tokens: 100, completion_tokens: 620,
    completion_tokens_details: { reasoning_tokens: 180 },
  });
  assert.equal(t.output, 620);
  assert.equal(t.thinking, 180);
  assert.equal(billableTokens(t), 100 + 620, 'thinking no debe sumarse aparte');
});

test('todo proveedor declarado tiene normalizador', () => {
  for (const p of ['anthropic', 'openai', 'deepseek', 'google', 'alibaba', 'moonshot']) {
    assert.ok(NORMALISERS[p], `falta normalizador de ${p}`);
  }
});

// ------------------------------------------------------------- cost models

group('Modelos de costo');

test('los tres modelos coinciden con las mismas tarifas', () => {
  const pricing = { providers: {
    a: { cost_model: 'anthropic', status: 'ok', as_of: 't', models: { m: { input: 1, output: 4 } },
         cache_multipliers: { read: 0.1, write_short: 1.25, write_long: 2.0 } },
    o: { cost_model: 'openai', status: 'ok', as_of: 't', models: { m: { input: 1, cached_input: 0.1, output: 4 } } },
    d: { cost_model: 'deepseek', status: 'ok', as_of: 't', models: { m: { input_miss: 1, input_hit: 0.1, output: 4 } } },
  } };
  const tokens = normaliseUsage('anthropic', NATIVE.anthropic);
  const results = ['a', 'o', 'd'].map((p) => computeCost({ provider: p, model: 'm', tokens, pricing }).usd);
  assert.deepEqual(results, [0.00556, 0.00556, 0.00556]);
});

test('ejemplo real de Sonnet 5 con escritura de caché de 1h', () => {
  const pricing = { providers: { anthropic: {
    cost_model: 'anthropic', status: 'ok', as_of: '2026-06-24',
    models: { 'claude-sonnet-5': { input: 2.00, output: 10.00 } },
    cache_multipliers: { read: 0.1, write_short: 1.25, write_long: 2.0 },
  } } };
  const tokens = normaliseUsage('anthropic', {
    input_tokens: 2, output_tokens: 181,
    cache_creation: { ephemeral_1h_input_tokens: 55967, ephemeral_5m_input_tokens: 0 },
  });
  const r = computeCost({ provider: 'anthropic', model: 'claude-sonnet-5', tokens, pricing });
  assert.equal(r.usd, 0.225682);
});

test('multiplicador de caché por modelo se fusiona sobre el del proveedor (Opus 5.5)', () => {
  const pricing = { providers: { anthropic: {
    cost_model: 'anthropic', status: 'ok', as_of: '2026-09-22',
    models: { 'claude-opus-5-5': { input: 4.00, output: 20.00, cache_multipliers: { read: 0.05 } } },
    cache_multipliers: { read: 0.1, write_short: 1.25, write_long: 2.0 },
  } } };
  const tokens = { input_uncached: 1_000_000, cache_read: 1_000_000, cache_write_short: 1_000_000,
    cache_write_long: 1_000_000, output: 1_000_000 };
  const r = computeCost({ provider: 'anthropic', model: 'claude-opus-5-5', tokens, pricing });
  // 4 + 0.20 (lectura 0.05x) + 5 (escritura 5m) + 8 (escritura 1h) + 20
  assert.equal(r.usd, 37.2);
});

test('Sonnet 5.5 usa los multiplicadores de caché del proveedor (lectura 0.1x)', () => {
  const pricing = { providers: { anthropic: {
    cost_model: 'anthropic', status: 'ok', as_of: '2026-10-02',
    models: { 'claude-sonnet-5-5': { input: 2.00, output: 10.00 } },
    cache_multipliers: { read: 0.1, write_short: 1.25, write_long: 2.0 },
  } } };
  const tokens = { input_uncached: 1_000_000, cache_read: 1_000_000, cache_write_short: 1_000_000,
    cache_write_long: 1_000_000, output: 1_000_000 };
  const r = computeCost({ provider: 'anthropic', model: 'claude-sonnet-5-5', tokens, pricing });
  // 2 + 0.20 (lectura) + 2.50 (escritura 5m) + 4 (escritura 1h) + 10
  assert.equal(r.usd, 18.7);
});

test('precio sin verificar devuelve null, nunca una estimación', () => {
  const pricing = { providers: { openai: { cost_model: 'openai', status: 'unverified', models: {} } } };
  const r = computeCost({ provider: 'openai', model: 'x', tokens: normaliseUsage('openai', NATIVE.openai), pricing });
  assert.equal(r.usd, null);
  assert.match(r.reason, /unverified/);
});

test('proveedor desconocido devuelve null, no lanza', () => {
  const r = computeCost({ provider: 'nope', model: 'x', tokens: {}, pricing: { providers: {} } });
  assert.equal(r.usd, null);
});

test('costo marginal es cero bajo tarifa plana', () => {
  assert.equal(marginalCost('flat_rate', 12.34), 0);
  assert.equal(marginalCost('metered_api', 12.34), 12.34);
});

test('la cuota mensual se reparte por participación de tokens', () => {
  const mk = (id, input) => ({ event_id: id, tokens: {
    input_uncached: input, cache_read: 0, cache_write_short: 0, cache_write_long: 0, output: 0 } });
  const alloc = allocateFlatRate({ events: [mk('a', 300), mk('b', 100)], monthlyUsd: 200 });
  assert.equal(alloc.get('a'), 150);
  assert.equal(alloc.get('b'), 50);
});

test('sin cuota mensual no se reparte nada', () => {
  assert.equal(allocateFlatRate({ events: [], monthlyUsd: null }).size, 0);
});

// -------------------------------------------------------------- validation

group('Validación de eventos');

const baseEvent = () => ({
  schema_version: '1.0', event_id: ulid(), project_id: 'p',
  unit: { type: 'work_unit', turn_ids: [], aggregates: 1 },
  stage: 'backend', task_type: 'feature',
  actor: { role: 'ai', id: 'claude-sonnet-5', provider: 'anthropic', surface: 'claude-code-cli', device: 'cli', session_id: 's' },
  execution: { host: 'local' },
  time: { start: '2026-08-27T19:30:00Z', end: '2026-08-27T19:56:00Z', wall_s: 1560 },
  tokens: { input_uncached: 2, cache_read: 0, cache_write_short: 0, cache_write_long: 55967, output: 181, thinking: 0 },
  cost: null, outcome: { status: 'accepted' }, change: null, milestone: 'x',
  provenance: { measured: [], declared: [], derived: [], adapter: null, capture_level: 'N1', confidence: 'measured' },
});

test('un evento bien formado valida', () => assert.deepEqual(validateEvent(baseEvent()), []));

test('campo medido sin adaptador es inválido', () => {
  const e = baseEvent();
  e.provenance.measured = ['tokens'];
  assert.match(validateEvent(e).join(), /adapter is missing/);
});

test('cache_read null con input_uncached presente es inválido', () => {
  const e = baseEvent();
  e.tokens.cache_read = null;
  assert.match(validateEvent(e).join(), /disjoint/);
});

test('thinking mayor que output es inválido', () => {
  const e = baseEvent();
  e.tokens.thinking = 999;
  assert.match(validateEvent(e).join(), /subset/);
});

test('costo sin pricing_ref es inválido', () => {
  const e = baseEvent();
  e.cost = { usd: 1.23 };
  const errs = validateEvent(e).join();
  assert.match(errs, /pricing_ref/);
  assert.match(errs, /cost_model/);
});

test('aggregates debe coincidir con turn_ids', () => {
  const e = baseEvent();
  e.unit = { type: 'work_unit', turn_ids: ['a', 'b'], aggregates: 3 };
  assert.match(validateEvent(e).join(), /aggregates/);
});

test('fin anterior al inicio es inválido', () => {
  const e = baseEvent();
  e.time.end = '2026-08-27T19:00:00Z';
  assert.match(validateEvent(e).join(), /before/);
});

test('capture_level es obligatorio', () => {
  const e = baseEvent();
  delete e.provenance.capture_level;
  assert.match(validateEvent(e).join(), /capture_level/);
});

// ----------------------------------------------------------------- csv/migration

group('Migración de CSV heredado');

const CSV = [
  'stage,start,finish,time,role,model,milestone,tool,device,effort',
  'Backend,27/08/2026 19:56,27/08/2026 20:27,0:31:00,AI,Sonnet 5,"Borra el evento, agrega placeholder",Claude Code,cli,medium',
  'Cloud infraestructure,02/08/2026 9:09,02/08/2026 10:09,1:00:00,human,OCM,Config DNS,AWS Console,web,high',
].join('\n');

test('el parser respeta comas dentro de comillas', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].milestone, 'Borra el evento, agrega placeholder');
});

test('la fila migrada valida y no inventa tokens ni costo', () => {
  const { event } = migrateRow(parseCsv(CSV)[0], { projectId: 'p' });
  assert.deepEqual(validateEvent(event), []);
  assert.equal(event.tokens, null);
  assert.equal(event.cost, null);
  assert.equal(event.provenance.capture_level, 'N0');
  assert.equal(event.provenance.confidence, 'legacy');
});

test('la hora local se convierte a UTC con el desfase declarado', () => {
  const { event } = migrateRow(parseCsv(CSV)[0], { projectId: 'p', offsetHours: -5 });
  assert.equal(event.time.start, '2026-08-28T00:56:00.000Z');
});

test('el esfuerzo heredado pasa a cognitive_load, no a actor.effort', () => {
  const { event } = migrateRow(parseCsv(CSV)[0], { projectId: 'p' });
  assert.equal(event.outcome.cognitive_load, 'medium');
  assert.equal(event.actor.effort, null);
});

test('las variantes tipográficas de stage se normalizan', () => {
  const { event } = migrateRow(parseCsv(CSV)[1], { projectId: 'p' });
  assert.equal(event.stage, 'cloud_infrastructure');
});

test('el proveedor y la superficie se infieren y quedan como derived', () => {
  const { event } = migrateRow(parseCsv(CSV)[0], { projectId: 'p' });
  assert.equal(event.actor.provider, 'anthropic');
  assert.equal(event.actor.surface, 'claude-code-cli');
  assert.ok(event.provenance.derived.includes('actor.provider'));
});

test('una duración inconsistente se reporta, no se corrige', () => {
  const rows = parseCsv(CSV.replace('0:31:00', '9:99:00'));
  const { warnings } = migrateRow(rows[0], { projectId: 'p' });
  assert.ok(warnings.length > 0);
});

// ------------------------------------------------------------- transcript

group('Adaptador de transcripto');

const TRANSCRIPT = [
  { type: 'user', timestamp: '2026-08-31T10:00:00.000Z', isMeta: false, promptId: 'p1' },
  { type: 'assistant', timestamp: '2026-08-31T10:00:30.000Z', promptId: 'p1', sessionId: 's1', effort: 'high',
    isSidechain: false, message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100,
      cache_read_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
      output_tokens_details: { thinking_tokens: 40 } } } },
  { type: 'user', timestamp: '2026-08-31T10:03:00.000Z', isMeta: false, promptId: 'p2' },
  { type: 'assistant', timestamp: '2026-08-31T10:03:20.000Z', promptId: 'p2', sessionId: 's1', effort: 'high',
    isSidechain: false, message: { model: 'claude-opus-5', usage: { input_tokens: 5, output_tokens: 50,
      cache_read_input_tokens: 700, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } } } },
  { type: 'user', timestamp: '2026-08-31T18:00:00.000Z', isMeta: false, promptId: 'p3' },
];

test('agrupa turnos por promptId', () => {
  assert.equal(toRawUsageRecords(TRANSCRIPT).length, 2);
});

test('agent_active cuenta desde el prompt del humano, no desde el primer mensaje', () => {
  const turns = toRawUsageRecords(TRANSCRIPT);
  assert.equal(turns[0].agent_active_s, 30, 'un turno de un solo mensaje no puede durar 0 s');
});

test('el hueco corto cuenta como revisión', () => {
  const turns = toRawUsageRecords(TRANSCRIPT);
  assert.equal(turns[0].human_review_s, 150);
  assert.equal(turns[0].human_wait_s, 0);
});

test('el hueco largo cuenta como ausencia, no como revisión', () => {
  const turns = toRawUsageRecords(TRANSCRIPT, { reviewGapMaxS: 900 });
  assert.equal(turns[1].human_review_s, null);
  assert.ok(turns[1].human_wait_s > 900);
});

test('wall_s del agregado es el lapso, no la suma de turnos', () => {
  const agg = aggregateToWorkUnit(toRawUsageRecords(TRANSCRIPT));
  assert.equal(agg.wall_s, 200, 'lapso 10:00:00 -> 10:03:20');
  assert.equal(agg.agent_active_s, 50, 'suma de turnos: 30 + 20');
  assert.ok(agg.wall_s > agg.agent_active_s, 'el lapso incluye el hueco de revisión');
});

test('los tokens del agregado sí se suman', () => {
  const agg = aggregateToWorkUnit(toRawUsageRecords(TRANSCRIPT));
  assert.equal(agg.tokens.cache_read, 1200);
  assert.equal(agg.tokens.output, 150);
  assert.equal(agg.tokens.cache_write_long, 200);
});

test('el contable cuadra: activo + revisión + espera <= lapso total', () => {
  const turns = toRawUsageRecords(TRANSCRIPT);
  const agg = aggregateToWorkUnit(turns);
  const accounted = agg.agent_active_s + (agg.human_review_s ?? 0);
  assert.ok(accounted <= agg.wall_s, `${accounted} > ${agg.wall_s}`);
});

// ------------------------------------------------------------------ report

group('Indicadores');

test('los indicadores sin datos son null, nunca cero', () => {
  const i = indicators([{ time: {}, outcome: {}, tokens: null, cost: null }]);
  assert.equal(i.VT, null);
  assert.equal(i.CPAC, null);
  assert.equal(i.CE, null);
});

test('VT y OR se calculan con datos completos', () => {
  const evs = [{
    time: { agent_active_s: 1000, human_review_s: 400, human_active_s: 400, wall_s: 1400 },
    outcome: { status: 'accepted' },
    tokens: { input_uncached: 100, cache_read: 900 },
    cost: { usd: 1.0 },
  }];
  const i = indicators(evs);
  assert.equal(i.VT, 0.4);
  assert.equal(i.OR, 400 / 1400);
  assert.equal(i.CE, 0.9);
  assert.equal(i.CPAC, 1.0);
});

test('la cobertura de costo se reporta como fracción', () => {
  const i = indicators([{ time: {}, outcome: {}, cost: { usd: 1 } }, { time: {}, outcome: {}, cost: null }]);
  assert.equal(i._cost_coverage, 0.5);
});

// ---------------------------------------------------------------------- end

console.log(`\n${passed} pasaron, ${failed} fallaron`);
process.exitCode = failed ? 1 : 0;
