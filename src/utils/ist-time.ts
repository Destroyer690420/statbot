/**
 * IST (UTC+5:30) day-boundary helpers. The app stores timestamps as UTC
 * instants; "today"/"daily cycle" boundaries are computed by shifting UTC by
 * +5.5h (same technique as owner-earnings.service and payout.service).
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface IstDayBoundaries {
  dayStart: Date;
  dayEnd: Date;
  dayKey: string;
}

/**
 * Returns the current IST day as UTC instants [dayStart, dayEnd] plus a
 * `YYYY-MM-DD` key. E.g. 2026-08-18T00:00:00Z (05:30 IST) →
 * dayStart 2026-08-17T18:30:00Z, dayEnd 2026-08-18T18:29:59.999Z, dayKey
 * '2026-08-18'.
 */
export function getIstDayBoundaries(now: Date = new Date()): IstDayBoundaries {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);

  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const day = istNow.getUTCDate();

  const dayStartIST = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const dayEndIST = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

  return {
    dayStart: new Date(dayStartIST.getTime() - IST_OFFSET_MS),
    dayEnd: new Date(dayEndIST.getTime() - IST_OFFSET_MS),
    dayKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * True when a daily-cycle timestamp belongs to a previous IST day — used for
 * the lazy daily reset (at 00:00 IST the outreach cycle starts fresh).
 */
export function isStaleDailyCycle(messageSentAt: Date | null, dayStart: Date): boolean {
  return messageSentAt !== null && messageSentAt < dayStart;
}

/**
 * Start of the current IST hour as a UTC instant. Burst gating is hourly in
 * the manager's timezone (drops land at :10/:11 IST): one blast per IST hour,
 * later reports in the same hour merge silently instead of re-messaging.
 */
export function getIstHourStart(now: Date = new Date()): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const hourStartIST = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), istNow.getUTCHours(), 0, 0, 0),
  );
  return new Date(hourStartIST.getTime() - IST_OFFSET_MS);
}