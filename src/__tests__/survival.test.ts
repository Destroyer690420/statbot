import {
  SURVIVAL_CHECK_DELAY_MS,
  SURVIVAL_TTL_MS,
  SURVIVAL_MAX_ATTEMPTS,
  SURVIVAL_RETRY_DELAYS_MS,
} from '../config/constants';
import {
  survivalDueAt,
  survivalJobIdFor,
  resolveSurvivalUrl,
  normalizeSurvivalUrl,
  parseCookieHeader,
  mapSurvivalError,
} from '../utils/survival-proof';

// NOTE: imports stay in utils/constants only — survival.service pulls
// src/config/env.ts (process.exit without full env), so it must never be
// imported here (see docs/TESTING.md §1).

describe('survival proof scheduling', () => {
  it('fires 11 minutes after the anchor', () => {
    const anchor = new Date('2026-10-08T10:00:00Z');
    expect(survivalDueAt(anchor).toISOString()).toBe('2026-10-08T10:11:00.000Z');
    expect(SURVIVAL_CHECK_DELAY_MS).toBe(11 * 60 * 1000);
  });

  it('uses a stable job id so resubmission cancels and restarts the timer', () => {
    expect(survivalJobIdFor('ABC')).toBe('survival-ABC');
  });

  it('keeps proof for 15 days with 2 transient retries', () => {
    expect(SURVIVAL_TTL_MS).toBe(15 * 24 * 60 * 60 * 1000);
    expect(SURVIVAL_MAX_ATTEMPTS).toBe(3);
    expect([...SURVIVAL_RETRY_DELAYS_MS]).toEqual([2 * 60 * 1000, 5 * 60 * 1000]);
  });

  it('prefers the latest submitted URL, falls back to the manual redditUrl', () => {
    expect(
      resolveSurvivalUrl({ submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/', redditUrl: 'https://www.reddit.com/r/y/2' }),
    ).toBe('https://www.reddit.com/r/x/comments/1/');
    expect(resolveSurvivalUrl({ submittedRedditUrl: null, redditUrl: 'https://www.reddit.com/r/y/2' })).toBe(
      'https://www.reddit.com/r/y/2',
    );
    expect(resolveSurvivalUrl({ submittedRedditUrl: '  ', redditUrl: null })).toBeNull();
  });
});

describe('normalizeSurvivalUrl', () => {
  it('strips query, fragment and trailing slashes, normalizes hosts', () => {
    expect(normalizeSurvivalUrl('https://old.reddit.com/r/x/comments/abc/title/?utm=1#x')).toBe(
      'https://www.reddit.com/r/x/comments/abc/title',
    );
    expect(normalizeSurvivalUrl('https://sh.reddit.com/r/x/comments/abc/')).toBe('https://www.reddit.com/r/x/comments/abc');
  });

  it('rejects non-reddit urls', () => {
    expect(normalizeSurvivalUrl('https://goparttime.net/tasks')).toBeNull();
    expect(normalizeSurvivalUrl('not a url')).toBeNull();
  });
});

describe('parseCookieHeader', () => {
  it('splits pairs and skips attributes/empties', () => {
    const out = parseCookieHeader('reddit_session=abc123; token=def456; Path=/; empty=; =novalue');
    expect(out.map((c) => c.name)).toEqual(['reddit_session', 'token']);
    expect(out[0]).toMatchObject({ domain: '.reddit.com', path: '/', secure: true });
  });
});

describe('mapSurvivalError', () => {
  it('never retries session/block failures (DM instead)', () => {
    expect(mapSurvivalError('SurvivalNoSessionError', 'x')).toEqual(
      expect.objectContaining({ status: 'NO_SESSION', retryable: false }),
    );
    expect(mapSurvivalError('SurvivalSessionExpiredError', 'x').retryable).toBe(false);
    expect(mapSurvivalError('SurvivalBlockedError', 'x')).toEqual(
      expect.objectContaining({ status: 'BLOCKED', retryable: false }),
    );
  });

  it('retries rate-limits and network blips', () => {
    expect(mapSurvivalError('SurvivalRateLimitedError', 'x')).toEqual(
      expect.objectContaining({ status: 'FETCH_ERROR', retryable: true }),
    );
    expect(mapSurvivalError('Error', 'socket timed out').retryable).toBe(true);
  });

  it('does not retry unknown permanent errors', () => {
    expect(mapSurvivalError('Error', 'Not a Reddit URL.').retryable).toBe(false);
  });
});
