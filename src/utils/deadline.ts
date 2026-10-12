/**
 * Task-site deadline math — pure, no env, no DB, no Redis.
 *
 * Deadlines arrive as site-local display text ("Today 4:50 PM" for
 * same-day deadlines, "Oct 11 1:50 PM" otherwise — both Asia/Kolkata, the
 * site's timezone). This module parses them to UTC milliseconds and derives
 * the two deadline-driven due times:
 *  - link submit jobs must fire no later than deadline − 5min − submit slack
 *  - feedback jobs ("submitting in a bit") fire at deadline − 5min − fb slack
 *
 * Unparseable or missing deadlines mean "no deadline pressure": every helper
 * falls back to the un-pressured behavior (normal delays, no feedback).
 * Past deadlines mean "hurry": submit jobs are due immediately and feedback
 * is due immediately (still one-shot per task, enforced by the service).
 */

import {
  DEADLINE_SUBMIT_MARGIN_MS,
  FEEDBACK_DEADLINE_SLACK_MS,
  FEEDBACK_RETRY_DELAY_MS,
  SUBMISSION_INITIAL_DELAY_MS,
  SUBMIT_DEADLINE_SLACK_MS,
} from '../config/constants';

/** Asia/Kolkata is fixed at +5:30, no DST — plain arithmetic, no tz lib. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function to24h(hour12: number, ampm: string): number {
  const h = hour12 % 12;
  return ampm.toUpperCase() === 'PM' ? h + 12 : h;
}

/** IST calendar parts of an instant (year/month/date in the site's zone). */
function istParts(atMs: number): { year: number; month: number; date: number } {
  const d = new Date(atMs + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

/** Builds the UTC instant of an IST wall-clock time (Date.UTC normalizes). */
function istToUtcMs(year: number, month: number, date: number, hour24: number, minute: number): number {
  return Date.UTC(year, month, date, hour24, minute) - IST_OFFSET_MS;
}

/**
 * Parses a task-site deadline to UTC milliseconds, or null when the text is
 * missing/unreadable. "Today" resolves against the task's creation instant
 * in IST (the site renders the deadline on the day the task is grabbed);
 * month-day deadlines take the creation year's IST year, rolling +1 year
 * when that would land over ~180 days in the past (Dec→Jan edge).
 */
export function parseDeadlineToMs(
  deadline: string | null | undefined,
  createdAt: Date | number,
): number | null {
  if (!deadline) return null;
  const text = deadline.trim();
  if (!text) return null;
  const createdMs = createdAt instanceof Date ? createdAt.getTime() : createdAt;
  if (!Number.isFinite(createdMs)) return null;

  const today = /^Today\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(text);
  if (today) {
    const parts = istParts(createdMs);
    const hour12 = Number(today[1]);
    const minute = Number(today[2]);
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
    return istToUtcMs(parts.year, parts.month, parts.date, to24h(hour12, today[3]), minute);
  }

  const dated = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/.exec(text);
  if (dated) {
    const month = MONTHS[dated[1].toLowerCase()];
    const day = Number(dated[2]);
    const hour12 = Number(dated[3]);
    const minute = Number(dated[4]);
    if (month === undefined || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const parts = istParts(createdMs);
    let ms = istToUtcMs(parts.year, month, day, to24h(Number(dated[3]), dated[5]), minute);
    if (ms < createdMs - 180 * 24 * 60 * 60 * 1000) {
      ms = istToUtcMs(parts.year + 1, month, day, to24h(Number(dated[3]), dated[5]), minute);
    }
    return ms;
  }

  return null;
}

/** Latest instant the first submit attempt may fire (deadline − margin − slack). */
export function latestSubmitAttemptMs(deadlineMs: number): number {
  return deadlineMs - DEADLINE_SUBMIT_MARGIN_MS - SUBMIT_DEADLINE_SLACK_MS;
}

/**
 * Submit-job delay under deadline pressure. Without a deadline the normal
 * correction window applies; with one, the job is due no later than the
 * latest attempt instant (immediately when that already passed).
 */
export function submitDelayWithDeadline(
  deadlineMs: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return SUBMISSION_INITIAL_DELAY_MS;
  return Math.max(0, Math.min(SUBMISSION_INITIAL_DELAY_MS, latestSubmitAttemptMs(deadlineMs) - nowMs));
}

/** True when the deadline actually shortened the normal submit delay. */
export function isDeadlinePressured(deadlineMs: number | null | undefined, nowMs: number = Date.now()): boolean {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return false;
  return latestSubmitAttemptMs(deadlineMs) - nowMs < SUBMISSION_INITIAL_DELAY_MS;
}

/**
 * Retry delay under deadline pressure. Retries keep their normal backoff,
 * except a retry that would land past the margin fires as soon as the
 * executor can take it (the link must be in before the deadline in any case).
 */
export function retryDelayWithDeadline(
  backoffMs: number,
  deadlineMs: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return backoffMs;
  return Math.max(0, Math.min(backoffMs, latestSubmitAttemptMs(deadlineMs) - nowMs));
}

/**
 * Feedback-job delay: the stalling notice should land just ahead of the
 * margin (deadline − margin − small slack), immediately when that passed.
 * Null when there is no parseable deadline (no feedback without one).
 */
export function feedbackDueDelayMs(
  deadlineMs: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return null;
  return Math.max(0, deadlineMs - DEADLINE_SUBMIT_MARGIN_MS - FEEDBACK_DEADLINE_SLACK_MS - nowMs);
}

/** Single feedback retry delay (one retry, then give up to the manager). */
export function feedbackRetryDelayMs(): number {
  return FEEDBACK_RETRY_DELAY_MS;
}
