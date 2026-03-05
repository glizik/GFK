/**
 * state.ts — Tracks the last fully-completed run per issue type.
 *
 * Stored in data/state.json:
 * {
 *   "handleFlow (0)": { "completedAt": "2026-02-27", "lastEventDate": "2026-02-15T10:00:00Z" },
 *   "stopAndClear":   { "completedAt": "2026-02-27", "lastEventDate": "2026-02-20T08:00:00Z" }
 * }
 *
 * "completedAt" is only written after a full successful run to the last page.
 * The time window is only narrowed on subsequent runs if completedAt exists.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface IssueState {
  completedAt: string;       // ISO date — when we last successfully finished the full list
  lastEventDate: string;     // ISO date of the oldest event we saw in that run
}

export type StateFile = Record<string, IssueState>;

export function readState(statePath: string): StateFile {
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }
  } catch {
    console.warn(`⚠️  Could not read state file at ${statePath}, starting fresh.`);
  }
  return {};
}

export function writeState(statePath: string, state: StateFile): void {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Mark an issue type as fully completed.
 * Also records the date of the last (oldest) event seen so we can narrow the window next time.
 */
export function markCompleted(
  statePath: string,
  issueType: string,
  lastEventDate: string
): void {
  const state = readState(statePath);
  state[issueType] = {
    completedAt: new Date().toISOString(),
    lastEventDate,
  };
  writeState(statePath, state);
  console.log(`📌 State saved for "${issueType}": completed, last event = ${lastEventDate}`);
}

/**
 * Calculate the time window to use for this issue type.
 * - If we have a previous completed run, use days since that run (+ 2 day buffer).
 * - Otherwise fall back to the default (e.g. "90d").
 */
export function calcTimeWindow(
  statePath: string,
  issueType: string,
  defaultWindow: string
): string {
  const state = readState(statePath);
  const entry = state[issueType];

  if (!entry?.completedAt) {
    console.log(`📅 No previous state for "${issueType}", using default window: ${defaultWindow}`);
    return defaultWindow;
  }

  const completedAt = new Date(entry.completedAt);
  const now = new Date();
  const diffMs = now.getTime() - completedAt.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 2; // +2 day buffer
  const window = `${diffDays}d`;
  console.log(`📅 Previous run for "${issueType}" completed ${entry.completedAt}, using window: ${window}`);
  return window;
}
