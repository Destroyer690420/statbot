/**
 * Pure next-fire math for the hourly auto-scan (IST xx:10:05). Zero
 * imports — safe for unit tests (the trigger service pulls the DB layer,
 * which validates env at import time). IST has no DST; fixed offset.
 */

export const HOURLY_SCAN_ID = 'hourly';
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** The round fires at IST 10:05:05 (hour, minute, second). */
export const SCAN_HOUR = 10;
export const SCAN_MIN = 5;
export const SCAN_SEC = 5;
/** Boot (or clock jump) landing just after :10:05 still serves the hour. */
export const LATE_GRACE_MS = 5 * 60 * 1000;
/** A late fire serves the hour within seconds, never instantly (ordering). */
export const LATE_DELAY_MS = 5 * 1000;

export interface HourlyScanPlan {
  /** ms from nowMs until the trigger should fire. */
  delayMs: number;
  /** IST round key being served (target day + hour 10, exactly-once guard). */
  key: string;
  /** True when nowMs already passed :10:05 but is inside the late grace. */
  late: boolean;
}

function istParts(epochMs: number): { y: number; mo: number; d: number } {
  const d = new Date(epochMs + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}

function roundKey(y: number, mo: number, d: number): string {
  return `${y}-${mo}-${d} ${SCAN_HOUR}`;
}

/**
 * Pure next-fire computation. Late fires, retries, and tomorrow's fire
 * can never share a key. Never throws — callers must never break boot
 * on a clock anomaly.
 */
export function planNextHourlyScan(nowMs: number): HourlyScanPlan {
  try {
    const p = istParts(nowMs);
    const todayKey = roundKey(p.y, p.mo, p.d);
    const todayTarget =
      Date.UTC(p.y, p.mo, p.d, SCAN_HOUR, SCAN_MIN, SCAN_SEC) - IST_OFFSET_MS;
    if (todayTarget > nowMs) {
      return { delayMs: todayTarget - nowMs, key: todayKey, late: false };
    }
    if (nowMs - todayTarget < LATE_GRACE_MS) {
      return { delayMs: LATE_DELAY_MS, key: todayKey, late: true };
    }
    const next = new Date(nowMs + IST_OFFSET_MS + 24 * 60 * 60 * 1000);
    const ny = next.getUTCFullYear();
    const nmo = next.getUTCMonth();
    const nd = next.getUTCDate();
    const tomorrowTarget =
      Date.UTC(ny, nmo, nd, SCAN_HOUR, SCAN_MIN, SCAN_SEC) - IST_OFFSET_MS;
    return { delayMs: Math.max(tomorrowTarget - nowMs, 1000), key: roundKey(ny, nmo, nd), late: false };
  } catch {
    // Clock anomaly: retry in a minute, never crash the chain.
    return { delayMs: 60 * 1000, key: `retry-${Math.floor(nowMs / 60000)}`, late: false };
  }
}
