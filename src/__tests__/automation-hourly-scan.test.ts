/**
 * Hourly auto-scan trigger planning. Pure IST math — no timers, no DB.
 * IST = UTC+5:30 (fixed, no DST). The round fires at minute 10, second 05
 * of EVERY IST hour. These cases pin hourly behavior across the whole
 * day — morning-only coverage once let a once-daily bug through.
 */
import { isHourlyScanAllowed, planNextHourlyScan } from '../services/automation/hourly-scan-plan';

const MIN = 60 * 1000;

describe('planNextHourlyScan', () => {
  it('fires this hour when before :10:05 (morning)', () => {
    // 09:30 IST = 04:00 UTC → 10:10:05 IST = 04:40:05 UTC.
    const now = Date.UTC(2026, 8, 22, 4, 0, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 10');
    expect(plan.delayMs).toBe(40 * MIN + 5 * 1000);
  });

  it('fires minutes ahead just before the round', () => {
    // 10:04:00 IST = 04:34:00 UTC → 10:10:05 IST.
    const now = Date.UTC(2026, 8, 22, 4, 34, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 10');
    expect(plan.delayMs).toBe(6 * MIN + 5 * 1000);
  });

  it('late-fires inside the grace window after :10:05', () => {
    // 10:12 IST — round missed by ~2 min, still served now.
    const now = Date.UTC(2026, 8, 22, 4, 42, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(5 * 1000);
    expect(plan.key).toBe('2026-8-22 10');
  });

  it('fires this hour in the afternoon (not tomorrow morning)', () => {
    // 14:00 IST = 08:30 UTC → 14:10:05 IST = 08:40:05 UTC.
    // Regression: the first implementation scheduled tomorrow 10:05 AM.
    const now = Date.UTC(2026, 8, 22, 8, 30, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 14');
    expect(plan.delayMs).toBe(10 * MIN + 5 * 1000);
  });

  it('fires this hour in the evening', () => {
    // 18:40 IST = 13:10 UTC → 19:10:05 IST = 13:40:05 UTC.
    const now = Date.UTC(2026, 8, 22, 13, 10, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 19');
    expect(plan.delayMs).toBe(30 * MIN + 5 * 1000);
  });

  it('rolls to next hour past the grace window', () => {
    // 10:20 IST — 10:10:05 is 9m55s gone → 11:10:05 IST = 05:40:05 UTC.
    const now = Date.UTC(2026, 8, 22, 4, 50, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 11');
    expect(plan.delayMs).toBe(50 * MIN + 5 * 1000);
  });

  it('crosses IST midnight into the next day', () => {
    // 23:50 IST Sept 22 = 18:20 UTC → Sept 23 00:10:05 IST.
    const now = Date.UTC(2026, 8, 22, 18, 20, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-23 0');
    expect(plan.delayMs).toBe(20 * MIN + 5 * 1000);
  });

  it('fires immediately when landing exactly on :10:05', () => {
    const now = Date.UTC(2026, 8, 22, 4, 40, 5);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(5 * 1000);
    expect(plan.key).toBe('2026-8-22 10');
  });
});

describe('planNextHourlyScan after the hour was already served', () => {
  // The regression these pin: the trigger used to re-plan from
  // `lastServed.at + LATE_GRACE_MS + 1000` and then arm that delay as if it
  // were measured from now, so every post-fire round fired ~5 min early
  // (:05 instead of :10, i.e. before the drop) and spun on 5s no-op
  // re-plans for ~5 min. The service cannot be imported here (it pulls the
  // DB layer, which validates env at import time), so the contract it relies
  // on is pinned at the planner: `skipKey` is never returned, and delayMs is
  // ALWAYS relative to nowMs.
  const SERVED = '2026-8-22 10';
  /** Real :10:05 IST instant of a round key (month in the key is 0-based). */
  const targetOf = (key: string): number => {
    const [y, mo, d, h] = key.split(/[- ]/).map(Number);
    return Date.UTC(y, mo, d, h, 10, 5) - 5.5 * 60 * MIN;
  };

  it('moves straight to the next hour after a normal :10:05 fire', () => {
    // 10:10:06 IST, right after the round fired.
    const now = Date.UTC(2026, 8, 22, 4, 40, 6);
    const plan = planNextHourlyScan(now, SERVED);
    expect(plan.key).toBe('2026-8-22 11');
    expect(plan.late).toBe(false);
    expect(now + plan.delayMs).toBe(targetOf('2026-8-22 11'));
  });

  it('never re-plans into the served hour, in any second of that hour', () => {
    // Every 5s step from the :10:05 fire to the end of the served hour - the
    // old chain burned ~60 of these as no-op re-plans. 04:40:05 UTC is
    // 10:10:05 IST, so the loop covers IST hour 10 from its fire onwards.
    const hourStart = Date.UTC(2026, 8, 22, 4, 40, 5);
    for (let t = 0; t < 50 * MIN; t += 5 * 1000) {
      const now = hourStart + t;
      const plan = planNextHourlyScan(now, SERVED);
      expect(plan.key).not.toBe(SERVED);
      expect(plan.key).toBe('2026-8-22 11');
      // The delay must be measured from now, so the fire lands exactly on
      // the next :10:05 - never 5 minutes early.
      expect(now + plan.delayMs).toBe(targetOf('2026-8-22 11'));
    }
  });

  it('lands on :10:05 after an off-schedule (late) fire too', () => {
    // The old chain's real-world steady state: fired early at 11:05:05, so
    // the re-plan ran at 11:05:06 and armed a next hour at 12:05.
    const now = Date.UTC(2026, 8, 22, 5, 35, 6); // 11:05:06 IST
    const plan = planNextHourlyScan(now, '2026-8-22 11');
    expect(plan.key).toBe('2026-8-22 12');
    expect(now + plan.delayMs).toBe(targetOf('2026-8-22 12'));
  });

  it('rolls over IST midnight without touching the served day', () => {
    // 23:10:06 IST Sept 22 = 17:40:06 UTC → Sept 23 00:10:05 IST.
    const now = Date.UTC(2026, 8, 22, 17, 40, 6);
    const plan = planNextHourlyScan(now, '2026-8-22 23');
    expect(plan.key).toBe('2026-8-23 0');
    expect(now + plan.delayMs).toBe(targetOf('2026-8-23 0'));
  });

  it('still late-serves the current hour on a fresh boot (no served key)', () => {
    // Restart 2 min after :10:05 - the hour was never served, so the grace
    // must still deliver it instead of skipping to the next hour.
    const now = Date.UTC(2026, 8, 22, 4, 42, 0); // 10:12 IST
    const plan = planNextHourlyScan(now, null);
    expect(plan.late).toBe(true);
    expect(plan.key).toBe(SERVED);
    expect(plan.delayMs).toBe(5 * 1000);
  });

  it('serves on time when nothing was served yet', () => {
    const now = Date.UTC(2026, 8, 22, 4, 0, 0); // 09:30 IST
    const plan = planNextHourlyScan(now, undefined);
    expect(plan.key).toBe(SERVED);
    expect(now + plan.delayMs).toBe(targetOf(SERVED));
  });
});

describe('isHourlyScanAllowed', () => {
  it('allows exactly when a Blast tap could release (enabled, not dry-run)', () => {
    expect(isHourlyScanAllowed({ enabled: true, dryRun: false })).toBe(true);
    expect(isHourlyScanAllowed({ enabled: true, dryRun: true })).toBe(false);
    expect(isHourlyScanAllowed({ enabled: false, dryRun: false })).toBe(false);
    expect(isHourlyScanAllowed(null)).toBe(false);
  });
});
