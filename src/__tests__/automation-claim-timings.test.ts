/**
 * Phase-0 claim timings: the shared verdict schema stays backward compatible
 * with old watchers, and the log payload builder never throws.
 * Pure module — no env or DB needed.
 */
import { buildClaimTimingsLog, claimTimingsSchema } from '../utils/claim-timings';

function makeClaim() {
  return {
    id: 'cmu00000000000000000000000',
    cycleId: 'burst-2026-09-16-00-00-test',
    externalTaskId: '12345',
    workerId: 'worker-1',
    createdAt: new Date(Date.now() - 15000),
  };
}

describe('claimTimingsSchema', () => {
  it('accepts a verdict body without timings (old watchers keep working)', () => {
    const body = { ok: true, pushed: true };
    expect(body).toMatchObject({ ok: true });
    // Timings field itself is optional/nullable at the verdict level.
    expect(claimTimingsSchema.parse(undefined)).toBeUndefined();
  });

  it('accepts full step timings and preserves values', () => {
    expect(
      claimTimingsSchema.parse({
        pollReceivedAt: 1757980000000,
        drawerOpenedMs: 1200,
        acceptedMs: 2500,
        pushedMs: 3100,
      }),
    ).toEqual({
      pollReceivedAt: 1757980000000,
      drawerOpenedMs: 1200,
      acceptedMs: 2500,
      pushedMs: 3100,
    });
  });

  it('accepts null and partial timings (steps never reached)', () => {
    expect(claimTimingsSchema.parse(null)).toBeNull();
    expect(
      claimTimingsSchema.parse({
        pollReceivedAt: 1757980000000,
        drawerOpenedMs: null,
        acceptedMs: null,
        pushedMs: null,
      }),
    ).toMatchObject({ drawerOpenedMs: null });
  });

  it('rejects negative durations and non-numeric steps', () => {
    expect(() => claimTimingsSchema.parse({ drawerOpenedMs: -5 })).toThrow();
    expect(() => claimTimingsSchema.parse({ acceptedMs: 'fast' })).toThrow();
  });
});

describe('buildClaimTimingsLog', () => {
  it('includes queue wait plus step durations on success', () => {
    const payload = buildClaimTimingsLog(makeClaim(), true, {
      pollReceivedAt: Date.now() - 12000,
      drawerOpenedMs: 1200,
      acceptedMs: 2500,
      pushedMs: 3100,
    });
    expect(payload).toMatchObject({ ok: true, drawerOpenedMs: 1200, acceptedMs: 2500, pushedMs: 3100 });
    expect(payload.queueWaitMs as number).toBeGreaterThanOrEqual(14000);
  });

  it('never throws and nulls missing steps on failure without timings', () => {
    for (const timings of [null, undefined]) {
      let payload: Record<string, unknown> = {};
      expect(() => {
        payload = buildClaimTimingsLog(makeClaim(), false, timings);
      }).not.toThrow();
      expect(payload).toMatchObject({
        ok: false,
        drawerOpenedMs: null,
        acceptedMs: null,
        pushedMs: null,
      });
    }
  });
});
