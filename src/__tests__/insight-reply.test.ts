let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
}));

import { Reminder, ReminderType, TaskStatus } from '../types';
import {
  insightStepLabel,
  pickInsightReminder,
  statusForCompletedInsights,
} from '../utils/insight-reply';
import { canTransition } from '../services/state-machine';
import { reminderRepository } from '../database/repositories/reminder.repository';
import { toReminder } from '../database/converters';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'REM-1',
    taskId: 'Post #688318',
    type: ReminderType.POST_20H,
    dueAt: new Date('2026-08-01T00:00:00.000Z'),
    sent: true,
    completed: false,
    sentAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: null,
    retryCount: 0,
    jobId: null,
    reminderMessageId: 'msg-1',
    reminderMessageIds: ['msg-1'],
    insightImageUrl: null,
    insightImageName: null,
    insightUploadedAt: null,
    ...overrides,
  };
}

describe('pickInsightReminder — reply to any reminder message', () => {
  const post20 = makeReminder({
    id: 'r20',
    type: ReminderType.POST_20H,
    dueAt: new Date('2026-08-01T00:00:00.000Z'),
    reminderMessageIds: ['msg-20-first', 'msg-20-retry1', 'msg-20-retry2'],
  });
  const post70 = makeReminder({
    id: 'r70',
    type: ReminderType.POST_70H,
    dueAt: new Date('2026-08-03T00:00:00.000Z'),
    reminderMessageIds: ['msg-70-first', 'msg-70-retry1'],
  });

  it('accepts the reply for the same step no matter which message was answered', () => {
    // The caller resolves the reminder from the replied message ID; a retry
    // message resolves to the same reminder, so it is used as-is.
    expect(pickInsightReminder(post20, [post20, post70])).toBe(post20);
    expect(pickInsightReminder(post70, [post20, post70])).toBe(post70);
  });

  it('falls forward to the pending 70h step when the worker replies to the finished 20h reminder', () => {
    const completed20 = { ...post20, completed: true, completedAt: new Date() };
    expect(pickInsightReminder(completed20, [completed20, post70])).toBe(post70);
  });

  it('treats a repeat reply to a finished step with nothing pending as a duplicate', () => {
    const completed20 = { ...post20, completed: true };
    const completed70 = { ...post70, completed: true };
    expect(pickInsightReminder(completed20, [completed20, completed70])).toBeNull();
  });

  it('does not fall forward to a reminder that was never sent', () => {
    const completed20 = { ...post20, completed: true };
    const unsent70 = { ...post70, sent: false };
    expect(pickInsightReminder(completed20, [completed20, unsent70])).toBeNull();
  });

  it('does not guess when more than one later reminder is pending', () => {
    const completed20 = { ...post20, completed: true };
    const extra = makeReminder({
      id: 'r90',
      type: ReminderType.POST_70H,
      dueAt: new Date('2026-08-05T00:00:00.000Z'),
    });
    expect(pickInsightReminder(completed20, [completed20, post70, extra])).toBeNull();
  });
});

describe('statusForCompletedInsights', () => {
  const post20 = makeReminder({ id: 'r20', type: ReminderType.POST_20H });
  const post70 = makeReminder({
    id: 'r70',
    type: ReminderType.POST_70H,
    dueAt: new Date('2026-08-03T00:00:00.000Z'),
  });

  it('returns null while nothing has been received', () => {
    expect(statusForCompletedInsights([post20, post70])).toBeNull();
  });

  it('maps a completed 20h reminder to INSIGHT_20_RECEIVED', () => {
    expect(statusForCompletedInsights([{ ...post20, completed: true }, post70])).toBe(
      TaskStatus.INSIGHT_20_RECEIVED,
    );
  });

  it('maps a completed 70h reminder to INSIGHT_70_RECEIVED even when 20h was skipped', () => {
    expect(statusForCompletedInsights([post20, { ...post70, completed: true }])).toBe(
      TaskStatus.INSIGHT_70_RECEIVED,
    );
  });

  it('handles comment tasks (20h only)', () => {
    const comment20 = makeReminder({ id: 'rc', type: ReminderType.COMMENT_20H, completed: true });
    expect(statusForCompletedInsights([comment20])).toBe(TaskStatus.INSIGHT_20_RECEIVED);
  });

  it('allows the 20h-skipped jump in the task state machine', () => {
    expect(canTransition(TaskStatus.REMINDER_20_SENT, TaskStatus.INSIGHT_70_RECEIVED)).toBe(true);
  });
});

describe('insightStepLabel', () => {
  it('names the step in the confirmation reply', () => {
    expect(insightStepLabel(ReminderType.POST_20H)).toBe('20-hour');
    expect(insightStepLabel(ReminderType.COMMENT_20H)).toBe('20-hour');
    expect(insightStepLabel(ReminderType.POST_70H)).toBe('70-hour');
  });
});

describe('ReminderRepository message history', () => {
  const mockFindFirst = jest.fn();
  const mockUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      reminder: {
        findFirst: mockFindFirst,
        update: mockUpdate,
      },
    };
  });

  it('matches a reply to ANY message ID of the reminder, with a legacy fallback', async () => {
    mockFindFirst.mockResolvedValue({ id: 'r20' });

    await reminderRepository.findByMessageId('msg-20-first');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { reminderMessageIds: { has: 'msg-20-first' } },
          { reminderMessageId: 'msg-20-first' },
        ],
      },
    });
  });

  it('appends every sent message ID instead of overwriting the previous one', async () => {
    mockUpdate.mockResolvedValue({ id: 'r20' });

    await reminderRepository.updateReminderMessageId('r20', 'msg-20-retry1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r20' },
      data: {
        reminderMessageId: 'msg-20-retry1',
        reminderMessageIds: { push: 'msg-20-retry1' },
      },
    });
  });
});

describe('toReminder message history', () => {
  const base = {
    id: 'r20',
    taskId: 'Post #1',
    type: 'POST_20H',
    dueAt: new Date(),
    sent: true,
    completed: false,
    sentAt: new Date(),
    completedAt: null,
    retryCount: 1,
    jobId: 'job-1',
    reminderMessageId: 'msg-latest',
    insightImageUrl: null,
    insightImageName: null,
    insightUploadedAt: null,
  };

  it('keeps the stored history', () => {
    const reminder = toReminder({ ...base, reminderMessageIds: ['msg-first', 'msg-latest'] });
    expect(reminder.reminderMessageIds).toEqual(['msg-first', 'msg-latest']);
  });

  it('folds a legacy row (no array) back to its single message ID', () => {
    const reminder = toReminder(base);
    expect(reminder.reminderMessageIds).toEqual(['msg-latest']);
  });

  it('returns an empty history for a reminder that was never sent', () => {
    const reminder = toReminder({ ...base, reminderMessageId: null });
    expect(reminder.reminderMessageIds).toEqual([]);
  });
});
