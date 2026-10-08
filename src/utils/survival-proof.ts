import { SURVIVAL_CHECK_DELAY_MS } from '../config/constants';
import type { SurvivalStatus } from '../types';

/**
 * Pure survival-proof helpers (no I/O — safe for unit tests).
 *
 * They live here instead of the services because `survival.service.ts`
 * imports `src/config/env.ts` (process.exit without full env) and the
 * Playwright/Redis/Discord stack, which would turn any missing var into a
 * dead test run (see docs/TESTING.md §1). Services import from here.
 */

/** Stable BullMQ job id so a resubmission cancels and restarts the timer. */
export function survivalJobIdFor(taskId: string): string {
  return `survival-${taskId}`;
}

/** Proof deadline: 11 minutes after the anchor (submission or creation). */
export function survivalDueAt(anchor: Date): Date {
  return new Date(anchor.getTime() + SURVIVAL_CHECK_DELAY_MS);
}

/** Canonical proof URL: latest submission wins, manual /task falls back to redditUrl. */
export function resolveSurvivalUrl(task: {
  submittedRedditUrl: string | null;
  redditUrl: string | null;
}): string | null {
  return (task.submittedRedditUrl || '').trim() || (task.redditUrl || '').trim() || null;
}

export function normalizeSurvivalUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\/.+/i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\/\/(www|old|new|sh)\./, '//www.');
  return normalized.split(/[?#]/)[0].replace(/\/+$/, '');
}

export interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  sameSite: 'Lax';
}

/** Cookie header -> Playwright cookie params (skips Set-Cookie attributes). */
export function parseCookieHeader(header: string): ParsedCookie[] {
  const out: ParsedCookie[] = [];
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || !value) continue;
    if (/^(expires|path|domain|max-age|samesite|secure|httponly)$/i.test(name)) continue;
    out.push({ name, value, domain: '.reddit.com', path: '/', secure: true, sameSite: 'Lax' });
  }
  return out;
}

export interface MappedSurvivalError {
  status: SurvivalStatus;
  retryable: boolean;
  label: string;
}

/**
 * Maps a capture failure (by error name + message, so callers don't need the
 * error classes) to a persisted status. Session/block failures never retry —
 * the admin gets a DM instead. Rate-limits and network blips retry.
 */
export function mapSurvivalError(name: string, message: string): MappedSurvivalError {
  const msg = String(message || '');
  if (name === 'SurvivalNoSessionError') {
    return { status: 'NO_SESSION', retryable: false, label: 'Reddit session not set up' };
  }
  if (name === 'SurvivalSessionExpiredError') {
    return { status: 'SESSION_EXPIRED', retryable: false, label: 'Reddit session expired' };
  }
  if (name === 'SurvivalBlockedError') {
    return { status: 'BLOCKED', retryable: false, label: 'Reddit blocked the server' };
  }
  if (name === 'SurvivalRateLimitedError') {
    return { status: 'FETCH_ERROR', retryable: true, label: 'Reddit rate-limited (429)' };
  }
  if (/429|rate-limit|timed out|timeout|network|econn|socket/i.test(msg)) {
    return { status: 'FETCH_ERROR', retryable: true, label: msg.slice(0, 200) };
  }
  return { status: 'FETCH_ERROR', retryable: false, label: msg.slice(0, 300) };
}
