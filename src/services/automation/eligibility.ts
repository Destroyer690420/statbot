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
 * as the safety net).
 *  - Post-only (comments never burst)
 *  - subreddit must be readable (null-subreddit tasks are rejected server-side
 *    too — they can never be checked against the blocked list)
 *  - normalized subreddit not in the blocked set
 * Deliberately NO duplicate/history check: listed + available means takeable
 * (an accepted task vanishes from the listing, so history never disqualifies
 * a listed task); the /assign 409 backstop still guards double delivery.
 */
export function filterEligibleIds(
  tasks: BurstCandidate[],
  blocked: ReadonlySet<string> | readonly string[],
): string[] {
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t || typeof t.subTaskId !== 'string' || t.subTaskId.length === 0) continue;
    if (seen.has(t.subTaskId)) continue;
    seen.add(t.subTaskId);
    if (t.type !== 'post') continue;
    const normalized = normalizeSubreddit(t.subreddit);
    if (!normalized) continue;
    if (blockedSet.has(normalized)) continue;
    out.push(t.subTaskId);
  }
  return out;
}

/**
 * New-task diff: eligible ids minus tasks already pooled minus tasks already
 * held by live claims. Used when growing a blast pool without re-messaging.
 */
export function diffNewTasks(
  eligibleIds: readonly string[],
  pooledIds: ReadonlySet<string> | readonly string[],
  heldIds: ReadonlySet<string> | readonly string[],
): string[] {
  const pooled = pooledIds instanceof Set ? pooledIds : new Set(pooledIds);
  const held = heldIds instanceof Set ? heldIds : new Set(heldIds);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of eligibleIds) {
    if (seen.has(id) || pooled.has(id) || held.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Merge-grace check: streaming completions may join the pool shortly after
 * the blast opens (same messages, grown slots); later arrivals wait for
 * next hour. Pure time comparison on the burst's creation instant.
 */
export function isMergeAllowed(
  burstCreatedAt: Date | null | undefined,
  nowMs: number = Date.now(),
  graceMs: number = AUTOMATION.BURST_MERGE_GRACE_MS,
): boolean {
  if (!burstCreatedAt) return false;
  return nowMs - burstCreatedAt.getTime() <= graceMs;
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
