#!/usr/bin/env node
/**
 * Hook: Stop -> open the review window, UserPromptSubmit -> close it.
 *
 * The gap between "the agent finished" and "the human sent the next prompt"
 * IS the review tax. This pair is what turns human_review_s from a declared
 * number into a measured one.
 *
 * Beyond review_gap_max_s it stops being review and becomes absence, which
 * matters most on cloud and mobile sessions where a gap can be a whole night.
 */

import { readHookInput, sessionIdFrom, loadState, saveState, readConfig, guard } from './state.mjs';

guard(() => {
  const mode = process.argv[2];
  const input = readHookInput();
  const state = loadState(sessionIdFrom(input));
  const now = Date.now();

  if (mode === 'open') {
    state.review_window_opened_at = now;
    state.turns += 1;
  } else if (mode === 'close') {
    if (state.review_window_opened_at) {
      const gap = Math.round((now - state.review_window_opened_at) / 1000);
      const max = readConfig().review_gap_max_s ?? 900;
      if (gap > max) state.human_wait_s += gap;
      else state.human_review_s += gap;
      state.review_window_opened_at = null;
    }
    if (!state.started_at) state.started_at = new Date(now).toISOString();
  }
  saveState(state);
});
