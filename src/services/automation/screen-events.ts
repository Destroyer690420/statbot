/**
 * Tier-1 screen event feed for the bot-DM `blocks` report.
 *
 * Pure in-memory module — no env, no DB, no timers. Safe for unit tests.
 *
 * Why in-memory: dry-run WOULD_BLOCK candidates exist nowhere else (the
 * browser console is invisible to the server, and writing every candidate to
 * Postgres would need a migration for tuning data). Actual blocks are
 * authoritative in `BlockedSubreddit` (reason `auto-content:*`) — the store
 * only carries what the DB cannot: shadow-mode candidates. Bounded (100) and
 * TTL-pruned (7d); a restart loses tuning history, never blocks.
 */
import type { ContentScreenSignal } from '../../types';

export interface ScreenEvent {
  subreddit: string | null;
  signal: ContentScreenSignal;
  matched: string | null;
  externalTaskId: string | null;
  /** Browser-reported dry-run flag at verdict time. */
  dryRun: boolean;
  at: number;
}

export type ScreenEventInput = Omit<ScreenEvent, 'at'>;

const MAX_SCREEN_EVENTS = 100;
const SCREEN_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const events: ScreenEvent[] = [];

export function recordScreenEvent(input: ScreenEventInput, nowMs: number = Date.now()): ScreenEvent {
  const event: ScreenEvent = { ...input, at: nowMs };
  events.push(event);
  while (events.length > MAX_SCREEN_EVENTS) events.shift();
  return event;
}

/** Newest-first, TTL-pruned. Never throws. */
export function listScreenEvents(nowMs: number = Date.now()): ScreenEvent[] {
  try {
    const cutoff = nowMs - SCREEN_EVENT_TTL_MS;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].at < cutoff) events.splice(i, 1);
    }
    return [...events].reverse();
  } catch {
    return [];
  }
}

/** Test hook (also a manual reset). */
export function clearScreenEvents(): void {
  events.length = 0;
}

export interface AutoBlockedRow {
  subreddit: string;
  reason: string | null;
  createdAt: Date;
}

function ago(at: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function day(date: Date): string {
  try {
    return date.toISOString().slice(0, 10);
  } catch {
    return '?';
  }
}

/**
 * Builds the bot-DM `blocks` report. Section A = actual auto-blocks from the
 * DB (authoritative, both modes). Section B = dry-run WOULD_BLOCK candidates
 * from the event store (shadow mode only — in enforce mode the DB is the
 * record). Always fits a Discord message (hard-capped, oldest lines dropped
 * first... newest kept: rows are newest-first, we cut the tail).
 */
export function buildBlocksReport(args: {
  autoBlocked: AutoBlockedRow[];
  events: ScreenEvent[];
  dryRun: boolean;
  nowMs?: number;
}): string {
  const nowMs = args.nowMs ?? Date.now();
  const lines: string[] = ['Auto-block report'];
  if (args.autoBlocked.length === 0) {
    lines.push('Blocked: none yet.');
  } else {
    lines.push(`Blocked (${args.autoBlocked.length}):`);
    for (const row of args.autoBlocked.slice(0, 20)) {
      const what = row.reason || 'auto-content:?';
      lines.push(`• r/${row.subreddit} (${what}) — ${day(row.createdAt)}`);
    }
  }
  if (args.dryRun) {
    const cands = args.events.filter((e) => e.dryRun);
    if (cands.length === 0) {
      lines.push('Would-block candidates: none recorded.');
    } else {
      lines.push(`Would-block candidates (${cands.length}, shadow — nothing blocked):`);
      for (const e of cands.slice(0, 20)) {
        const trig = e.matched ? `"${e.matched}"` : e.signal;
        const task = e.externalTaskId ? ` task #${e.externalTaskId}` : '';
        lines.push(`• r/${e.subreddit || '?'} (${e.signal}, ${trig})${task} — ${ago(e.at, nowMs)}`);
      }
    }
  }
  lines.push('Unblock: dashboard Automation → blocked-subreddit editor.');
  let message = lines.join('\n');
  // Discord hard limit is 2000 chars; stay well inside with margin, keeping
  // the newest lines (rows are newest-first, so drop from the tail).
  if (message.length > 1900) {
    const head = lines[0];
    const tail = lines[lines.length - 1];
    const body = lines.slice(1, -1);
    while (body.length > 0 && [head, ...body, tail].join('\n').length > 1900) body.pop();
    message = [head, ...body, tail].join('\n');
  }
  return message;
}
