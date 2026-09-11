import { normalizeSubreddit } from './subreddit';
import { AUTOMATION } from '../../config/constants';
import { IST_OFFSET_MS } from '../../utils/ist-time';

export interface BurstCandidate {
  subTaskId: string;
  type: string;
  subreddit: string | null;
}

/**
 * Burst scan window in IST (the drop schedule is IST-based): minutes :10
 * through :15 inclusive, every hour. Blasts may ONLY open inside this
 * window — the scan runs at exactly xx:10, nowhere else, no other time.
 */
export function isBurstActive(now: Date = new Date()): boolean {
  const istMinutes = new Date(now.getTime() + IST_OFFSET_MS).getUTCMinutes();
  return istMinutes >= 10 && istMinutes <= 15;
}

/**
 * In-page eligibility mirror of `validateDetectedTask` (server re-validates
 * as the safety net; the DB duplicate check there is authoritative).
 *  - Post-only (comments never burst)
 *  - subTaskId not in the recent-accepted set (duplicate)
 *  - subreddit must be readable (null-subreddit tasks are rejected server-side
 *    too — they can never be checked against the blocked list)
 *  - normalized subreddit not in the blocked set
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
    if (!normalized) continue;
    if (blockedSet.has(normalized)) continue;
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

/**
 * Fresh-arrival test for the burst gate: a task counts as new only when first
 * seen within the TTL. Stale listings (seen longer ago) never open blasts.
 */
export function isFreshArrival(
  firstSeenAt: Date | null | undefined,
  nowMs: number = Date.now(),
  ttlMs: number = AUTOMATION.BURST_FRESH_MS,
): boolean {
  if (!firstSeenAt) return true;
  return firstSeenAt.getTime() >= nowMs - ttlMs;
}

export interface PooledTask {
  id: string;
  subreddit: string | null;
  title: string | null;
}

/**
 * Serializes pooled burst tasks (id + subreddit survive in the DB row, so
 * leftover re-validation keeps its blocked-list teeth).
 */
export function serializePooledTasks(tasks: PooledTask[]): string {
  return JSON.stringify(
    tasks.map((t) => ({ id: t.id, subreddit: t.subreddit, title: t.title })),
  );
}

/**
 * Parses stored pooled tasks. Falls back to bare ids (unknown subreddit —
 * the validator rejects those for safety) when the JSON is missing/legacy.
 */
export function parsePooledTasks(json: string | null | undefined, fallbackIds: readonly string[]): PooledTask[] {
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (p): p is { id: unknown; subreddit: unknown; title: unknown } =>
              !!p && typeof p === 'object',
          )
          .map((p) => ({
            id: String((p as { id: unknown }).id ?? ''),
            subreddit:
              typeof (p as { subreddit: unknown }).subreddit === 'string'
                ? ((p as { subreddit: string }).subreddit as string)
                : null,
            title:
              typeof (p as { title: unknown }).title === 'string'
                ? ((p as { title: string }).title as string)
                : null,
          }))
          .filter((p) => p.id.length > 0);
      }
    } catch {
      // fall through to id fallback
    }
  }
  return fallbackIds.map((id) => ({ id, subreddit: null, title: null }));
}
