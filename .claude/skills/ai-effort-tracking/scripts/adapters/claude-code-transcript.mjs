#!/usr/bin/env node
/**
 * Adapter: Claude Code transcript -> RawUsageRecord[] (capture level N1).
 *
 * Source: ~/.claude/projects/<slug>/<session_id>.jsonl
 * Verified against Claude Code 2.1.251.
 *
 * Anthropic's `input_tokens` already EXCLUDES cache, so no subtraction is
 * needed here — unlike OpenAI and DeepSeek. See references/adapter-contract.md
 * before copying this file as the basis for another provider.
 *
 *   node claude-code-transcript.mjs --project-dir /path/to/repo [--session <id>] [--since <ISO>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ADAPTER_ID = 'claude-code-transcript@1.0.0';

/** Claude Code slugifies the project path to name its transcript directory. */
export function transcriptDir(projectDir) {
  const slug = path.resolve(projectDir).replace(/[/.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

export function readTranscript(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** Strip message content: the ledger never stores prompts or responses. */
function safeRaw(usage, model) {
  return { model, usage };
}

/**
 * Group records into turns keyed by promptId, and compute the review gap
 * between an assistant's last message and the next non-meta user prompt.
 */
export function toRawUsageRecords(records, { reviewGapMaxS = 900, host = 'local' } = {}) {
  const turns = new Map();
  const userPrompts = [];

  for (const r of records) {
    const ts = r.timestamp ? Date.parse(r.timestamp) : null;
    if (r.type === 'user' && !r.isMeta && ts) userPrompts.push(ts);
    if (r.type !== 'assistant') continue;

    const usage = r.message?.usage;
    if (!usage) continue;
    const key = r.promptId ?? r.requestId ?? r.uuid;
    if (!turns.has(key)) {
      turns.set(key, {
        provider: 'anthropic',
        surface: 'claude-code-cli',
        model: r.message?.model ?? null,
        effort: r.effort ?? null,
        session_id: r.sessionId ?? null,
        is_subagent: Boolean(r.isSidechain),
        git_branch: r.gitBranch ?? null,
        started_at: r.timestamp,
        ended_at: r.timestamp,
        tokens: emptyTokens(),
        raw: [],
        capture_level: 'N1',
      });
    }
    const t = turns.get(key);
    if (r.timestamp < t.started_at) t.started_at = r.timestamp;
    if (r.timestamp > t.ended_at) t.ended_at = r.timestamp;
    addTokens(t.tokens, usage);
    t.raw.push(safeRaw(usage, r.message?.model));
  }

  const out = [...turns.values()].sort((a, b) => a.started_at.localeCompare(b.started_at));
  userPrompts.sort((a, b) => a - b);

  for (const t of out) {
    const start = Date.parse(t.started_at);
    const end = Date.parse(t.ended_at);

    // The agent is working from the moment the human hits enter, not from its
    // first emitted message. Measuring only the span between assistant messages
    // undercounts badly, since a single-message turn would span zero seconds.
    const triggeredAt = lastBefore(userPrompts, start);
    t.triggered_at = new Date(triggeredAt ?? start).toISOString();
    t.agent_active_s = Math.round((end - (triggeredAt ?? start)) / 1000);

    // The gap between "agent finished" and "human sent the next prompt" IS the
    // review tax. Beyond the threshold it stops being review and becomes absence.
    const next = userPrompts.find((ts) => ts > end);
    if (next == null) { t.human_review_s = null; t.human_wait_s = null; }
    else {
      const gap = Math.round((next - end) / 1000);
      if (gap > reviewGapMaxS) { t.human_review_s = null; t.human_wait_s = gap; }
      else { t.human_review_s = gap; t.human_wait_s = 0; }
    }

    t.execution_host = host;
    t.review_measurement = 'gap_based';
  }
  return out;
}

function lastBefore(sortedTimestamps, cutoff) {
  let found = null;
  for (const ts of sortedTimestamps) {
    if (ts > cutoff) break;
    found = ts;
  }
  return found;
}

function emptyTokens() {
  return {
    input_uncached: 0, cache_read: 0, cache_write_short: 0,
    cache_write_long: 0, output: 0, thinking: 0,
  };
}

/** Anthropic's native usage maps straight across — no cache subtraction needed. */
function addTokens(acc, u) {
  acc.input_uncached += u.input_tokens ?? 0;
  acc.cache_read += u.cache_read_input_tokens ?? 0;
  acc.cache_write_short += u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  acc.cache_write_long += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  acc.output += u.output_tokens ?? 0;
  acc.thinking += u.output_tokens_details?.thinking_tokens ?? 0;
}

/**
 * Aggregate turns into one work unit.
 * wall_s is the SPAN, not the sum: summing turns double-counts the gaps
 * between them, which is exactly where the review tax lives.
 */
export function aggregateToWorkUnit(turns) {
  if (!turns.length) return null;
  const tokens = emptyTokens();
  let agentActive = 0, review = 0, wait = 0, reviewKnown = false;
  for (const t of turns) {
    for (const k of Object.keys(tokens)) tokens[k] += t.tokens[k];
    agentActive += t.agent_active_s ?? 0;
    if (t.human_review_s != null) { review += t.human_review_s; reviewKnown = true; }
    if (t.human_wait_s != null) wait += t.human_wait_s;
  }
  // The unit starts when the human hit enter, not when the agent first spoke.
  // Anchoring on the first assistant message would leave the opening seconds
  // outside the span while agent_active_s still counts them, and the
  // accounting (active + review + wait <= wall) would not close.
  const start = turns[0].triggered_at ?? turns[0].started_at;
  const end = turns[turns.length - 1].ended_at;
  return {
    tokens,
    start, end,
    wall_s: Math.round((Date.parse(end) - Date.parse(start)) / 1000),
    agent_active_s: agentActive,
    human_review_s: reviewKnown ? review : null,
    human_wait_s: wait,
    model: turns[turns.length - 1].model,
    effort: turns[turns.length - 1].effort,
    session_id: turns[0].session_id,
    is_subagent: turns.some((t) => t.is_subagent),
    iterations: turns.length,
    provider: 'anthropic',
    surface: turns[0].surface,
    execution_host: turns[0].execution_host,
    review_measurement: turns[0].review_measurement,
    adapter: ADAPTER_ID,
    capture_level: 'N1',
  };
}

// ----------------------------------------------------------------------- cli

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function main() {
  const projectDir = arg('project-dir', process.cwd());
  const dir = transcriptDir(projectDir);
  if (!fs.existsSync(dir)) {
    console.error(`no transcript directory for ${projectDir}\n  looked in: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const session = arg('session');
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl') && (!session || f.startsWith(session)))
    .map((f) => path.join(dir, f));
  if (!files.length) { console.error('no transcript files found'); process.exitCode = 1; return; }

  const since = arg('since');
  let records = files.flatMap(readTranscript);
  if (since) records = records.filter((r) => !r.timestamp || r.timestamp >= since);

  const turns = toRawUsageRecords(records, { reviewGapMaxS: Number(arg('review-gap', '900')) });
  const output = arg('aggregate') === 'true'
    ? aggregateToWorkUnit(turns)
    : turns;
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
