/**
 * Submission queue gating/scheduling — pure functions, no Redis, no DB.
 * The thin BullMQ wrapper (services/submission.service.ts) is intentionally
 * untested; every decision it makes is tested here.
 */
import { TaskType } from '../types';
import {
  SUBMISSION_INITIAL_DELAY_MS,
  SUBMISSION_LEASE_TIMEOUT_MS,
  SUBMISSION_MAX_ATTEMPTS,
} from '../config/constants';
import {
  decideSubmissionAction,
  maxAttemptsReached,
  pickSubmittableJobs,
  retryDelayFor,
  shouldAutoSubmit,
  submissionJobIdFor,
  StoredSubmissionJob,
} from '../utils/submission-queue';

describe('shouldAutoSubmit (the gate)', () => {
  it('posts submit on exact, extra-para, title and text verdicts', () => {
    for (const s of ['MATCH', 'PARA_EXTRA', 'TITLE_MISMATCH', 'TEXT_MISMATCH']) {
      expect(shouldAutoSubmit(s, TaskType.POST)).toBe(true);
    }
    for (const s of [
      'PARA_SHORT',
      'PARA_MISMATCH',
      'FETCH_ERROR',
      'DELETED',
      'NO_SESSION',
      'SESSION_EXPIRED',
      null,
      undefined,
      '',
    ]) {
      expect(shouldAutoSubmit(s, TaskType.POST)).toBe(false);
    }
  });

  it('comments submit only on SKIPPED (no format check by design)', () => {
    expect(shouldAutoSubmit('SKIPPED', TaskType.COMMENT)).toBe(true);
    expect(shouldAutoSubmit('MATCH', TaskType.COMMENT)).toBe(false);
    expect(shouldAutoSubmit(null, TaskType.COMMENT)).toBe(false);
  });
});

describe('decideSubmissionAction', () => {
  it('enqueues verified links with the correction-window delay', () => {
    const d = decideSubmissionAction({
      taskType: TaskType.POST,
      formatCheckStatus: 'MATCH',
      submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
    });
    expect(d.enqueue).toBe(true);
    expect(d.delayMs).toBe(SUBMISSION_INITIAL_DELAY_MS);
  });

  it('never enqueues without a URL', () => {
    for (const url of [null, undefined, '', '   ']) {
      expect(
        decideSubmissionAction({ taskType: TaskType.POST, formatCheckStatus: 'MATCH', submittedRedditUrl: url }).enqueue,
      ).toBe(false);
    }
  });

  it('never enqueues gated-out verdicts (manager review instead)', () => {
    const d = decideSubmissionAction({
      taskType: TaskType.POST,
      formatCheckStatus: 'PARA_SHORT',
      submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
    });
    expect(d.enqueue).toBe(false);
    expect(d.reason).toContain('PARA_SHORT');
  });

  it('enqueues accepted-but-imperfect verdicts (extra/title/text)', () => {
    for (const s of ['PARA_EXTRA', 'TITLE_MISMATCH', 'TEXT_MISMATCH']) {
      const d = decideSubmissionAction({
        taskType: TaskType.POST,
        formatCheckStatus: s,
        submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
      });
      expect(d.enqueue).toBe(true);
    }
  });
});

describe('submissionJobIdFor / retries', () => {
  it('is stable per task (resubmission replaces the pending job)', () => {
    expect(submissionJobIdFor('Post #1')).toBe('submit-Post #1');
    expect(submissionJobIdFor('Post #1')).toBe(submissionJobIdFor('Post #1'));
  });

  it('retries at +2min then +5min, max 3 attempts', () => {
    expect(retryDelayFor(1)).toBe(2 * 60 * 1000);
    expect(retryDelayFor(2)).toBe(5 * 60 * 1000);
    expect(maxAttemptsReached(1)).toBe(false);
    expect(maxAttemptsReached(2)).toBe(false);
    expect(maxAttemptsReached(SUBMISSION_MAX_ATTEMPTS)).toBe(true);
  });
});

function stored(over: Partial<StoredSubmissionJob> = {}): StoredSubmissionJob {
  return {
    jobId: 'submit-1',
    taskId: 'Post #1',
    externalTaskId: '100',
    submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
    attempt: 1,
    leasedBy: null,
    leasedAt: null,
    createdTimestamp: 1000,
    delayMs: 0,
    ...over,
  };
}

describe('pickSubmittableJobs (executor lease, separate from accept-claims)', () => {
  it('returns due, unleased jobs oldest-due first', () => {
    const jobs = [stored({ jobId: 'b', createdTimestamp: 2000 }), stored({ jobId: 'a', createdTimestamp: 1000 })];
    expect(pickSubmittableJobs(jobs, 5000).map((j) => j.jobId)).toEqual(['a', 'b']);
  });

  it('skips jobs still inside their delay (correction window / backoff)', () => {
    const jobs = [stored({ jobId: 'wait', createdTimestamp: 1000, delayMs: 60_000 })];
    expect(pickSubmittableJobs(jobs, 30_000)).toEqual([]);
    expect(pickSubmittableJobs(jobs, 61_001)).toHaveLength(1);
  });

  it('skips freshly leased jobs but reclaims stale ones', () => {
    const now = 1_000_000;
    const held = stored({ jobId: 'held', leasedBy: 'submit-abc', leasedAt: now - 60_000 });
    const stale = stored({ jobId: 'stale', leasedBy: 'submit-abc', leasedAt: now - SUBMISSION_LEASE_TIMEOUT_MS - 1000 });
    expect(pickSubmittableJobs([held, stale], now).map((j) => j.jobId)).toEqual(['stale']);
  });
});
