/**
 * Burst eligibility helpers: scan window, in-page filter mirror, lazy-accept
 * picker. Pure module — no env or DB needed.
 */
import { isBurstActive, filterEligibleIds, pickNextTask, serializePooledTasks, parsePooledTasks } from '../services/automation/eligibility';
import { getIstHourStart } from '../utils/ist-time';

describe('isBurstActive', () => {
  // Absolute UTC instants (IST = UTC+5:30) — TZ-independent.
  it('is inactive outside :10–:15 IST', () => {
    expect(isBurstActive(new Date('2026-09-11T04:09:59.000Z'))).toBe(false); // 09:39 IST
    expect(isBurstActive(new Date('2026-09-11T04:09:50.000Z'))).toBe(false); // 09:39 IST
    expect(isBurstActive(new Date('2026-09-11T03:59:00.000Z'))).toBe(false); // 09:29 IST
    expect(isBurstActive(new Date('2026-09-11T04:46:00.000Z'))).toBe(false); // 10:16 IST
    expect(isBurstActive(new Date('2026-09-11T04:30:00.000Z'))).toBe(false); // 10:00 IST
  });

  it('is active from :10:00 through :15:59 IST', () => {
    expect(isBurstActive(new Date('2026-09-11T04:40:00.000Z'))).toBe(true); // 10:10 IST
    expect(isBurstActive(new Date('2026-09-11T04:41:30.000Z'))).toBe(true); // 10:11 IST
    expect(isBurstActive(new Date('2026-09-11T04:44:00.000Z'))).toBe(true); // 10:14 IST
    expect(isBurstActive(new Date('2026-09-11T04:45:59.000Z'))).toBe(true); // 10:15 IST
  });
});

describe('filterEligibleIds', () => {
  const blocked = ['nsfwfun', 'banned_sub'];

  it('keeps eligible posts in order', () => {
    const tasks = [
      { subTaskId: '1', type: 'post', subreddit: 'cute' },
      { subTaskId: '2', type: 'post', subreddit: 'alsocute' },
    ];
    expect(filterEligibleIds(tasks, blocked)).toEqual(['1', '2']);
  });

  it('drops posts with no readable subreddit (unblockable)', () => {
    const tasks = [
      { subTaskId: '1', type: 'post', subreddit: null },
      { subTaskId: '2', type: 'post', subreddit: '   ' },
      { subTaskId: '3', type: 'post', subreddit: 'ok' },
    ];
    expect(filterEligibleIds(tasks, blocked)).toEqual(['3']);
  });

  it('drops comments and blocked subreddits but keeps listed tasks regardless of history', () => {
    const tasks = [
      { subTaskId: '10', type: 'comment', subreddit: 'cute' },
      { subTaskId: '111', type: 'post', subreddit: 'cute' },
      { subTaskId: '12', type: 'post', subreddit: 'r/NsfwFun' },
      { subTaskId: '13', type: 'post', subreddit: 'https://www.reddit.com/r/banned_sub/' },
      { subTaskId: '14', type: 'post', subreddit: 'banned_sub2' },
    ];
    expect(filterEligibleIds(tasks, blocked)).toEqual(['111', '14']);
  });

  it('dedupes repeated ids and skips malformed entries', () => {
    const tasks = [
      { subTaskId: '5', type: 'post', subreddit: 'ok' },
      { subTaskId: '5', type: 'post', subreddit: 'ok' },
      { subTaskId: '', type: 'post', subreddit: 'ok' },
      null,
      undefined,
    ] as never[];
    expect(filterEligibleIds(tasks, blocked)).toEqual(['5']);
  });
});

describe('pickNextTask', () => {
  it('picks the first unheld task', () => {
    expect(pickNextTask(['a', 'b', 'c'], new Set(['a']))).toBe('b');
    expect(pickNextTask(['a', 'b'], [])).toBe('a');
  });

  it('returns null when everything is held or empty', () => {
    expect(pickNextTask(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(pickNextTask([], [])).toBeNull();
  });
});

describe('serializePooledTasks / parsePooledTasks', () => {
  it('round-trips id + subreddit + title', () => {
    const tasks = [
      { id: '1', subreddit: 'cute', title: 'hello' },
      { id: '2', subreddit: null, title: null },
    ];
    const parsed = parsePooledTasks(serializePooledTasks(tasks), []);
    expect(parsed).toEqual(tasks);
  });

  it('falls back to bare ids on missing or corrupt JSON', () => {
    expect(parsePooledTasks(null, ['a', 'b'])).toEqual([
      { id: 'a', subreddit: null, title: null },
      { id: 'b', subreddit: null, title: null },
    ]);
    expect(parsePooledTasks('not-json{{{', ['a'])).toEqual([{ id: 'a', subreddit: null, title: null }]);
    expect(parsePooledTasks('[{"id":"x"}]', [])).toEqual([{ id: 'x', subreddit: null, title: null }]);
  });
});

describe('getIstHourStart', () => {
  it('truncates to the IST hour start', () => {
    // 10:07 UTC = 15:37 IST -> 15:00 IST = 09:30 UTC.
    expect(getIstHourStart(new Date('2026-09-11T10:07:00.000Z'))).toEqual(new Date('2026-09-11T09:30:00.000Z'));
  });

  it('handles the IST midnight crossover', () => {
    // 18:31 UTC = 00:01 IST next day -> 00:00 IST = 18:30 UTC same day.
    expect(getIstHourStart(new Date('2026-09-11T18:31:00.000Z'))).toEqual(new Date('2026-09-11T18:30:00.000Z'));
  });
});
