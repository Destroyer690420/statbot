/**
 * Deadline feedback decisions — pure, no Redis, no DB.
 * The thin BullMQ wrapper (services/feedback.service.ts) is intentionally
 * untested; every decision it makes is tested here.
 */
import { TaskStatus } from '../types';
import {
  decideFeedbackAction,
  feedbackJobIdFor,
  isFeedbackTerminalStatus,
  pickFeedbackJobs,
  StoredFeedbackJob,
} from '../utils/feedback-queue';

function task(over: Record<string, unknown> = {}) {
  return {
    status: TaskStatus.ACCEPTED,
    assignmentStatus: 'SENT',
    submittedRedditUrl: null,
    deadlineMs: Date.now() + 60 * 60 * 1000,
    feedbackSent: false,
    ...over,
  };
}

describe('decideFeedbackAction', () => {
  it('schedules link-less delivered tasks with a deadline', () => {
    const now = Date.now();
    const d = decideFeedbackAction(task({ deadlineMs: now + 60 * 60 * 1000 }), now);
    expect(d.schedule).toBe(true);
    // 60min - 5min margin - 30s slack
    expect(d.delayMs).toBe(60 * 60 * 1000 - 5 * 60 * 1000 - 30 * 1000);
  });

  it('fires immediately when the margin already passed', () => {
    const d = decideFeedbackAction(task({ deadlineMs: Date.now() - 1000 }));
    expect(d.schedule).toBe(true);
    expect(d.delayMs).toBe(0);
  });

  it('never double-sends (audit guard) and never when a normal link exists', () => {
    expect(decideFeedbackAction(task({ feedbackSent: true })).schedule).toBe(false);
    expect(decideFeedbackAction(task({ feedbackSent: true })).reason).toContain('already sent');
    expect(
      decideFeedbackAction(task({ submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/' })).schedule,
    ).toBe(false);
  });

  it('schedules immediately for DELETED posts even if link exists', () => {
    const d = decideFeedbackAction(
      task({
        submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
        formatCheckStatus: 'DELETED',
      }),
    );
    expect(d.schedule).toBe(true);
    expect(d.delayMs).toBe(0);
    expect(d.reason).toBe('deleted post feedback');
  });

  it('never schedules for DELETED posts if feedback was already sent', () => {
    const d = decideFeedbackAction(
      task({
        submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/',
        formatCheckStatus: 'DELETED',
        feedbackSent: true,
      }),
    );
    expect(d.schedule).toBe(false);
    expect(d.reason).toContain('already sent');
  });

  it('skips undelivered, terminal, deadline-less and long-past tasks', () => {
    expect(decideFeedbackAction(task({ assignmentStatus: 'PENDING' })).reason).toContain('not delivered');
    expect(decideFeedbackAction(task({ assignmentStatus: null })).schedule).toBe(false);
    for (const s of [TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED]) {
      const d = decideFeedbackAction(task({ status: s }));
      expect(d.schedule).toBe(false);
      expect(d.reason).toContain(s);
    }
    // reminder-pipeline states are still active — feedback applies
    expect(decideFeedbackAction(task({ status: TaskStatus.PENDING })).schedule).toBe(true);
    expect(decideFeedbackAction(task({ status: TaskStatus.REMINDER_20_SENT })).schedule).toBe(true);
    expect(decideFeedbackAction(task({ deadlineMs: null })).reason).toContain('no parseable deadline');
    expect(
      decideFeedbackAction(task({ deadlineMs: Date.now() - 25 * 60 * 60 * 1000 })).reason,
    ).toContain('long past');
  });

  it('isFeedbackTerminalStatus matches the decision', () => {
    expect(isFeedbackTerminalStatus(TaskStatus.CANCELLED)).toBe(true);
    expect(isFeedbackTerminalStatus(TaskStatus.PENDING)).toBe(false);
    expect(isFeedbackTerminalStatus(null)).toBe(false);
  });
});

describe('feedbackJobIdFor / pickFeedbackJobs', () => {
  it('is stable per task (re-schedules never double)', () => {
    expect(feedbackJobIdFor('Post #1')).toBe('feedback-Post #1');
  });

  function stored(over: Partial<StoredFeedbackJob> = {}): StoredFeedbackJob {
    return {
      jobId: 'feedback-1',
      taskId: 'Post #1',
      externalTaskId: '100',
      attempt: 1,
      leasedBy: null,
      leasedAt: null,
      createdTimestamp: 1000,
      delayMs: 0,
      ...over,
    };
  }

  it('returns due, unleased jobs oldest-due first', () => {
    const jobs = [stored({ jobId: 'b', createdTimestamp: 2000 }), stored({ jobId: 'a', createdTimestamp: 1000 })];
    expect(pickFeedbackJobs(jobs, 5000).map((j) => j.jobId)).toEqual(['a', 'b']);
  });

  it('skips jobs still inside their delay and holds fresh leases', () => {
    expect(pickFeedbackJobs([stored({ delayMs: 60_000 })], 30_000)).toEqual([]);
    const now = 1_000_000;
    const held = stored({ jobId: 'held', leasedBy: 'tab-1', leasedAt: now - 60_000 });
    expect(pickFeedbackJobs([held], now)).toEqual([]);
  });
});
