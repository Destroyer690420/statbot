import { automationRepository, taskRepository } from '../../database/repositories';
import { GOPARTTIME_SOURCE } from '../../config/constants';
import { normalizeSubreddit } from './subreddit';
import type { DetectedGoPartTimeTask, ValidationResult } from '../../types';

/**
 * Validation engine (spec §11-12, §51 rules 1-3):
 *  1. type must be Post (comments ignored entirely)
 *  2. externalTaskId must not already exist — SKIPPED when
 *     opts.skipDuplicate (burst flow: listed + available means takeable;
 *     an accepted task vanishes from the listing, so anything still
 *     listed is fair game regardless of history; the /assign 409 backstop
 *     still guards double delivery)
 *  3. subreddit must be readable AND not blocked (exact normalized match).
 *     A post with no readable subreddit is NEVER eligible — it cannot be
 *     checked against the blocked list, so it is rejected for safety.
 * Worker confirmation is enforced by the cycle service (§12 rule 4), not here.
 */
export async function validateDetectedTask(
  task: DetectedGoPartTimeTask,
  opts: { skipDuplicate?: boolean } = {},
): Promise<ValidationResult> {
  if (task.type !== 'post') {
    return { eligible: false, reason: 'SKIPPED_COMMENT', detail: `Task ${task.subTaskId} type=${task.type}` };
  }

  if (!opts.skipDuplicate) {
    const existing = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, task.subTaskId);
    if (existing) {
      return { eligible: false, reason: 'DUPLICATE', detail: `Task ${task.subTaskId} already exists as ${existing.id}` };
    }
  }

  const normalized = normalizeSubreddit(task.subreddit);
  if (!normalized) {
    return { eligible: false, reason: 'NO_SUBREDDIT', detail: `Task ${task.subTaskId} subreddit unreadable — skipped for safety` };
  }
  const blocked = await automationRepository.isBlocked(normalized);
  if (blocked) {
    return { eligible: false, reason: 'BLOCKED', detail: `r/${normalized} is blocked` };
  }

  return { eligible: true, reason: 'ELIGIBLE' };
}

/**
 * Same rules as `validateDetectedTask(..., { skipDuplicate: true })`, but pure
 * and synchronous: the caller supplies the already-fetched blocked set, so a
 * whole drop costs ONE indexed read instead of one point lookup per task.
 *
 * This exists because the burst report cap used to be 20 tasks; with it lifted
 * to 200, a per-task blocked lookup would mean 200 serial round-trips on the
 * blast's critical path. `blockedSubs` must contain the same normalized values
 * that `automationRepository.isBlocked` would have matched (it stores
 * normalized subreddits), so `Set.has` is exactly the old `findUnique`.
 *
 * The check ORDER is identical to the skipDuplicate path: post-only, then
 * subreddit readable, then blocked. `automation-burst-digest.test.ts` asserts
 * this function and the async one agree across a matrix of inputs, so the two
 * cannot drift.
 */
export function evaluateForBurst(
  task: DetectedGoPartTimeTask,
  blockedSubs: ReadonlySet<string>,
): ValidationResult {
  if (task.type !== 'post') {
    return { eligible: false, reason: 'SKIPPED_COMMENT', detail: `Task ${task.subTaskId} type=${task.type}` };
  }

  const normalized = normalizeSubreddit(task.subreddit);
  if (!normalized) {
    return { eligible: false, reason: 'NO_SUBREDDIT', detail: `Task ${task.subTaskId} subreddit unreadable — skipped for safety` };
  }
  if (blockedSubs.has(normalized)) {
    return { eligible: false, reason: 'BLOCKED', detail: `r/${normalized} is blocked` };
  }

  return { eligible: true, reason: 'ELIGIBLE' };
}
