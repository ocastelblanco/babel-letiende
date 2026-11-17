/**
 * Shared state for the N2 hook adapter.
 *
 * Hooks fire as separate short-lived processes, so the only thing they share is
 * a file. State is per session — concurrent sessions (local + cloud + another
 * branch) never touch the same file, which is what keeps git free of conflicts.
 *
 * Lives under .omc-free ground: metrics/.state/ is gitignored working data,
 * not part of the ledger.
 */

import fs from 'node:fs';
import path from 'node:path';

export const STATE_DIR = 'metrics/.state';

/** Hooks receive their payload as JSON on stdin. */
export function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Cloud sessions expose their own id; local ones come from the hook payload. */
export function sessionIdFrom(input) {
  return process.env.CLAUDE_CODE_REMOTE_SESSION_ID || input.session_id || 'unknown';
}

export function executionHost() {
  return process.env.CLAUDE_CODE_REMOTE_SESSION_ID ? 'cloud-vm' : 'local';
}

function statePath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(projectDir(), STATE_DIR, `${safe}.json`);
}

export function loadState(sessionId) {
  const p = statePath(sessionId);
  if (!fs.existsSync(p)) {
    return {
      session_id: sessionId,
      execution_host: executionHost(),
      started_at: null,
      review_window_opened_at: null,
      human_review_s: 0,
      human_wait_s: 0,
      files_touched: [],
      tool_errors: 0,
      rejected_edits: 0,
      turns: 0,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return loadState(`${sessionId}-recovered`);
  }
}

/** Atomic write: a hook killed mid-write must not leave a truncated file. */
export function saveState(state) {
  const p = statePath(state.session_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function clearState(sessionId) {
  const p = statePath(sessionId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function readConfig() {
  const p = path.join(projectDir(), 'metrics/config.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** Hooks must never break the session: any failure is swallowed and logged. */
export function guard(fn) {
  try {
    fn();
  } catch (err) {
    try {
      const p = path.join(projectDir(), STATE_DIR, 'hook-errors.log');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, `${new Date().toISOString()} ${err.stack ?? err}\n`, 'utf8');
    } catch { /* nothing further we can do */ }
  }
  process.exit(0);
}
