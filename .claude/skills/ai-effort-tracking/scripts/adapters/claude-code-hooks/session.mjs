#!/usr/bin/env node
/**
 * Hook: SessionStart -> open the session, SessionEnd -> flush a draft event.
 *
 * The draft carries every measured field the hooks could observe. It is a
 * draft and not a finished event on purpose: milestone, task_type and
 * trace_id are the human's to supply, and `capture` fills them in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readHookInput, sessionIdFrom, loadState, saveState, clearState, projectDir, guard } from './state.mjs';

guard(() => {
  const mode = process.argv[2];
  const input = readHookInput();
  const sessionId = sessionIdFrom(input);
  const state = loadState(sessionId);

  if (mode === 'start') {
    if (!state.started_at) state.started_at = new Date().toISOString();
    saveState(state);
    return;
  }

  // SessionEnd: write a draft for `capture` to complete. Tokens are absent
  // here by design — hooks do not see usage; the transcript adapter does.
  const draft = {
    session_id: sessionId,
    execution_host: state.execution_host,
    surface: state.execution_host === 'cloud-vm' ? 'claude-code-web' : 'claude-code-cli',
    provider: 'anthropic',
    started_at: state.started_at,
    ended_at: new Date().toISOString(),
    human_review_s: state.human_review_s,
    human_wait_s: state.human_wait_s,
    review_measurement: 'focus_based',
    files_touched: state.files_touched,
    tool_errors: state.tool_errors,
    rejected_edits: state.rejected_edits,
    turns: state.turns,
    adapter: 'claude-code-hooks@1.0.0',
    capture_level: 'N2',
  };

  const out = path.join(projectDir(), 'metrics/.state', `draft--${sessionId}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(draft, null, 2), 'utf8');
  clearState(sessionId);
});
