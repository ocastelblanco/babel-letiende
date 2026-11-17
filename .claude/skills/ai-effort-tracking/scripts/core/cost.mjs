/**
 * Cost computation. Provider-neutral by construction: this module never
 * decides which cost model applies, it only applies the one the event declares.
 *
 * Every model here consumes the CANONICAL token vocabulary, where
 * `input_uncached` and `cache_read` are disjoint and `thinking` is a subset
 * of `output`. Normalising native payloads into that vocabulary is the
 * adapter's job — see references/adapter-contract.md.
 */

const PER_MILLION = 1e6;

/** Cost models, keyed by the `cost_model` a provider declares in pricing.json. */
export const COST_MODELS = {
  /** Separate cache read/write pricing, expressed as multipliers over input. */
  anthropic(tokens, rates, cacheMultipliers) {
    const m = { read: 0.1, write_short: 1.25, write_long: 2.0, ...cacheMultipliers };
    return (
      tokens.input_uncached * rates.input +
      tokens.cache_read * rates.input * m.read +
      tokens.cache_write_short * rates.input * m.write_short +
      tokens.cache_write_long * rates.input * m.write_long +
      tokens.output * rates.output
    );
  },

  /** Discounted cached input, no write charge. */
  openai(tokens, rates) {
    return (
      tokens.input_uncached * rates.input +
      tokens.cache_read * rates.cached_input +
      tokens.output * rates.output
    );
  },

  /** Distinct hit/miss input rates. */
  deepseek(tokens, rates) {
    return (
      tokens.input_uncached * rates.input_miss +
      tokens.cache_read * rates.input_hit +
      tokens.output * rates.output
    );
  },

  /** Like openai, plus a time-based cache storage component. */
  google(tokens, rates, _cacheMultipliers, extra = {}) {
    const storage =
      (rates.cache_storage_per_token_hour ?? 0) *
      (tokens.cache_read ?? 0) *
      (extra.cache_storage_hours ?? 0);
    return (
      tokens.input_uncached * rates.input +
      tokens.cache_read * rates.cached_input +
      tokens.output * rates.output +
      storage
    );
  },
};

/** Canonical token fields. `thinking` is deliberately absent: it lives inside `output`. */
export const BILLABLE_TOKEN_FIELDS = [
  'input_uncached',
  'cache_read',
  'cache_write_short',
  'cache_write_long',
  'output',
];

export function billableTokens(tokens) {
  if (!tokens) return null;
  let total = 0;
  for (const f of BILLABLE_TOKEN_FIELDS) {
    if (tokens[f] == null) return null;
    total += tokens[f];
  }
  return total;
}

export class UnverifiedPricingError extends Error {}

/**
 * Compute list-price cost in USD.
 * Returns null when pricing is unverified or incomplete — never a guess.
 */
export function computeCost({ provider, model, tokens, pricing, extra }) {
  const p = pricing?.providers?.[provider];
  if (!p) return { usd: null, reason: `provider "${provider}" not in pricing.json` };
  if (p.status === 'unverified') {
    return { usd: null, reason: `pricing for "${provider}" is unverified`, cost_model: p.cost_model };
  }

  const rates = p.models?.[model];
  if (!rates) return { usd: null, reason: `model "${model}" not in pricing.json`, cost_model: p.cost_model };
  if (Object.values(rates).some((v) => v == null)) {
    return { usd: null, reason: `incomplete rates for "${model}"`, cost_model: p.cost_model };
  }

  const fn = COST_MODELS[p.cost_model];
  if (!fn) return { usd: null, reason: `unknown cost_model "${p.cost_model}"` };

  const t = normaliseTokens(tokens);
  if (!t) return { usd: null, reason: 'tokens incomplete', cost_model: p.cost_model };

  // A model may override individual provider multipliers (e.g. a cheaper cache read).
  const cacheMultipliers = { ...p.cache_multipliers, ...rates.cache_multipliers };
  const usd = fn(t, rates, cacheMultipliers, extra) / PER_MILLION;
  return {
    usd: round6(usd),
    cost_model: p.cost_model,
    pricing_ref: `pricing.json@${p.as_of}`,
  };
}

/** Missing token fields default to 0; a fully missing `tokens` block yields null. */
function normaliseTokens(tokens) {
  if (!tokens) return null;
  const t = {};
  for (const f of BILLABLE_TOKEN_FIELDS) t[f] = tokens[f] ?? 0;
  return t;
}

/**
 * Under a flat-rate plan the marginal cost of a token is zero, so the meaningful
 * figure is each event's share of the monthly fee. The denominator is only known
 * once the month closes — before that, allocation is null rather than estimated.
 */
export function allocateFlatRate({ events, monthlyUsd }) {
  if (monthlyUsd == null) return new Map();
  const totals = events.map((e) => billableTokens(e.tokens));
  const denominator = totals.reduce((sum, t) => sum + (t ?? 0), 0);
  const out = new Map();
  if (denominator === 0) return out;
  events.forEach((e, i) => {
    out.set(e.event_id, totals[i] == null ? null : round6((monthlyUsd * totals[i]) / denominator));
  });
  return out;
}

/** Marginal cost: zero under a flat rate, list price under a metered API. */
export function marginalCost(regime, listPriceUsd) {
  if (regime === 'flat_rate') return 0;
  return listPriceUsd;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
