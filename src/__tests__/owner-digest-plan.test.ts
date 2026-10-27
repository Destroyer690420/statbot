import {
  DIGEST_CATCHUP_GRACE_MS,
  DIGEST_LATE_DELAY_MS,
  digestWindowFromKey,
  describeDigestWeek,
  lastCompletedDigestWeekKey,
  parseDigestAuditDetails,
  planNextDigest,
} from '../services/owner-digest-plan';

/** UTC instant whose IST wall clock is the given y-m-d h:m (0-based month NOT used here). */
function istMs(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0) - 5.5 * 60 * 60 * 1000;
}

describe('digestWindowFromKey', () => {
  it('returns [Thursday 00:00 IST, next Thursday 00:00 IST − 1ms] for a Thursday key', () => {
    const { startUTC, endUTC } = digestWindowFromKey('2026-10-15');
    expect(startUTC.toISOString()).toBe('2026-10-14T18:30:00.000Z');
    expect(endUTC.toISOString()).toBe('2026-10-21T18:29:59.999Z');
  });

  it('rolls over months and years via decomposition', () => {
    // 2026-10-29 is a Thursday; +7 days lands on 2026-11-05.
    const oct = digestWindowFromKey('2026-10-29');
    expect(oct.startUTC.toISOString()).toBe('2026-10-28T18:30:00.000Z');
    expect(oct.endUTC.toISOString()).toBe('2026-11-04T18:29:59.999Z');

    // 2026-12-31 is a Thursday; +7 days lands on 2027-01-07.
    const dec = digestWindowFromKey('2026-12-31');
    expect(dec.startUTC.toISOString()).toBe('2026-12-30T18:30:00.000Z');
    expect(dec.endUTC.toISOString()).toBe('2027-01-06T18:29:59.999Z');
  });

  it('rejects malformed and non-Thursday keys', () => {
    expect(() => digestWindowFromKey('2026-10-16')).toThrow(/Thursday/); // Friday
    expect(() => digestWindowFromKey('2026-10-1')).toThrow(/Invalid digest week key/);
    expect(() => digestWindowFromKey('garbage')).toThrow(/Invalid digest week key/);
  });

  it('every day of a known week maps into exactly one window', () => {
    const { startUTC, endUTC } = digestWindowFromKey('2026-10-15');
    // Wednesday (last day) is inside; both Thursdays are not.
    expect(new Date(istMs(2026, 10, 21, 23, 59)).getTime()).toBeLessThanOrEqual(endUTC.getTime());
    expect(new Date(istMs(2026, 10, 21, 12, 0)).getTime()).toBeGreaterThanOrEqual(startUTC.getTime());
    expect(new Date(istMs(2026, 10, 22, 0, 0)).getTime()).toBeGreaterThan(endUTC.getTime());
    expect(new Date(istMs(2026, 10, 14, 23, 59)).getTime()).toBeLessThan(startUTC.getTime());
  });
});

describe('describeDigestWeek', () => {
  it('labels the window Thursday → Wednesday in IST', () => {
    expect(describeDigestWeek('2026-10-15')).toEqual({
      startLabel: 'Thu 15 Oct 2026',
      endLabel: 'Wed 21 Oct 2026',
    });
    expect(describeDigestWeek('2026-12-31')).toEqual({
      startLabel: 'Thu 31 Dec 2026',
      endLabel: 'Wed 6 Jan 2027',
    });
  });
});

describe('planNextDigest', () => {
  it('a Wednesday midday boot schedules the upcoming Thursday 00:10 IST for the still-running week', () => {
    const plan = planNextDigest(istMs(2026, 10, 28, 12, 0), null);
    expect(plan.key).toBe('2026-10-22');
    expect(plan.late).toBe(false);
    expect(plan.delayMs).toBe(istMs(2026, 10, 29, 0, 10) - istMs(2026, 10, 28, 12, 0));
  });

  it('just before the send moment it still schedules the same fire', () => {
    const plan = planNextDigest(istMs(2026, 10, 29, 0, 5), null);
    expect(plan.key).toBe('2026-10-22');
    expect(plan.late).toBe(false);
    expect(plan.delayMs).toBe(5 * 60 * 1000);
  });

  it('just after the send moment it catches the week up late', () => {
    const plan = planNextDigest(istMs(2026, 10, 29, 0, 12), null);
    expect(plan.key).toBe('2026-10-22');
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(DIGEST_LATE_DELAY_MS);
  });

  it('the catch-up skips a week the caller already served and rolls to next Thursday', () => {
    const plan = planNextDigest(istMs(2026, 10, 29, 0, 12), '2026-10-22');
    expect(plan.key).toBe('2026-10-29');
    expect(plan.late).toBe(false);
    expect(plan.delayMs).toBe(istMs(2026, 11, 5, 0, 10) - istMs(2026, 10, 29, 0, 12));
  });

  it('a boot on Friday morning within the catch-up grace still delivers the closed week', () => {
    // Friday 00:05 IST is 23h55m after the Thursday 00:10 send moment.
    const plan = planNextDigest(istMs(2026, 10, 23, 0, 5), null);
    expect(plan.key).toBe('2026-10-15');
    expect(plan.late).toBe(true);
    expect(plan.delayMs).toBe(DIGEST_LATE_DELAY_MS);
  });

  it('a boot beyond the catch-up grace never fires a stale week', () => {
    // Saturday noon is ~2.5 days after the send moment: the stale week is
    // skipped and the upcoming Thursday send takes over — which serves the
    // week starting this past Thursday (key = that Thursday).
    const plan = planNextDigest(istMs(2026, 10, 24, 12, 0), null);
    expect(plan.key).toBe('2026-10-22');
    expect(plan.late).toBe(false);
    expect(plan.delayMs).toBe(istMs(2026, 10, 29, 0, 10) - istMs(2026, 10, 24, 12, 0));
    // Sanity: the grace is what draws the line.
    expect(istMs(2026, 10, 24, 12, 0) - istMs(2026, 10, 22, 0, 10)).toBeGreaterThan(
      DIGEST_CATCHUP_GRACE_MS,
    );
  });

  it('rolls over the year boundary', () => {
    // Wednesday 2026-12-30 noon: past send moment, grace long gone → next
    // Thursday (Dec 31 00:10 IST), serving the week starting Dec 24.
    const before = planNextDigest(istMs(2026, 12, 30, 12, 0), null);
    expect(before.key).toBe('2026-12-24');
    expect(before.late).toBe(false);
    expect(before.delayMs).toBe(istMs(2026, 12, 31, 0, 10) - istMs(2026, 12, 30, 12, 0));

    // Just after that fire, the served key is Dec 24; the chain rolls to the
    // January 7 send, which serves the week starting Dec 31.
    const after = planNextDigest(istMs(2026, 12, 31, 0, 12), '2026-12-24');
    expect(after.key).toBe('2026-12-31');
    expect(after.late).toBe(false);
    expect(after.delayMs).toBe(istMs(2027, 1, 7, 0, 10) - istMs(2026, 12, 31, 0, 12));
  });

  it('never throws on a clock anomaly and retries in a minute', () => {
    const plan = planNextDigest(Number.NaN, null);
    expect(plan.delayMs).toBe(60 * 1000);
  });
});

describe('lastCompletedDigestWeekKey', () => {
  it('a mid-week Tuesday resolves the previous Thursday-started week', () => {
    expect(lastCompletedDigestWeekKey(istMs(2026, 10, 27, 15, 0))).toBe('2026-10-15');
  });

  it('early Thursday morning the week that closed at 00:00 is already complete', () => {
    expect(lastCompletedDigestWeekKey(istMs(2026, 10, 22, 3, 0))).toBe('2026-10-15');
    expect(lastCompletedDigestWeekKey(istMs(2026, 10, 29, 0, 5))).toBe('2026-10-22');
  });
});

describe('parseDigestAuditDetails', () => {
  it('parses the week key out of the marker, ignoring suffixes', () => {
    expect(parseDigestAuditDetails('owner-digest:2026-10-15')).toBe('2026-10-15');
    expect(parseDigestAuditDetails('owner-digest:2026-10-15 [late]')).toBe('2026-10-15');
    expect(parseDigestAuditDetails('owner-digest:garbage')).toBeNull();
    expect(parseDigestAuditDetails('something else')).toBeNull();
    expect(parseDigestAuditDetails(null)).toBeNull();
    expect(parseDigestAuditDetails(undefined)).toBeNull();
  });
});
