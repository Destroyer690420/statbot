/**
 * Deadline math — pure IST parsing + due-time helpers, no env/DB/Redis.
 */
import {
  DEADLINE_SUBMIT_MARGIN_MS,
  FEEDBACK_DEADLINE_SLACK_MS,
  SUBMISSION_INITIAL_DELAY_MS,
  SUBMIT_DEADLINE_SLACK_MS,
} from '../config/constants';
import {
  feedbackDueDelayMs,
  isDeadlinePressured,
  latestSubmitAttemptMs,
  parseDeadlineToMs,
  retryDelayWithDeadline,
  submitDelayWithDeadline,
} from '../utils/deadline';

const CREATED = Date.UTC(2026, 9, 12, 10, 42, 12); // 10:42:12Z = 16:12 IST Oct 12

describe('parseDeadlineToMs', () => {
  it('parses Today deadlines as IST wall-clock', () => {
    // 4:50 PM IST Oct 12 = 11:20:00Z
    expect(parseDeadlineToMs('Today 4:50 PM', CREATED)).toBe(Date.UTC(2026, 9, 12, 11, 20, 0));
    // 12:50 AM IST = 00:50 IST = previous evening UTC
    expect(parseDeadlineToMs('Today 12:50 AM', CREATED)).toBe(Date.UTC(2026, 9, 11, 19, 20, 0));
    // noon / midnight edges
    expect(parseDeadlineToMs('Today 12:50 PM', CREATED)).toBe(Date.UTC(2026, 9, 12, 7, 20, 0));
  });

  it('parses month-day deadlines in the creation IST year', () => {
    // Oct 11 1:50 PM IST = 08:20Z Oct 11
    expect(parseDeadlineToMs('Oct 11 1:50 PM', CREATED)).toBe(Date.UTC(2026, 9, 11, 8, 20, 0));
  });

  it('rolls the year when the date would land far in the past', () => {
    const createdAug = Date.UTC(2026, 7, 1, 0, 0, 0);
    expect(parseDeadlineToMs('Jan 5 1:00 PM', createdAug)).toBe(Date.UTC(2027, 0, 5, 7, 30, 0));
  });

  it('returns null for missing or unreadable deadlines', () => {
    for (const d of [null, undefined, '', '   ', 'tomorrow', 'Today 25:00 PM', 'Today 4:99 PM', 'Foo 99 1:00 PM', '13:50']) {
      expect(parseDeadlineToMs(d as any, CREATED)).toBeNull();
    }
  });
});

describe('submit timing under deadline pressure', () => {
  it('uses the normal correction window without a deadline', () => {
    expect(submitDelayWithDeadline(null, CREATED)).toBe(SUBMISSION_INITIAL_DELAY_MS);
    expect(isDeadlinePressured(null, CREATED)).toBe(false);
  });

  it('uses the normal window when the deadline is far away', () => {
    const far = CREATED + 6 * 60 * 60 * 1000;
    expect(submitDelayWithDeadline(far, CREATED)).toBe(SUBMISSION_INITIAL_DELAY_MS);
    expect(isDeadlinePressured(far, CREATED)).toBe(false);
  });

  it('cuts the delay so the attempt lands before the margin', () => {
    // deadline 3 min out: margin+slack already passed → due now
    const soon = CREATED + 3 * 60 * 1000;
    expect(submitDelayWithDeadline(soon, CREATED)).toBe(0);
    expect(isDeadlinePressured(soon, CREATED)).toBe(true);
    // deadline 6.5 min out: attempt must fire at ~30s (6.5 - 5 margin - 1 slack)
    const tight = CREATED + 6.5 * 60 * 1000;
    expect(submitDelayWithDeadline(tight, CREATED)).toBe(30 * 1000);
    expect(isDeadlinePressured(tight, CREATED)).toBe(true);
    expect(latestSubmitAttemptMs(tight)).toBe(tight - DEADLINE_SUBMIT_MARGIN_MS - SUBMIT_DEADLINE_SLACK_MS);
  });

  it('retries keep backoff except past the margin, where they fire now', () => {
    expect(retryDelayWithDeadline(2 * 60 * 1000, null, CREATED)).toBe(2 * 60 * 1000);
    const far = CREATED + 60 * 60 * 1000;
    expect(retryDelayWithDeadline(2 * 60 * 1000, far, CREATED)).toBe(2 * 60 * 1000);
    const past = CREATED - 1000;
    expect(retryDelayWithDeadline(5 * 60 * 1000, past, CREATED)).toBe(0);
  });
});

describe('feedbackDueDelayMs', () => {
  it('returns null without a deadline', () => {
    expect(feedbackDueDelayMs(null, CREATED)).toBeNull();
  });

  it('fires just ahead of the margin, immediately when passed', () => {
    const dl = CREATED + 60 * 60 * 1000;
    expect(feedbackDueDelayMs(dl, CREATED)).toBe(60 * 60 * 1000 - DEADLINE_SUBMIT_MARGIN_MS - FEEDBACK_DEADLINE_SLACK_MS);
    expect(feedbackDueDelayMs(CREATED - 1000, CREATED)).toBe(0);
  });
});
