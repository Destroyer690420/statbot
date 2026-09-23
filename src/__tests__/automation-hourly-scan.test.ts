/**
 * Hourly auto-scan trigger planning. Pure IST math — no timers, no DB.
 * IST = UTC+5:30 (fixed, no DST). The round fires at IST xx:10:05.
 */
import { planNextHourlyScan } from '../services/automation/hourly-scan-plan';

const MIN = 60 * 1000;

describe('planNextHourlyScan', () => {
  it('schedules today when before IST 10:05', () => {
    // 09:30 IST = 04:00 UTC.
    const now = Date.UTC(2026, 8, 22, 4, 0, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-22 10');
    expect(plan.delayMs).toBe(35 * MIN + 5 * 1000);
  });

  it('schedules minutes ahead just before the round', () => {
    // 10:04:00 IST = 04:34:00 UTC → fires in 65s.
    const now = Date.UTC(2026, 8, 22, 4, 34, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.delayMs).toBe(65 * 1000);
  });

  it('late-fires inside the grace window after :10:05', () => {
    // 10:07 IST — round missed by 2 min, still served now.
    const now = Date.UTC(2026, 8, 22, 4, 37, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(5 * 1000);
    expect(plan.key).toBe('2026-8-22 10');
  });

  it('schedules tomorrow when past the grace window', () => {
    // 11:00 IST = 05:30 UTC → tomorrow 10:05 IST = 04:35 UTC next day.
    const now = Date.UTC(2026, 8, 22, 5, 30, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-23 10');
    expect(plan.delayMs).toBe(Date.UTC(2026, 8, 23, 4, 35, 5) - now);
  });

  it('crosses IST midnight correctly', () => {
    // 23:50 IST Sept 22 = 18:20 UTC → Sept 23 10:05 IST.
    const now = Date.UTC(2026, 8, 22, 18, 20, 0);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-8-23 10');
    expect(plan.delayMs).toBe(Date.UTC(2026, 8, 23, 4, 35, 5) - now);
  });

  it('fires immediately when landing exactly on :10:05', () => {
    const now = Date.UTC(2026, 8, 22, 4, 35, 5);
    const plan = planNextHourlyScan(now);
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(5 * 1000);
  });
});
