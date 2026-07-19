import {
  canTransition,
  transition,
  getStatusAfterReminderSent,
  getStatusAfterInsightReceived,
  shouldComplete,
  isTerminal,
  isCancellable,
} from '../services/state-machine';
import { TaskStatus, TaskType } from '../types';

describe('canTransition', () => {
  it('allows PENDING → REMINDER_20_SENT', () => {
    expect(canTransition(TaskStatus.PENDING, TaskStatus.REMINDER_20_SENT)).toBe(true);
  });

  it('allows PENDING → CANCELLED', () => {
    expect(canTransition(TaskStatus.PENDING, TaskStatus.CANCELLED)).toBe(true);
  });

  it('blocks PENDING → COMPLETED', () => {
    expect(canTransition(TaskStatus.PENDING, TaskStatus.COMPLETED)).toBe(false);
  });

  it('allows COMPLETED → ARCHIVED', () => {
    expect(canTransition(TaskStatus.COMPLETED, TaskStatus.ARCHIVED)).toBe(true);
  });

  it('blocks terminal state transitions', () => {
    expect(canTransition(TaskStatus.ARCHIVED, TaskStatus.PENDING)).toBe(false);
    expect(canTransition(TaskStatus.CANCELLED, TaskStatus.PENDING)).toBe(false);
  });
});

describe('transition', () => {
  it('returns the new status on valid transition', () => {
    expect(transition(TaskStatus.PENDING, TaskStatus.REMINDER_20_SENT)).toBe(TaskStatus.REMINDER_20_SENT);
  });

  it('throws on invalid transition', () => {
    expect(() => transition(TaskStatus.PENDING, TaskStatus.COMPLETED)).toThrow('Invalid state transition');
  });
});

describe('getStatusAfterReminderSent', () => {
  it('returns REMINDER_20_SENT from PENDING', () => {
    expect(getStatusAfterReminderSent(TaskStatus.PENDING)).toBe(TaskStatus.REMINDER_20_SENT);
  });

  it('returns REMINDER_70_SENT from INSIGHT_20_RECEIVED', () => {
    expect(getStatusAfterReminderSent(TaskStatus.INSIGHT_20_RECEIVED)).toBe(TaskStatus.REMINDER_70_SENT);
  });

  it('returns current status unchanged for other states', () => {
    expect(getStatusAfterReminderSent(TaskStatus.REMINDER_20_SENT)).toBe(TaskStatus.REMINDER_20_SENT);
  });
});

describe('getStatusAfterInsightReceived', () => {
  it('returns INSIGHT_20_RECEIVED from REMINDER_20_SENT', () => {
    expect(getStatusAfterInsightReceived(TaskStatus.REMINDER_20_SENT, TaskType.POST)).toBe(TaskStatus.INSIGHT_20_RECEIVED);
  });

  it('returns INSIGHT_70_RECEIVED from REMINDER_70_SENT', () => {
    expect(getStatusAfterInsightReceived(TaskStatus.REMINDER_70_SENT, TaskType.POST)).toBe(TaskStatus.INSIGHT_70_RECEIVED);
  });

  it('returns INSIGHT_20_RECEIVED for Comments too (then shouldComplete handles it)', () => {
    expect(getStatusAfterInsightReceived(TaskStatus.REMINDER_20_SENT, TaskType.COMMENT)).toBe(TaskStatus.INSIGHT_20_RECEIVED);
  });
});

describe('shouldComplete', () => {
  it('completes Comment at INSIGHT_20_RECEIVED', () => {
    expect(shouldComplete(TaskStatus.INSIGHT_20_RECEIVED, TaskType.COMMENT)).toBe(true);
  });

  it('completes Post at INSIGHT_70_RECEIVED', () => {
    expect(shouldComplete(TaskStatus.INSIGHT_70_RECEIVED, TaskType.POST)).toBe(true);
  });

  it('does not complete Post at INSIGHT_20_RECEIVED', () => {
    expect(shouldComplete(TaskStatus.INSIGHT_20_RECEIVED, TaskType.POST)).toBe(false);
  });

  it('does not complete Comment at REMINDER_20_SENT', () => {
    expect(shouldComplete(TaskStatus.REMINDER_20_SENT, TaskType.COMMENT)).toBe(false);
  });
});

describe('isTerminal', () => {
  it('ARCHIVED is terminal', () => expect(isTerminal(TaskStatus.ARCHIVED)).toBe(true));
  it('CANCELLED is terminal', () => expect(isTerminal(TaskStatus.CANCELLED)).toBe(true));
  it('COMPLETED is not terminal', () => expect(isTerminal(TaskStatus.COMPLETED)).toBe(false));
});

describe('isCancellable', () => {
  it('PENDING is cancellable', () => expect(isCancellable(TaskStatus.PENDING)).toBe(true));
  it('COMPLETED is not cancellable', () => expect(isCancellable(TaskStatus.COMPLETED)).toBe(false));
  it('ARCHIVED is not cancellable', () => expect(isCancellable(TaskStatus.ARCHIVED)).toBe(false));
});
