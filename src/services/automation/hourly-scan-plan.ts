/**
 * Pure next-fire math for the hourly auto-scan: the round fires at minute
 * 10, second 05 of EVERY IST hour (00:10:05, 01:10:05, ..., 23:10:05).
 * Zero imports — safe for unit tests (the trigger service pulls the DB
 * layer, which validates env at import time). IST has no DST; fixed offset.
 */

export const HOURLY_SCAN_ID = 'hourly';
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** Round fires at this minute past every IST hour. */
export const SCAN_MIN = 10;
/** Round fires at this second. */
export const SCAN_SEC = 5;
/** Boot (or clock jump) landing just after :10:05 still serves the hour. */
export const LATE_GRACE_MS = 5 * 60 * 1000;
/** A late fire serves the hour within seconds, never instantly (ordering). */
export const LATE_DELAY_MS = 5 * 1000;

export interface HourlyScanPlan {
  /** ms from nowMs until the trigger should fire. */
  delayMs: number;
  /** IST round key being served (date + actual hour, exactly-once guard). */
  key: string;
  /** True when nowMs already passed :10:05 but is inside the late grace. */
  late: boolean;
}

/**
 * Release gate for the hourly trigger: the digest is useful exactly when
 * a Blast tap can release it — same condition as the release path
 * (blast-approval.service: enabled && !dryRun). pollEnabled is NOT
 * consulted (it gates only the legacy scheduler cycles, not the
 * watcher-driven flow the digest serves).
 */
export function isHourlyScanAllowed(settings: { enabled: boolean; dryRun: boolean } | null): boolean {
  return !!settings?.enabled && !settings.dryRun;
}

function istParts(epochMs: number): { y: number; mo: number; d: number; h: number } {
  const d = new Date(epochMs + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}

function roundKey(y: number, mo: number, d: number, h: number): string {
  return `${y}-${mo}-${d} ${h}`;
}

/**
 * Pure next-fire computation. The candidate is always this hour's :10:05
 * in IST wall time; past rounds roll exactly one hour forward (date and
 * month/year boundaries handled by decomposition, never manual +1 day).
 * Late fires, retries, and next-hour fires can never share a key. Never
 * throws — callers must never break boot on a clock anomaly.
 *
 * `skipKey` is the round key the caller has ALREADY served. That hour is
 * then never returned again (neither on time nor through the late grace),
 * and — critically — `delayMs` stays relative to `nowMs` in every branch.
 * Never re-plan from any other reference (e.g. `lastServed.at + grace`):
 * a delay measured from a stale instant is armed as if it came from now, and
 * the chain then fires minutes early.
 */
export function planNextHourlyScan(nowMs: number, skipKey?: string | null): HourlyScanPlan {
  try {
    const p = istParts(nowMs);
    const thisHourTarget =
      Date.UTC(p.y, p.mo, p.d, p.h, SCAN_MIN, SCAN_SEC) - IST_OFFSET_MS;
    const thisKey = roundKey(p.y, p.mo, p.d, p.h);
    if (thisKey !== skipKey) {
      if (thisHourTarget > nowMs) {
        return { delayMs: thisHourTarget - nowMs, key: thisKey, late: false };
      }
      if (nowMs - thisHourTarget < LATE_GRACE_MS) {
        return { delayMs: LATE_DELAY_MS, key: thisKey, late: true };
      }
    }
    // Adding exactly one hour always advances the IST hour by one, so this
    // is genuinely the next round (date/month/year rollover included).
    const n = istParts(nowMs + 60 * 60 * 1000);
    const nextTarget =
      Date.UTC(n.y, n.mo, n.d, n.h, SCAN_MIN, SCAN_SEC) - IST_OFFSET_MS;
    return { delayMs: Math.max(nextTarget - nowMs, 1000), key: roundKey(n.y, n.mo, n.d, n.h), late: false };
  } catch {
    // Clock anomaly: retry in a minute, never crash the chain.
    return { delayMs: 60 * 1000, key: `retry-${Math.floor(nowMs / 60000)}`, late: false };
  }
}
