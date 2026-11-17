#!/usr/bin/env node
/**
 * Ledger core: append, validate, migrate, csv-view.
 * Provider-neutral by construction — no vendor logic lives here.
 *
 *   node ledger.mjs append   --dir metrics/events --file event.json
 *   node ledger.mjs validate --dir metrics/events
 *   node ledger.mjs migrate  --csv tracking.csv --dir metrics/events --project <id>
 *   node ledger.mjs csv-view --dir metrics/events --out metrics/tracking.csv
 */

import fs from 'node:fs';
import path from 'node:path';

export const STAGES = [
  'specs_definition', 'workspace_setup', 'scaffold', 'cloud_infrastructure',
  'auth', 'frontend', 'backend', 'testing', 'deployment', 'maintenance',
];
export const TASK_TYPES = [
  'spec', 'feature', 'bugfix', 'refactor', 'test', 'docs', 'infra',
  'review', 'research', 'chore',
];
export const CAPTURE_LEVELS = ['N0', 'N1', 'N2', 'N3'];
export const STATUSES = ['accepted', 'reworked', 'rejected', 'abandoned'];
export const HOSTS = ['local', 'cloud-vm', 'self-hosted', 'api'];
export const REGIMES = ['flat_rate', 'metered_api'];

// ---------------------------------------------------------------- ULID-ish id

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now()) {
  let ts = '';
  let t = now;
  for (let i = 0; i < 10; i++) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += B32[Math.floor(Math.random() * 32)];
  return ts + rand;
}

// ------------------------------------------------------------------- storage

/** One file per session: concurrent sessions never touch the same file, so git has nothing to conflict on. */
export function sessionFile(dir, sessionId, when = new Date()) {
  const date = when.toISOString().slice(0, 10);
  const safe = String(sessionId ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(dir, `${date}--${safe}.jsonl`);
}

export function appendEvent(dir, event) {
  fs.mkdirSync(dir, { recursive: true });
  const errors = validateEvent(event);
  if (errors.length) throw new Error(`Invalid event:\n  - ${errors.join('\n  - ')}`);
  const file = sessionFile(dir, event.actor?.session_id, new Date(event.time?.start ?? Date.now()));
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  return file;
}

export function readEvents(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); }
      catch { console.error(`skipping unparseable line ${f}:${i + 1}`); }
    }
  }
  return out;
}

// ----------------------------------------------------------------- validation

export function validateEvent(e) {
  const errs = [];
  const req = (cond, msg) => { if (!cond) errs.push(msg); };

  req(e.schema_version, 'schema_version missing');
  req(e.event_id, 'event_id missing');
  req(e.project_id, 'project_id missing');
  req(e.actor?.role === 'ai' || e.actor?.role === 'human', 'actor.role must be ai|human');
  req(!e.stage || STAGES.includes(e.stage) || e.stage.startsWith('x-'), `unknown stage "${e.stage}"`);
  req(!e.task_type || TASK_TYPES.includes(e.task_type), `unknown task_type "${e.task_type}"`);
  req(!e.outcome?.status || STATUSES.includes(e.outcome.status), `unknown status "${e.outcome?.status}"`);
  req(!e.execution?.host || HOSTS.includes(e.execution.host), `unknown execution.host "${e.execution?.host}"`);
  req(!e.cost?.regime || REGIMES.includes(e.cost.regime), `unknown cost.regime "${e.cost?.regime}"`);

  const p = e.provenance ?? {};
  req(CAPTURE_LEVELS.includes(p.capture_level), `capture_level must be one of ${CAPTURE_LEVELS}`);

  // The rule that makes "don't invent data" a checkable property of the file.
  if (Array.isArray(p.measured) && p.measured.length > 0) {
    req(p.adapter, 'provenance.measured is non-empty but provenance.adapter is missing');
  }

  const t = e.tokens;
  if (t) {
    // input_uncached and cache_read must be disjoint: either both known or both unknown.
    req(
      (t.input_uncached == null) === (t.cache_read == null),
      'tokens.input_uncached and tokens.cache_read must both be present or both null (they are disjoint)',
    );
    if (t.thinking != null && t.output != null) {
      req(t.thinking <= t.output, 'tokens.thinking must be <= tokens.output (it is a subset)');
    }
  }

  if (e.cost?.usd != null) {
    req(e.cost.pricing_ref, 'cost.usd set but cost.pricing_ref missing');
    req(e.cost.cost_model, 'cost.usd set but cost.cost_model missing');
  }

  if (e.unit?.type === 'work_unit' && Array.isArray(e.unit.turn_ids) && e.unit.turn_ids.length) {
    req(e.unit.aggregates === e.unit.turn_ids.length, 'unit.aggregates must equal unit.turn_ids.length');
  }

  if (e.time?.start && e.time?.end) {
    req(new Date(e.time.end) >= new Date(e.time.start), 'time.end is before time.start');
  }
  return errs;
}

export function validateDir(dir) {
  const events = readEvents(dir);
  const ids = new Set(events.map((e) => e.event_id));
  const report = [];
  for (const e of events) {
    const errs = validateEvent(e);
    if (e.corrects && !ids.has(e.corrects)) errs.push(`corrects points to unknown event_id "${e.corrects}"`);
    if (errs.length) report.push({ event_id: e.event_id, errors: errs });
  }
  return { total: events.length, invalid: report };
}

// ------------------------------------------------------------------ migration

const LEGACY_STAGE_MAP = {
  'specs definition': 'specs_definition',
  'workspace setting': 'workspace_setup',
  'workspace settting': 'workspace_setup',
  'workspace setup': 'workspace_setup',
  scaffold: 'scaffold',
  'cloud infraestructure': 'cloud_infrastructure',
  'cloud infrastructure': 'cloud_infrastructure',
  'auth connection': 'auth',
  frontend: 'frontend',
  backend: 'backend',
  testing: 'testing',
  deployment: 'deployment',
  maintenance: 'maintenance',
};

const PROVIDER_HINTS = [
  [/opus|sonnet|haiku|claude/i, 'anthropic'],
  [/gpt|o\d|codex/i, 'openai'],
  [/gemini/i, 'google'],
  [/deepseek/i, 'deepseek'],
  [/qwen/i, 'alibaba'],
  [/kimi/i, 'moonshot'],
];

const SURFACE_HINTS = [
  [/claude code/i, 'claude-code-cli'],
  [/codex/i, 'codex-cli'],
  [/gemini/i, 'gemini-cli'],
  [/cline/i, 'cline'],
  [/opencode/i, 'opencode'],
  [/antigravity/i, 'antigravity'],
  [/console/i, 'aws-console'],
  [/editor|markdown/i, 'editor'],
];

function hint(table, value, fallback = null) {
  for (const [re, out] of table) if (re.test(value ?? '')) return out;
  return fallback;
}

/** Minimal RFC-4180 parser: the milestone column routinely contains commas. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((v) => v.trim())).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** "27/08/2026 19:30" in a local offset -> ISO-8601 UTC. */
function toUtcIso(local, offsetHours) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})/.exec(local ?? '');
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h - offsetHours, +mi)).toISOString();
}

function hmsToSeconds(hms) {
  const p = (hms ?? '').split(':').map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return null;
  return p[0] * 3600 + p[1] * 60 + p[2];
}

/**
 * Legacy rows carry no token or cost data and none is invented for them:
 * a fabricated cost for a past month contaminates every later time series.
 */
export function migrateRow(row, { projectId, offsetHours = -5 }) {
  const start = toUtcIso(row.start, offsetHours);
  const end = toUtcIso(row.finish, offsetHours);
  const role = row.role === 'human' ? 'human' : 'ai';
  const provider = role === 'human' ? 'human' : hint(PROVIDER_HINTS, row.model);
  const warnings = [];

  const declared = hmsToSeconds(row.time);
  const computed = start && end ? Math.round((new Date(end) - new Date(start)) / 1000) : null;
  if (declared != null && computed != null && declared !== computed) {
    warnings.push(`duration mismatch: declared ${row.time}, computed ${computed}s`);
  }

  return {
    event: {
      schema_version: '1.0',
      event_id: ulid(start ? new Date(start).getTime() : Date.now()),
      project_id: projectId,
      corrects: null,
      unit: { type: 'work_unit', turn_ids: [], aggregates: 1 },
      trace_id: null,
      spec_ref: [],
      stage: LEGACY_STAGE_MAP[(row.stage ?? '').toLowerCase()] ?? null,
      task_type: null,
      actor: {
        role,
        id: row.model || null,
        provider,
        surface: role === 'human' ? hint(SURFACE_HINTS, row.tool, 'other') : hint(SURFACE_HINTS, row.tool),
        device: row.device || null,
        effort: null,
        session_id: 'legacy',
        is_subagent: false,
      },
      execution: { host: 'local' },
      time: {
        start, end,
        tz_display: null,
        wall_s: declared ?? computed,
        agent_active_s: null,
        human_active_s: null,
        human_review_s: null,
        human_wait_s: null,
        review_measurement: 'declared',
      },
      tokens: null,
      cost: null,
      outcome: {
        status: 'accepted',
        iterations: null,
        tool_errors: null,
        rejected_edits: null,
        cognitive_load: row.effort || null,
      },
      change: null,
      milestone: row.milestone || null,
      provenance: {
        measured: [],
        declared: ['milestone', 'time.wall_s', 'outcome.cognitive_load'],
        derived: ['actor.provider', 'actor.surface', 'execution.host'],
        adapter: null,
        capture_level: 'N0',
        confidence: 'legacy',
      },
    },
    warnings,
  };
}

export function migrateCsv(csvPath, dir, { projectId, offsetHours = -5 }) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'legacy--migrated.jsonl');
  const lines = [], allWarnings = [];
  for (const row of rows) {
    const { event, warnings } = migrateRow(row, { projectId, offsetHours });
    const errs = validateEvent(event);
    if (errs.length) { allWarnings.push({ row: row.milestone, errors: errs }); continue; }
    lines.push(JSON.stringify(event));
    if (warnings.length) allWarnings.push({ row: row.milestone, warnings });
  }
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  return { migrated: lines.length, total: rows.length, file: out, warnings: allWarnings };
}

// ------------------------------------------------------------------ csv view

const CSV_COLUMNS = [
  'stage', 'start', 'finish', 'time', 'role', 'model', 'milestone',
  'tool', 'device', 'effort', 'cost_usd', 'capture_level',
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function secondsToHms(s) {
  if (s == null) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function toLocal(iso, offsetHours) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + offsetHours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** The CSV view reproduces the legacy shape so existing analyses keep working. */
export function csvView(dir, { offsetHours = -5 } = {}) {
  const events = readEvents(dir)
    .filter((e) => e.unit?.type !== 'turn')
    .sort((a, b) => String(a.time?.start).localeCompare(String(b.time?.start)));
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    lines.push([
      e.stage, toLocal(e.time?.start, offsetHours), toLocal(e.time?.end, offsetHours),
      secondsToHms(e.time?.wall_s), e.actor?.role, e.actor?.id, e.milestone,
      e.actor?.surface, e.actor?.device, e.outcome?.cognitive_load,
      e.cost?.usd, e.provenance?.capture_level,
    ].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

// ----------------------------------------------------------------------- cli

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function main() {
  const cmd = process.argv[2];
  const dir = arg('dir', 'metrics/events');

  if (cmd === 'append') {
    const event = JSON.parse(fs.readFileSync(arg('file'), 'utf8'));
    console.log(`appended to ${appendEvent(dir, event)}`);
  } else if (cmd === 'validate') {
    const r = validateDir(dir);
    console.log(`${r.total} events, ${r.invalid.length} invalid`);
    for (const i of r.invalid) console.log(`  ${i.event_id}: ${i.errors.join('; ')}`);
    if (r.invalid.length) process.exitCode = 1;
  } else if (cmd === 'migrate') {
    const r = migrateCsv(arg('csv'), dir, {
      projectId: arg('project', 'unknown'),
      offsetHours: Number(arg('offset', '-5')),
    });
    console.log(`migrated ${r.migrated}/${r.total} rows -> ${r.file}`);
    for (const w of r.warnings) console.log(`  warn: ${JSON.stringify(w)}`);
  } else if (cmd === 'csv-view') {
    const out = arg('out', 'metrics/tracking.csv');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, csvView(dir, { offsetHours: Number(arg('offset', '-5')) }), 'utf8');
    console.log(`wrote ${out}`);
  } else {
    console.log('usage: ledger.mjs <append|validate|migrate|csv-view> [--dir ...] [--file ...] [--csv ...] [--out ...]');
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
