/**
 * GoPartTime link auto-submit — pure gating/scheduling logic.
 *
 * Pure module (no env, no DB, no Redis). The thin BullMQ wrapper lives in
 * services/submission.service.ts; everything decidable lives here and is
 * unit-tested. Follows the utils/survival-proof.ts split (TESTING.md §1).
 */
import {
  SUBMISSION_INITIAL_DELAY_MS,
  SUBMISSION_LEASE_TIMEOUT_MS,
  SUBMISSION_MAX_ATTEMPTS,
  SUBMISSION_RETRY_DELAYS_MS,
} from '../config/constants';
import { TaskType } from '../types';

/** Stable job id per task — a resubmission replaces the pending job. */
export function submissionJobIdFor(taskId: string): string {
  return `submit-${taskId}`;
}

/**
 * Submission gate: only verified links auto-submit.
 *  - POST + MATCH / PARA_EXTRA / TITLE_MISMATCH / TEXT_MISMATCH → submit.
 *    Only a SHORT post (dropped paragraphs) fails: collapsed GoPartTime
 *    content re-pasted with proper blank lines is correct formatting, and
 *    title/wording differences are accepted (owner directive, 2026-10-11).
 *  - COMMENT (+SKIPPED, by design — comments carry no format check) → submit.
 *  - EVERYTHING else (PARA_SHORT, FETCH_ERROR, DELETED, NO_SESSION,
 *    SESSION_EXPIRED, null) → never submit; manager reviews.
 */
export function shouldAutoSubmit(
  formatCheckStatus: string | null | undefined,
  taskType: TaskType | string,
): boolean {
  if (taskType === TaskType.COMMENT) return formatCheckStatus === 'SKIPPED';
  return (
    formatCheckStatus === 'MATCH' ||
    formatCheckStatus === 'PARA_EXTRA' ||
    formatCheckStatus === 'TITLE_MISMATCH' ||
    formatCheckStatus === 'TEXT_MISMATCH'
  );
}

export interface SubmissionDecision {
  enqueue: boolean;
  reason: string;
  delayMs: number;
}

/**
 * Decides what a (re)submission means for the queue. Latest submission wins:
 * callers remove any pending job for the task first, then enqueue when told.
 */
export function decideSubmissionAction(args: {
  taskType: TaskType | string;
  formatCheckStatus: string | null | undefined;
  submittedRedditUrl: string | null | undefined;
}): SubmissionDecision {
  if (!args.submittedRedditUrl || !args.submittedRedditUrl.trim()) {
    return { enqueue: false, reason: 'no submitted URL', delayMs: 0 };
  }
  if (!shouldAutoSubmit(args.formatCheckStatus, args.taskType)) {
    return {
      enqueue: false,
      reason: `format check ${args.formatCheckStatus || 'pending'} — manager review, not auto-submit`,
      delayMs: 0,
    };
  }
  return { enqueue: true, reason: 'verified link', delayMs: SUBMISSION_INITIAL_DELAY_MS };
}

/** Delay before retry attempt N (1-based initial attempt). attempt=1 → first retry. */
export function retryDelayFor(failedAttempt: number): number {
  return SUBMISSION_RETRY_DELAYS_MS[failedAttempt - 1] ?? SUBMISSION_RETRY_DELAYS_MS[0];
}

export function maxAttemptsReached(attempt: number): boolean {
  return attempt >= SUBMISSION_MAX_ATTEMPTS;
}

/** Stored-job view the pending endpoint maps BullMQ jobs into. */
export interface StoredSubmissionJob {
  jobId: string;
  taskId: string;
  externalTaskId: string | null;
  submittedRedditUrl: string;
  attempt: number;
  leasedBy: string | null;
  leasedAt: number | null;
  createdTimestamp: number;
  delayMs: number;
}

/**
 * Due + unleased jobs, oldest-due first. A lease held past the timeout is
 * reclaimable (executor died mid-job) — mirrors the accept-claim lease, as a
 * separate lease on the job itself (never the AutomationClaim table).
 */
export function pickSubmittableJobs(
  jobs: StoredSubmissionJob[],
  nowMs: number = Date.now(),
  leaseTimeoutMs: number = SUBMISSION_LEASE_TIMEOUT_MS,
): StoredSubmissionJob[] {
  return jobs
    .filter((j) => j.createdTimestamp + j.delayMs <= nowMs)
    .filter((j) => !j.leasedBy || !j.leasedAt || nowMs - j.leasedAt > leaseTimeoutMs)
    .sort((a, b) => a.createdTimestamp + a.delayMs - (b.createdTimestamp + b.delayMs));
}
