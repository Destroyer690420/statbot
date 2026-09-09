/**
 * Pure slot math for Outreach Blast campaigns.
 * A reply wins a slot when its 1-based position among the blast's replies
 * is within the slots total; the blast closes exactly when filled == total.
 */

/** True when the reply at 1-based `position` claims one of `slotsTotal` slots. */
export function isSlotWinner(position: number, slotsTotal: number): boolean {
  if (!Number.isInteger(position) || position < 1) return false;
  if (!Number.isInteger(slotsTotal) || slotsTotal < 1) return false;
  return position <= slotsTotal;
}

/** True when the blast has no slots left. */
export function isBlastFull(slotsFilled: number, slotsTotal: number): boolean {
  if (!Number.isInteger(slotsTotal) || slotsTotal < 1) return true;
  return slotsFilled >= slotsTotal;
}

/** True when the worker hit the daily cap (cap 2 → 2+ assigned today skips). */
export function isAtDailyCap(assignedToday: number, cap: number): boolean {
  return assignedToday >= cap;
}
