import { normalizeSubreddit } from './subreddit';

export interface BurstCandidate {
  subTaskId: string;
  type: string;
  subreddit: string | null;
}

/**
 * Burst scan window in the manager browser's LOCAL time (the drop schedule
 * is observed in that timezone): minute :09 from second 50 through minute
 * :15 inclusive. Covers the :10/:11 drops plus :14/:15 leaks.
 */
export function isBurstActive(now: Date = new Date()): boolean {
  const m = now.getMinutes();
  if (m === 9) return now.getSeconds() >= 50;
  return m >= 10 && m <= 15;
}

/**
 * In-page eligibility mirror of `validateDetectedTask` (server re-validates
 * as the safety net; the DB duplicate check there is authoritative).
 *  - Post-only (comments never burst)
 *  - subTaskId not in the recent-accepted set (duplicate)
 *  - normalized subreddit not in the blocked set (null subreddit passes,
 *    exactly like the server validator)
 */
export function filterEligibleIds(
  tasks: BurstCandidate[],
  blocked: ReadonlySet<string> | readonly string[],
  recentIds: ReadonlySet<string> | readonly string[],
): string[] {
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked);
  const recentSet = recentIds instanceof Set ? recentIds : new Set(recentIds);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t || typeof t.subTaskId !== 'string' || t.subTaskId.length === 0) continue;
    if (seen.has(t.subTaskId)) continue;
    seen.add(t.subTaskId);
    if (t.type !== 'post') continue;
    if (recentSet.has(t.subTaskId)) continue;
    const normalized = normalizeSubreddit(t.subreddit);
    if (normalized && blockedSet.has(normalized)) continue;
    out.push(t.subTaskId);
  }
  return out;
}

/**
 * Lazy-accept picker: first eligible task with no live (PENDING/CLAIMED)
 * claim in this cycle. Returns null when every task is already held.
 */
export function pickNextTask(taskIds: readonly string[], claimedIds: ReadonlySet<string> | readonly string[]): string | null {
  const claimed = claimedIds instanceof Set ? claimedIds : new Set(claimedIds);
  for (const id of taskIds) {
    if (!claimed.has(id)) return id;
  }
  return null;
}
