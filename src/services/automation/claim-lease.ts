/**
 * Phase-2 parallel-tab claim leasing — pure picker.
 *
 * Status stays PENDING until the verdict, so every existing held/taken
 * filter keeps working. A claim is leasable when it is PENDING, unexpired,
 * and either never leased, leased by the ASKING tab, or leased longer ago
 * than the lease timeout (stuck-tab reclaim). The repository enforces the
 * same rule atomically in the UPDATE guard; this picker only chooses the
 * oldest candidate. Pure module — no env or DB needed.
 */
export interface LeaseCandidate {
  id: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  leasedBy: string | null;
  leasedAt: Date | null;
}

/**
 * True when `tabId` may take this claim right now.
 *
 * A tab always re-may take its OWN live lease: the claim loop is serial per
 * tab, so the only way a tab polls again while its claim is still PENDING is
 * a fresh page context (reload / client-side return to /tasks) — exactly the
 * "leave the claim PENDING and retry on the next poll" contract. Without this
 * rule a single parked claim (tab off /tasks, list still rendering, one
 * reload for a fresh list, a lost verdict POST) stayed invisible to every tab
 * for the whole lease timeout — minutes of stall for a task whose worker was
 * already waiting. Other tabs still need the timeout, and a dead tab's claim
 * still falls back to it.
 */
export function isLeaseFree(
  claim: Pick<LeaseCandidate, 'leasedBy' | 'leasedAt'>,
  nowMs: number,
  leaseTimeoutMs: number,
  tabId?: string | null,
): boolean {
  if (!claim.leasedBy) return true;
  if (!claim.leasedAt) return true;
  if (tabId && claim.leasedBy === tabId) return true;
  return nowMs - claim.leasedAt.getTime() >= leaseTimeoutMs;
}

/**
 * Oldest PENDING, unexpired, leasable claim — or null when there is nothing
 * any tab may take. Input order does not matter. The owner re-entry path
 * keeps oldest-first, so a tab that parked a claim finishes it before taking
 * newer work (reply-order pairing preserved).
 */
export function pickLeaseCandidate(
  claims: LeaseCandidate[],
  nowMs: number,
  leaseTimeoutMs: number,
  tabId?: string | null,
): LeaseCandidate | null {
  let best: LeaseCandidate | null = null;
  for (const claim of claims) {
    if (!claim || claim.status !== 'PENDING') continue;
    if (claim.expiresAt.getTime() <= nowMs) continue;
    if (!isLeaseFree(claim, nowMs, leaseTimeoutMs, tabId)) continue;
    if (!best || claim.createdAt.getTime() < best.createdAt.getTime()) best = claim;
  }
  return best;
}
