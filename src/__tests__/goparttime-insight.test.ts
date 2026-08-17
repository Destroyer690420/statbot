import { Reminder, ReminderType, TaskType } from '../types';
import {
  resolveInsightReminder,
  buildManualTaskIdCandidates,
} from '../services/goparttime-insight.service';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'REM-1',
    taskId: 'Post #688318',
    type: ReminderType.POST_20H,
    dueAt: new Date('2026-08-01T00:00:00.000Z'),
    sent: false,
    completed: false,
    sentAt: null,
    completedAt: null,
    retryCount: 0,
    jobId: null,
    reminderMessageId: null,
    insightImageUrl: null,
    insightImageName: null,
    insightUploadedAt: null,
    ...overrides,
  };
}

describe('buildManualTaskIdCandidates', () => {
  it('builds all four case variants for a numeric id', () => {
    expect(buildManualTaskIdCandidates('688318')).toEqual([
      'POST #688318',
      'Comment #688318',
      'Post #688318',
      'COMMENT #688318',
    ]);
  });

  it('still returns candidates for non-numeric input', () => {
    const candidates = buildManualTaskIdCandidates('abc');
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBe('POST #abc');
  });
});

describe('resolveInsightReminder', () => {
  const post20 = makeReminder({
    id: 'r20',
    type: ReminderType.POST_20H,
    dueAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const post70 = makeReminder({
    id: 'r70',
    type: ReminderType.POST_70H,
    dueAt: new Date('2026-08-03T00:00:00.000Z'),
  });
  const comment20 = makeReminder({
    id: 'rc',
    type: ReminderType.COMMENT_20H,
    taskId: 'Comment #745273',
  });

  it('resolves step 1 for a comment to COMMENT_20H', () => {
    const result = resolveInsightReminder([comment20], TaskType.COMMENT, 1);
    expect(result.reminder?.id).toBe('rc');
    expect(result.reminder?.type).toBe(ReminderType.COMMENT_20H);
    expect(result.step).toBe(1);
  });

  it('resolves step 1 for a post to POST_20H (earliest dueAt)', () => {
    const result = resolveInsightReminder([post70, post20], TaskType.POST, 1);
    expect(result.reminder?.type).toBe(ReminderType.POST_20H);
    expect(result.step).toBe(1);
  });

  it('resolves step 2 for a post to POST_70H', () => {
    const result = resolveInsightReminder([post20, post70], TaskType.POST, 2);
    expect(result.reminder?.type).toBe(ReminderType.POST_70H);
    expect(result.step).toBe(2);
  });

  it('rejects step 2 for a comment', () => {
    expect(() => resolveInsightReminder([comment20], TaskType.COMMENT, 2)).toThrow(
      /one view-data step/,
    );
  });

  it('rejects invalid step values', () => {
    expect(() => resolveInsightReminder([post20, post70], TaskType.POST, 3)).toThrow(
      /Invalid step/,
    );
  });

  it('returns null for a step with no matching reminder', () => {
    const result = resolveInsightReminder([post20], TaskType.POST, 2);
    expect(result.reminder).toBeNull();
    expect(result.step).toBe(2);
  });

  it('prefers the pending (sent && !completed) reminder when no step is given', () => {
    const pending = makeReminder({
      id: 'rp',
      type: ReminderType.POST_70H,
      dueAt: new Date('2026-08-03T00:00:00.000Z'),
      sent: true,
    });
    const completed = makeReminder({
      id: 'rdone',
      sent: true,
      completed: true,
      insightImageUrl: '/api/v1/uploads/insights/x/y.png',
    });
    const result = resolveInsightReminder([completed, pending], TaskType.POST);
    expect(result.reminder?.id).toBe('rp');
    expect(result.step).toBe(2);
  });

  it('falls back to the first reminder with an image when nothing is pending', () => {
    const withImage = makeReminder({
      id: 'ri',
      type: ReminderType.POST_70H,
      dueAt: new Date('2026-08-03T00:00:00.000Z'),
      insightImageUrl: '/api/v1/uploads/insights/x/y.png',
    });
    const without = makeReminder({ id: 'rn' });
    const result = resolveInsightReminder([without, withImage], TaskType.POST);
    expect(result.reminder?.id).toBe('ri');
    expect(result.step).toBe(2);
  });

  it('falls back to the earliest reminder', () => {
    const result = resolveInsightReminder([post20, post70], TaskType.POST);
    expect(result.reminder?.id).toBe('r20');
    expect(result.step).toBe(1);
  });

  it('returns null for empty reminders', () => {
    const result = resolveInsightReminder([], TaskType.POST);
    expect(result.reminder).toBeNull();
    expect(result.step).toBe(0);
  });
});
