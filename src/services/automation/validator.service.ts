import { automationRepository, taskRepository } from '../../database/repositories';
import { GOPARTTIME_SOURCE } from '../../config/constants';
import { normalizeSubreddit } from './subreddit';
import type { DetectedGoPartTimeTask, ValidationResult } from '../../types';

/**
 * Validation engine (spec §11-12, §51 rules 1-3):
 *  1. type must be Post (comments ignored entirely)
 *  2. externalTaskId must not already exist (app check; DB unique guard is the race backstop)
 *  3. subreddit must be readable AND not blocked (exact normalized match).
 *     A post with no readable subreddit is NEVER eligible — it cannot be
 *     checked against the blocked list, so it is rejected for safety.
 * Worker confirmation is enforced by the cycle service (§12 rule 4), not here.
 */
export async function validateDetectedTask(task: DetectedGoPartTimeTask): Promise<ValidationResult> {
  if (task.type !== 'post') {
    return { eligible: false, reason: 'SKIPPED_COMMENT', detail: `Task ${task.subTaskId} type=${task.type}` };
  }

  const existing = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, task.subTaskId);
  if (existing) {
    return { eligible: false, reason: 'DUPLICATE', detail: `Task ${task.subTaskId} already exists as ${existing.id}` };
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
