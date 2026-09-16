/**
 * Phase-2 parallel-tab claim leasing — pure picker.
 *
 * Status stays PENDING until the verdict, so every existing held/taken
 * filter keeps working. A claim is leasable when it is PENDING, unexpired,
 * and either never leased or leased longer ago than the lease timeout
 * (stuck-tab reclaim). The repository enforces the same rule atomically in
 * the UPDATE guard; this picker only chooses the oldest candidate.
 * Pure module — no env or DB needed.
 */
export interface LeaseCandidate {
  id: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  leasedBy: string | null;
  leasedAt: Date | null;
}

/** True when no live tab holds this claim right now. */
export function isLeaseFree(
  claim: Pick<LeaseCandidate, 'leasedBy' | 'leasedAt'>,
  nowMs: number,
  leaseTimeoutMs: number,
): boolean {
  if (!claim.leasedBy) return true;
  if (!claim.leasedAt) return true;
  return nowMs - claim.leasedAt.getTime() >= leaseTimeoutMs;
}

/**
 * Oldest PENDING, unexpired, leasable claim — or null when there is nothing
 * any tab may take. Input order does not matter.
 */
export function pickLeaseCandidate(
  claims: LeaseCandidate[],
  nowMs: number,
  leaseTimeoutMs: number,
): LeaseCandidate | null {
  let best: LeaseCandidate | null = null;
  for (const claim of claims) {
    if (!claim || claim.status !== 'PENDING') continue;
    if (claim.expiresAt.getTime() <= nowMs) continue;
    if (!isLeaseFree(claim, nowMs, leaseTimeoutMs)) continue;
    if (!best || claim.createdAt.getTime() < best.createdAt.getTime()) best = claim;
  }
  return best;
}
