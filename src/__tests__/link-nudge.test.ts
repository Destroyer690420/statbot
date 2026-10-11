/**
 * Post-link nudge decisions — pure functions, no Redis, no DB.
 * Pins: clock source (newest instruction delivery, createdAt fallback),
 * candidate shape (ACCEPTED+SENT POST, no URL, no cancelledReason),
 * 10/15-min boundaries, and the reminder wording.
 */
import { TaskStatus, TaskType } from '../types';
import {
  buildNudgeMessage,
  deliverySentAt,
  escalateFireDecision,
  isEscalateDue,
  isNudgeCandidate,
  isNudgeDue,
  msUntilEscalation,
  msUntilNudge,
  nudgeFireDecision,
  nudgeJobIdFor,
  type NudgeTaskState,
} from '../utils/link-nudge';

const T0 = new Date('2026-10-11T04:00:00.000Z').getTime();

function task(over: Partial<NudgeTaskState> = {}): NudgeTaskState {
  return {
    id: 'Post #1',
    type: TaskType.POST,
    status: TaskStatus.ACCEPTED,
    assignmentStatus: 'SENT',
    cancelledReason: null,
    submittedRedditUrl: null,
    createdAt: new Date(T0),
    channelId: 'c1',
    assignedUserId: 'w1',
    deliveryMessages: [{ kind: 'instruction', createdAt: new Date(T0).toISOString() }],
    ...over,
  };
}

describe('nudgeJobIdFor', () => {
  it('is stable per task (re-delivery replaces the pending job)', () => {
    expect(nudgeJobIdFor('Post #1')).toBe('nudge-Post #1');
  });
});

describe('deliverySentAt', () => {
  it('uses the newest instruction delivery', () => {
    const t = task({
      deliveryMessages: [
        { kind: 'instruction', createdAt: new Date(T0).toISOString() },
        { kind: 'images', createdAt: new Date(T0 + 999999).toISOString() },
        { kind: 'instruction', createdAt: new Date(T0 + 5000).toISOString() },
      ],
    });
    expect(deliverySentAt(t).getTime()).toBe(T0 + 5000);
  });

  it('falls back to creation when no instruction record exists', () => {
    expect(deliverySentAt(task({ deliveryMessages: null })).getTime()).toBe(T0);
    expect(deliverySentAt(task({ deliveryMessages: [] })).getTime()).toBe(T0);
  });
});

describe('isNudgeCandidate', () => {
  it('accepts delivered posts still waiting for a link', () => {
    expect(isNudgeCandidate(task())).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isNudgeCandidate(task({ type: TaskType.COMMENT }))).toBe(false);
    expect(isNudgeCandidate(task({ status: 'PENDING' }))).toBe(false);
    expect(isNudgeCandidate(task({ assignmentStatus: 'FAILED' }))).toBe(false);
    expect(isNudgeCandidate(task({ assignmentStatus: null }))).toBe(false);
    expect(isNudgeCandidate(task({ cancelledReason: 'deleted' }))).toBe(false);
    expect(isNudgeCandidate(task({ submittedRedditUrl: 'https://www.reddit.com/r/x/1' }))).toBe(false);
    expect(isNudgeCandidate(task({ submittedRedditUrl: '   ' }))).toBe(true);
  });
});

describe('due boundaries', () => {
  it('nudge fires at +10min, escalation at +15min', () => {
    const t = task();
    expect(isNudgeDue(t, T0 + 9 * 60 * 1000 + 59000)).toBe(false);
    expect(isNudgeDue(t, T0 + 10 * 60 * 1000)).toBe(true);
    expect(isEscalateDue(t, T0 + 14 * 60 * 1000 + 59000)).toBe(false);
    expect(isEscalateDue(t, T0 + 15 * 60 * 1000)).toBe(true);
  });

  it('non-candidates are never due', () => {
    const t = task({ submittedRedditUrl: 'https://www.reddit.com/r/x/1' });
    expect(isNudgeDue(t, T0 + 60 * 60 * 1000)).toBe(false);
    expect(isEscalateDue(t, T0 + 60 * 60 * 1000)).toBe(false);
  });

  it('remaining delays clamp at zero', () => {
    const t = task();
    expect(msUntilNudge(t, T0)).toBe(10 * 60 * 1000);
    expect(msUntilNudge(t, T0 + 10 * 60 * 1000)).toBe(0);
    expect(msUntilEscalation(t, T0)).toBe(15 * 60 * 1000);
    expect(msUntilEscalation(t, T0 + 20 * 60 * 1000)).toBe(0);
  });
});

describe('buildNudgeMessage', () => {
  it('tags the worker, names the 5-minute warning and reassignment', () => {
    const msg = buildNudgeMessage('w1');
    expect(msg).toContain('<@w1>');
    expect(msg).toContain('10 minutes');
    expect(msg).toContain('5 minutes');
    expect(msg).toContain('someone else');
    expect(msg).toContain('📌 IMPORTANT');
  });

  it('works without a known worker', () => {
    expect(buildNudgeMessage(null)).not.toContain('<@');
  });
});

describe('fire decisions (BullMQ wrapper rules)', () => {
  it('nudge: due sends, early reschedules, non-candidates drop', () => {
    expect(nudgeFireDecision(task(), T0 + 10 * 60 * 1000)).toEqual({ action: 'send' });
    expect(nudgeFireDecision(task(), T0)).toEqual({ action: 'reschedule', delayMs: 10 * 60 * 1000 });
    expect(nudgeFireDecision(task({ submittedRedditUrl: 'https://www.reddit.com/r/x/1' }), T0 + 3600000)).toEqual({
      action: 'drop',
    });
  });

  it('escalation: due escalates, early reschedules, non-candidates drop', () => {
    expect(escalateFireDecision(task(), T0 + 15 * 60 * 1000)).toEqual({ action: 'escalate' });
    expect(escalateFireDecision(task(), T0 + 10 * 60 * 1000)).toEqual({
      action: 'reschedule',
      delayMs: 5 * 60 * 1000,
    });
    expect(escalateFireDecision(task({ status: 'PENDING' }), T0 + 3600000)).toEqual({ action: 'drop' });
  });
});
