/**
 * Daily outreach ban scan planning. Pure IST math — no timers, no DB.
 * IST = UTC+5:30 (fixed, no DST). The round fires once per day at 07:00:05
 * IST. These cases pin daily behavior across day/month boundaries — an
 * hourly-only suite once let a once-daily bug through.
 */
import { planNextBanScan } from '../services/outreach-ban-scan-plan';

const MIN = 60 * 1000;

describe('planNextBanScan', () => {
  it('fires today when before 07:00:05 (early morning)', () => {
    // 05:30 IST = 00:00 UTC → 07:00:05 IST = 01:30:05 UTC.
    const now = Date.UTC(2026, 9, 13, 0, 0, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-9-13');
    expect(plan.delayMs).toBe(90 * MIN + 5 * 1000);
  });

  it('fires minutes ahead just before the round', () => {
    // 06:54 IST = 01:24 UTC → 07:00:05 IST = 01:30:05 UTC.
    const now = Date.UTC(2026, 9, 13, 1, 24, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-9-13');
    expect(plan.delayMs).toBe(6 * MIN + 5 * 1000);
  });

  it('late-fires inside the grace window after 07:00:05', () => {
    // 07:02 IST — round missed by ~2 min, still served now.
    const now = Date.UTC(2026, 9, 13, 1, 32, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(5 * 1000);
    expect(plan.key).toBe('2026-9-13');
  });

  it('rolls to tomorrow past the grace window (morning, not today)', () => {
    // 07:20 IST — 07:00:05 is ~20 min gone → Oct 14 07:00:05 IST.
    const now = Date.UTC(2026, 9, 13, 1, 50, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-9-14');
    // Tomorrow 07:00:05 IST = 01:30:05 UTC Oct 14.
    expect(now + plan.delayMs).toBe(Date.UTC(2026, 9, 14, 1, 30, 5));
  });

  it('fires in the afternoon for tomorrow (never today)', () => {
    // 14:00 IST Oct 13 = 08:30 UTC → Oct 14 07:00:05 IST = 01:30:05 UTC.
    const now = Date.UTC(2026, 9, 13, 8, 30, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-9-14');
    expect(now + plan.delayMs).toBe(Date.UTC(2026, 9, 14, 1, 30, 5));
  });

  it('crosses a month boundary into the next month', () => {
    // 23:50 IST Oct 31 = 18:20 UTC → Nov 1 07:00:05 IST = 01:30:05 UTC.
    const now = Date.UTC(2026, 9, 31, 18, 20, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2026-10-1');
    expect(now + plan.delayMs).toBe(Date.UTC(2026, 10, 1, 1, 30, 5));
  });

  it('crosses a year boundary into January', () => {
    // 23:50 IST Dec 31 = 18:20 UTC → Jan 1 07:00:05 IST.
    const now = Date.UTC(2026, 11, 31, 18, 20, 0);
    const plan = planNextBanScan(now);
    expect(plan.late).toBe(false);
    expect(plan.key).toBe('2027-0-1');
    expect(now + plan.delayMs).toBe(Date.UTC(2027, 0, 1, 1, 30, 5));
  });
});

describe('planNextBanScan after the day was already served', () => {
  const SERVED = '2026-9-13';
  const targetOf = (key: string): number => {
    const [y, mo, d] = key.split('-').map(Number);
    return Date.UTC(y, mo, d, 7, 0, 5) - 5.5 * 60 * MIN;
  };

  it('moves straight to tomorrow after a normal 07:00:05 fire', () => {
    // 07:00:06 IST, right after the round fired.
    const now = Date.UTC(2026, 9, 13, 1, 30, 6);
    const plan = planNextBanScan(now, SERVED);
    expect(plan.key).toBe('2026-9-14');
    expect(plan.late).toBe(false);
    expect(now + plan.delayMs).toBe(targetOf('2026-9-14'));
  });

  it('never re-plans into the served day, at any hour of that day', () => {
    // Every 2h step from the fire to late evening — the chain must never
    // hand the served day back.
    const dayStart = Date.UTC(2026, 9, 13, 1, 30, 5);
    for (let t = 0; t < 20 * 60 * MIN; t += 2 * 60 * MIN) {
      const now = dayStart + t;
      const plan = planNextBanScan(now, SERVED);
      expect(plan.key).not.toBe(SERVED);
      expect(plan.key).toBe('2026-9-14');
      expect(now + plan.delayMs).toBe(targetOf('2026-9-14'));
    }
  });

  it('still late-serves today on a fresh boot (no served key)', () => {
    // Restart 2 min after 07:00:05 — the day was never served, so the grace
    // must still deliver it instead of skipping to tomorrow.
    const now = Date.UTC(2026, 9, 13, 1, 32, 0); // 07:02 IST
    const plan = planNextBanScan(now, null);
    expect(plan.late).toBe(true);
    expect(plan.key).toBe(SERVED);
    expect(plan.delayMs).toBe(5 * 1000);
  });

  it('serves on time when nothing was served yet', () => {
    const now = Date.UTC(2026, 9, 13, 0, 0, 0); // 05:30 IST
    const plan = planNextBanScan(now, undefined);
    expect(plan.key).toBe(SERVED);
    expect(now + plan.delayMs).toBe(targetOf(SERVED));
  });
});
