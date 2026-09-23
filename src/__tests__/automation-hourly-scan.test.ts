/**
 * Hourly auto-scan trigger planning. Pure IST math — no timers, no DB.
 * IST = UTC+5:30 (fixed, no DST). The round fires at minute 10, second 05
 * of EVERY IST hour. These cases pin hourly behavior across the whole
 * day — morning-only coverage once let a once-daily bug through.
 */
import { planNextHourlyScan } from '../services/automation/hourly-scan-plan';

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
