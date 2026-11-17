#!/usr/bin/env node
/**
 * Hook: PostToolUse (Edit|Write) -> files touched.
 *       PostToolUseFailure       -> tool errors.
 *       PermissionDenied         -> edits the human rejected.
 *
 * Feeds change.files_touched and outcome.{tool_errors,rejected_edits}.
 */

import { readHookInput, sessionIdFrom, loadState, saveState, guard } from './state.mjs';

guard(() => {
  const mode = process.argv[2];
  const input = readHookInput();
  const state = loadState(sessionIdFrom(input));

  if (mode === 'edit') {
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (file && !state.files_touched.includes(file)) state.files_touched.push(file);
  } else if (mode === 'error') {
    state.tool_errors += 1;
  } else if (mode === 'denied') {
    state.rejected_edits += 1;
  }
  saveState(state);
});
