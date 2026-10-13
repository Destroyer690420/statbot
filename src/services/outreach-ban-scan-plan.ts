/**
 * Pure next-fire math for the daily outreach ban scan: the round fires once
 * per day at 07:00:05 IST (morning, before the day's outreach work starts).
 * Zero imports — safe for unit tests (the scan service pulls the DB layer,
 * which validates env at import time). IST has no DST; fixed offset.
 */

export const BAN_SCAN_IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** Daily round fires at this IST wall-clock time. */
export const BAN_SCAN_HOUR_IST = 7;
export const BAN_SCAN_MIN_IST = 0;
export const BAN_SCAN_SEC_IST = 5;
/** Boot (or clock jump) landing just after 07:00:05 still serves the day. */
export const BAN_SCAN_LATE_GRACE_MS = 5 * 60 * 1000;
/** A late fire serves the day within seconds, never instantly (ordering). */
export const BAN_SCAN_LATE_DELAY_MS = 5 * 1000;

export interface BanScanPlan {
  /** ms from nowMs until the trigger should fire. */
  delayMs: number;
  /** IST day key being served (exactly-once guard). Month is 0-based, matching the hourly planner. */
  key: string;
  /** True when nowMs already passed 07:00:05 but is inside the late grace. */
  late: boolean;
}

function istParts(epochMs: number): { y: number; mo: number; d: number } {
  const d = new Date(epochMs + BAN_SCAN_IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}

function dayKey(y: number, mo: number, d: number): string {
  return `${y}-${mo}-${d}`;
}

/**
 * Pure next-fire computation. The candidate is always today's 07:00:05 in IST
 * wall time; past rounds roll exactly one day forward (month/year rollover
 * handled by decomposition, never manual +1 day). Late fires and next-day
 * fires can never share a key. Never throws — callers must never break boot
 * on a clock anomaly.
 *
 * `skipKey` is the day key the caller has ALREADY served. That day is then
 * never returned again (neither on time nor through the late grace), and
 * `delayMs` stays relative to `nowMs` in every branch.
 */
export function planNextBanScan(nowMs: number, skipKey?: string | null): BanScanPlan {
  try {
    const p = istParts(nowMs);
    const todayTarget = Date.UTC(p.y, p.mo, p.d, BAN_SCAN_HOUR_IST, BAN_SCAN_MIN_IST, BAN_SCAN_SEC_IST) - BAN_SCAN_IST_OFFSET_MS;
    const todayKey = dayKey(p.y, p.mo, p.d);
    if (todayKey !== skipKey) {
      if (todayTarget > nowMs) {
        return { delayMs: todayTarget - nowMs, key: todayKey, late: false };
      }
      if (nowMs - todayTarget < BAN_SCAN_LATE_GRACE_MS) {
        return { delayMs: BAN_SCAN_LATE_DELAY_MS, key: todayKey, late: true };
      }
    }
    // Exactly one day forward is genuinely the next round (month/year
    // rollover included via decomposition).
    const n = istParts(nowMs + 24 * 60 * 60 * 1000);
    const nextTarget = Date.UTC(n.y, n.mo, n.d, BAN_SCAN_HOUR_IST, BAN_SCAN_MIN_IST, BAN_SCAN_SEC_IST) - BAN_SCAN_IST_OFFSET_MS;
    return { delayMs: Math.max(nextTarget - nowMs, 1000), key: dayKey(n.y, n.mo, n.d), late: false };
  } catch {
    // Clock anomaly: retry in a minute, never crash the chain.
    return { delayMs: 60 * 1000, key: `retry-${Math.floor(nowMs / 60000)}`, late: false };
  }
}
