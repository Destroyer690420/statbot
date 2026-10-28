/**
 * Deadline feedback ("submitting in a bit") — pure gating/scheduling logic.
 *
 * Pure module (no env, no DB, no Redis). The thin BullMQ wrapper lives in
 * services/feedback.service.ts; everything decidable lives here and is
 * unit-tested. Follows the utils/submission-queue.ts split (TESTING.md §1).
 *
 * One shot per task: the service skips when a FEEDBACK_SENT **or
 * FEEDBACK_FAILED** audit exists (a give-up tags the manager once — it must
 * never re-schedule, or the 30-min re-hydration re-fires the notice forever)
 * and drops the job the moment a link arrives. A stale-lease reclaim counts
 * as an attempt so a job whose executor died before reporting cannot be
 * re-submitted every lease timeout. Fire-time re-validation (lease) re-runs
 * the same decision against fresh state.
 */

import {
  FEEDBACK_LEASE_TIMEOUT_MS,
  FEEDBACK_MAX_ATTEMPTS,
  FEEDBACK_STALE_AFTER_MS,
} from '../config/constants';
import { TaskStatus } from '../types';
import { feedbackDueDelayMs, feedbackRetryDelayMs } from './deadline';

/** Stable job id per task — re-schedules never double (latest wins). */
export function feedbackJobIdFor(taskId: string): string {
  return `feedback-${taskId}`;
}

/** Terminal pipeline states: the site-side task is over, hold nothing. */
const TERMINAL_STATUSES = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.ARCHIVED,
  TaskStatus.CANCELLED,
]);

/**
 * Terminal feedback outcomes: FEEDBACK_SENT (notice went out) or
 * FEEDBACK_FAILED (gave up — the manager was tagged to send it by hand).
 * Either one must stop every future schedule, or the 30-min re-hydration
 * re-fires the notice forever.
 */
export function isFeedbackHandledAction(action: string): boolean {
  return action === 'FEEDBACK_SENT' || action === 'FEEDBACK_FAILED';
}

/**
 * Attempt bookkeeping at lease time. A stale lease means the previous tab
 * died mid-flow — it may have already submitted — so the reclaim counts as
 * one attempt; null = attempts exhausted (the caller must remove the job,
 * audit FEEDBACK_FAILED, and tag the manager instead of re-leasing, or a
 * report-losing executor would re-submit every lease timeout).
 */
export function feedbackLeaseAttempt(
  currentAttempt: number | undefined,
  hadStaleLease: boolean,
): number | null {
  const attempt = hadStaleLease ? (currentAttempt ?? 1) + 1 : currentAttempt ?? 1;
  return attempt > FEEDBACK_MAX_ATTEMPTS ? null : attempt;
}

export function isFeedbackTerminalStatus(status: TaskStatus | string | null | undefined): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status as TaskStatus);
}

export interface FeedbackDecision {
  schedule: boolean;
  reason: string;
  delayMs: number;
}

export interface FeedbackTaskState {
  status: TaskStatus | string | null | undefined;
  assignmentStatus: string | null | undefined;
  submittedRedditUrl: string | null | undefined;
  deadlineMs: number | null | undefined;
  feedbackSent: boolean;
  formatCheckStatus?: string | null | undefined;
  createdAtMs?: number | null | undefined;
}

/**
 * Decides whether a link-less task or a task with a deleted post needs a stalling notice.
 * Schedules for:
 *   - delivered, still-active tasks with a parseable deadline and no feedback on record yet.
 *   - delivered, still-active tasks whose format check verified the post is DELETED on Reddit (immediate).
 * Anything else is a no-op with a reason.
 */
export function decideFeedbackAction(
  task: FeedbackTaskState,
  nowMs: number = Date.now(),
): FeedbackDecision {
  if (task.feedbackSent) {
    return { schedule: false, reason: 'feedback already sent', delayMs: 0 };
  }
  if (isFeedbackTerminalStatus(task.status)) {
    return { schedule: false, reason: `task ${task.status}`, delayMs: 0 };
  }
  if (task.assignmentStatus !== 'SENT') {
    return { schedule: false, reason: 'task not delivered yet', delayMs: 0 };
  }
  if (task.deadlineMs != null && nowMs - task.deadlineMs > FEEDBACK_STALE_AFTER_MS) {
    return { schedule: false, reason: 'deadline long past', delayMs: 0 };
  }
  if (task.createdAtMs != null && nowMs - task.createdAtMs > FEEDBACK_STALE_AFTER_MS) {
    return { schedule: false, reason: 'task created >24h ago', delayMs: 0 };
  }
  // Deleted post: link cannot be submitted, so an immediate stalling notice ("submitting in a bit") protects the new task.
  if (task.formatCheckStatus === 'DELETED') {
    return { schedule: true, reason: 'deleted post feedback', delayMs: 0 };
  }
  if (task.submittedRedditUrl && task.submittedRedditUrl.trim()) {
    return { schedule: false, reason: 'link already submitted', delayMs: 0 };
  }
  const delayMs = feedbackDueDelayMs(task.deadlineMs, nowMs);
  if (delayMs === null) {
    return { schedule: false, reason: 'no parseable deadline', delayMs: 0 };
  }
  return { schedule: true, reason: 'link-less task near deadline', delayMs };
}

/** Stored-job view the pending endpoint maps BullMQ jobs into. */
export interface StoredFeedbackJob {
  jobId: string;
  taskId: string;
  externalTaskId: string | null;
  attempt: number;
  leasedBy: string | null;
  leasedAt: number | null;
  createdTimestamp: number;
  delayMs: number;
}

/**
 * Due + unleased jobs, oldest-due first (executor polls this). A lease held
 * past the timeout is reclaimable (executor died mid-job).
 */
export function pickFeedbackJobs(
  jobs: StoredFeedbackJob[],
  nowMs: number = Date.now(),
  leaseTimeoutMs: number = FEEDBACK_LEASE_TIMEOUT_MS,
): StoredFeedbackJob[] {
  return jobs
    .filter((j) => j.createdTimestamp + j.delayMs <= nowMs)
    .filter((j) => !j.leasedBy || j.leasedAt == null || nowMs - j.leasedAt > leaseTimeoutMs)
    .sort((a, b) => a.createdTimestamp + a.delayMs - (b.createdTimestamp + b.delayMs));
}

/** Delay before the single feedback retry (transient in-page failure). */
export function feedbackRetryDelayFor(): number {
  return feedbackRetryDelayMs();
}
