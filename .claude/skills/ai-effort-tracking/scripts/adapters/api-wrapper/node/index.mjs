/**
 * Adapter: any SDK client -> RawUsageRecord (capture level N1 equivalent).
 *
 * The highest-fidelity adapter there is: when you own the client, `usage`
 * arrives in the response and nothing has to be reconstructed.
 *
 * The whole point of this file is the normaliser table below. Three providers
 * count cache tokens with mutually incompatible semantics, and getting it wrong
 * does not throw — it produces a presentable, wrong number.
 * See references/adapter-contract.md.
 *
 *   import { wrap } from './index.mjs';
 *   const client = wrap(new OpenAI(), { provider: 'deepseek', dir: 'metrics/events' });
 */

import fs from 'node:fs';
import path from 'node:path';

export const ADAPTER_ID = 'api-wrapper-node@1.0.0';

const empty = () => ({
  input_uncached: 0, cache_read: 0, cache_write_short: 0,
  cache_write_long: 0, output: 0, thinking: 0,
});

/**
 * Per-provider normalisers into the canonical vocabulary, where
 * `input_uncached` and `cache_read` are DISJOINT and `thinking` is a SUBSET
 * of `output`.
 */
export const NORMALISERS = {
  /** `input_tokens` already excludes cache — nothing to subtract. */
  anthropic(u) {
    return {
      ...empty(),
      input_uncached: u.input_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write_short: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      cache_write_long: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      thinking: u.output_tokens_details?.thinking_tokens ?? 0,
    };
  },

  /** `cached_tokens` is a SUBSET of `prompt_tokens`: subtract, or you pay twice. */
  openai(u) {
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      ...empty(),
      input_uncached: Math.max(0, (u.prompt_tokens ?? 0) - cached),
      cache_read: cached,
      output: u.completion_tokens ?? 0,
      thinking: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  },

  /** `prompt_tokens` = hit + miss, and hit/miss are billed at different rates. */
  deepseek(u) {
    const hit = u.prompt_cache_hit_tokens ?? 0;
    const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
    return {
      ...empty(),
      input_uncached: miss,
      cache_read: hit,
      output: u.completion_tokens ?? 0,
      thinking: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  },

  /** Field names not verified against Google's docs — validate before trusting. */
  google(u) {
    const m = u.usageMetadata ?? u;
    const cached = m.cachedContentTokenCount ?? 0;
    return {
      ...empty(),
      input_uncached: Math.max(0, (m.promptTokenCount ?? 0) - cached),
      cache_read: cached,
      output: m.candidatesTokenCount ?? 0,
      thinking: m.thoughtsTokenCount ?? 0,
    };
  },
};

// Format compatibility is not billing compatibility: these reuse OpenAI's
// shape but need their own verified rates in pricing.json.
NORMALISERS.alibaba = NORMALISERS.openai;
NORMALISERS.moonshot = NORMALISERS.openai;

export function normaliseUsage(provider, usage) {
  const fn = NORMALISERS[provider];
  if (!fn) throw new Error(`no normaliser for provider "${provider}" — see adapter-contract.md`);
  if (!usage) return null;
  return fn(usage);
}

/** Only counts and identifiers are kept. Prompts and responses never reach the ledger. */
function safeRaw(usage, model) {
  return { model, usage };
}

function sessionFile(dir, sessionId, when) {
  const date = when.toISOString().slice(0, 10);
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(dir, `${date}--${safe}.jsonl`);
}

function writeRecord(dir, sessionId, record) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    sessionFile(dir, sessionId, new Date(record.started_at)),
    JSON.stringify(record) + '\n',
    'utf8',
  );
}

/**
 * Wrap a client so every completion call emits a RawUsageRecord.
 *
 * @param {object} client        an SDK client (OpenAI, Anthropic, or compatible)
 * @param {object} opts
 * @param {string} opts.provider key into NORMALISERS and into pricing.json
 * @param {string} [opts.surface='custom-api-client']
 * @param {string} [opts.dir='metrics/events']
 * @param {string} [opts.sessionId]
 * @param {string} [opts.traceId] task id from TODO.md
 * @param {(record) => void} [opts.onRecord] receive records instead of writing them
 */
export function wrap(client, opts) {
  const {
    provider,
    surface = 'custom-api-client',
    dir = 'metrics/events',
    sessionId = `api-${Date.now().toString(36)}`,
    traceId = null,
    onRecord,
  } = opts ?? {};
  if (!provider) throw new Error('wrap() requires opts.provider');
  if (!NORMALISERS[provider]) throw new Error(`unknown provider "${provider}"`);

  const emit = (record) => (onRecord ? onRecord(record) : writeRecord(dir, sessionId, record));

  const instrument = (fn, thisArg) => async (...args) => {
    const started = new Date();
    const response = await fn.apply(thisArg, args);
    const usage = response?.usage ?? response?.usageMetadata;
    if (usage) {
      emit({
        provider,
        surface,
        model: response?.model ?? args?.[0]?.model ?? null,
        session_id: sessionId,
        trace_id: traceId,
        started_at: started.toISOString(),
        ended_at: new Date().toISOString(),
        tokens: normaliseUsage(provider, usage),
        raw: safeRaw(usage, response?.model),
        adapter: ADAPTER_ID,
        capture_level: 'N1',
        execution_host: 'api',
        review_measurement: 'declared',
      });
    }
    return response;
  };

  // Proxy only the create() calls; everything else passes through untouched.
  const paths = [
    ['chat', 'completions', 'create'],
    ['messages', 'create'],
    ['responses', 'create'],
  ];
  for (const p of paths) {
    let node = client;
    for (let i = 0; i < p.length - 1; i++) node = node?.[p[i]];
    const method = p[p.length - 1];
    if (node && typeof node[method] === 'function') {
      node[method] = instrument(node[method], node);
    }
  }
  return client;
}
