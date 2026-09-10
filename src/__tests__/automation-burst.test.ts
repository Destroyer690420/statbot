/**
 * Burst eligibility helpers: scan window, in-page filter mirror, lazy-accept
 * picker. Pure module — no env or DB needed.
 */
import { isBurstActive, filterEligibleIds, pickNextTask } from '../services/automation/eligibility';

describe('isBurstActive', () => {
  function at(minute: number, second = 0): Date {
    const d = new Date('2026-09-11T10:00:00');
    d.setMinutes(minute, second, 0);
    return d;
  }

  it('is inactive outside the window', () => {
    expect(isBurstActive(at(8, 0))).toBe(false);
    expect(isBurstActive(at(9, 0))).toBe(false);
    expect(isBurstActive(at(9, 49))).toBe(false);
    expect(isBurstActive(at(16, 0))).toBe(false);
    expect(isBurstActive(at(30, 0))).toBe(false);
  });

  it('is active from :09:50 through :15', () => {
    expect(isBurstActive(at(9, 50))).toBe(true);
    expect(isBurstActive(at(9, 59))).toBe(true);
    expect(isBurstActive(at(10, 0))).toBe(true);
    expect(isBurstActive(at(11, 30))).toBe(true);
    expect(isBurstActive(at(14, 15))).toBe(true);
    expect(isBurstActive(at(15, 59))).toBe(true);
  });
});

describe('filterEligibleIds', () => {
  const blocked = ['nsfwfun', 'banned_sub'];
  const recent = ['111'];

  it('keeps eligible posts in order', () => {
    const tasks = [
      { subTaskId: '1', type: 'post', subreddit: 'cute' },
      { subTaskId: '2', type: 'post', subreddit: null },
    ];
    expect(filterEligibleIds(tasks, blocked, recent)).toEqual(['1', '2']);
  });

  it('drops comments, duplicates, and blocked subreddits', () => {
    const tasks = [
      { subTaskId: '10', type: 'comment', subreddit: 'cute' },
      { subTaskId: '111', type: 'post', subreddit: 'cute' },
      { subTaskId: '12', type: 'post', subreddit: 'r/NsfwFun' },
      { subTaskId: '13', type: 'post', subreddit: 'https://www.reddit.com/r/banned_sub/' },
      { subTaskId: '14', type: 'post', subreddit: 'banned_sub2' },
    ];
    expect(filterEligibleIds(tasks, blocked, recent)).toEqual(['14']);
  });

  it('dedupes repeated ids and skips malformed entries', () => {
    const tasks = [
      { subTaskId: '5', type: 'post', subreddit: 'ok' },
      { subTaskId: '5', type: 'post', subreddit: 'ok' },
      { subTaskId: '', type: 'post', subreddit: 'ok' },
      null,
      undefined,
    ] as never[];
    expect(filterEligibleIds(tasks, blocked, recent)).toEqual(['5']);
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
