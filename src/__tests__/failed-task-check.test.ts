import {
  buildFailedTaskMismatchDm,
  classifyFailedTask,
  failedTaskScanSchema,
} from '../utils/failed-task-check';

const OK_TASK = {
  status: 'PENDING',
  cancelledReason: null,
  submittedRedditUrl: 'https://www.reddit.com/r/test/comments/abc123/post/',
  redditUrl: null,
};

describe('classifyFailedTask', () => {
  it('marks a missing Statbot task as NOT_FOUND', () => {
    expect(classifyFailedTask(null)).toBe('NOT_FOUND');
  });

  it.each(['deleted', 'deleted_later', 'anything-an-admin-typed'])(
    'treats cancelledReason %s as expected-deleted',
    (reason) => {
      expect(classifyFailedTask({ ...OK_TASK, cancelledReason: reason })).toBe('DELETED');
    },
  );

  it('does not treat an empty cancelledReason as deleted', () => {
    expect(classifyFailedTask({ ...OK_TASK, cancelledReason: '   ' })).toBe('MISMATCH');
  });

  it('treats CANCELLED without a reason as not comparable', () => {
    expect(classifyFailedTask({ ...OK_TASK, status: 'CANCELLED' })).toBe('NOT_COMPARABLE');
  });

  it('treats a task with no Reddit link as not comparable', () => {
    expect(
      classifyFailedTask({
        ...OK_TASK,
        submittedRedditUrl: null,
        redditUrl: null,
      }),
    ).toBe('NOT_COMPARABLE');
    expect(
      classifyFailedTask({
        ...OK_TASK,
        submittedRedditUrl: '   ',
        redditUrl: '',
      }),
    ).toBe('NOT_COMPARABLE');
  });

  it('accepts the manual-task redditUrl fallback', () => {
    expect(
      classifyFailedTask({
        ...OK_TASK,
        submittedRedditUrl: null,
        redditUrl: 'https://www.reddit.com/r/test/comments/abc123/post/',
      }),
    ).toBe('MISMATCH');
  });

  it.each(['PENDING', 'COMPLETED', 'ARCHIVED', 'REMINDER_20_SENT', 'ACCEPTED'])(
    'flags an OK %s task with a link as a mismatch',
    (status) => {
      expect(classifyFailedTask({ ...OK_TASK, status })).toBe('MISMATCH');
    },
  );
});

describe('failedTaskScanSchema', () => {
  it('accepts the userscript payload and trims text fields', () => {
    const parsed = failedTaskScanSchema.parse({
      tasks: [
        {
          externalTaskId: 1336842,
          type: 'post',
          failedReason: '  removed by Reddit  ',
          reward: ' $2.50 ',
          deadline: ' Oct 23 7:50 PM ',
        },
      ],
      pagesScanned: 3,
    });
    expect(parsed.tasks[0]).toEqual({
      externalTaskId: '1336842',
      type: 'post',
      failedReason: 'removed by Reddit',
      reward: '$2.50',
      deadline: 'Oct 23 7:50 PM',
    });
    expect(parsed.pagesScanned).toBe(3);
  });

  it('accepts a numeric string id and an empty scan', () => {
    expect(failedTaskScanSchema.parse({ tasks: [] }).tasks).toEqual([]);
    expect(
      failedTaskScanSchema.parse({ tasks: [{ externalTaskId: '42' }] }).tasks[0]
        .externalTaskId,
    ).toBe('42');
  });

  it.each(['', 'abc', '12 34', '-5', '1'.repeat(13)])(
    'rejects invalid task id %p',
    (externalTaskId) => {
      expect(() =>
        failedTaskScanSchema.parse({ tasks: [{ externalTaskId }] }),
      ).toThrow();
    },
  );

  it('rejects unknown types and overlong text', () => {
    expect(() =>
      failedTaskScanSchema.parse({
        tasks: [{ externalTaskId: '1', type: 'video' }],
      }),
    ).toThrow();
    expect(() =>
      failedTaskScanSchema.parse({
        tasks: [{ externalTaskId: '1', failedReason: 'x'.repeat(2001) }],
      }),
    ).toThrow();
    expect(() =>
      failedTaskScanSchema.parse({
        tasks: [{ externalTaskId: '1', reward: 'x'.repeat(65) }],
      }),
    ).toThrow();
    expect(() =>
      failedTaskScanSchema.parse({
        tasks: [{ externalTaskId: '1', deadline: 'x'.repeat(129) }],
      }),
    ).toThrow();
  });

  it('accepts a long failed reason that the old 300-char cap rejected', () => {
    const longReason = 'y'.repeat(2000);
    const parsed = failedTaskScanSchema.parse({
      tasks: [{ externalTaskId: '1', failedReason: longReason }],
    });
    expect(parsed.tasks[0].failedReason).toHaveLength(2000);
  });

  it('caps one scan at 500 cards', () => {
    const tasks = Array.from({ length: 501 }, (_, i) => ({
      externalTaskId: String(i + 1),
    }));
    expect(() => failedTaskScanSchema.parse({ tasks })).toThrow();
  });
});

describe('buildFailedTaskMismatchDm', () => {
  it('returns null when there is nothing to report', () => {
    expect(buildFailedTaskMismatchDm([])).toBeNull();
  });

  it('builds an ID-first, copy-friendly message', () => {
    const message = buildFailedTaskMismatchDm([
      {
        externalTaskId: '1336842',
        taskType: 'post',
        taskStatus: 'PENDING',
        reward: '$2.50',
      },
    ]);
    expect(message).toContain('Possible wrongful GoPartTime failure(s): 1');
    expect(message).toContain('1336842 - Post - Statbot: PENDING (OK) - $2.50');
    expect(message).toContain('NOT Deleted in Statbot');
  });

  it('renders every row, lowercased or enum types alike', () => {
    const message = buildFailedTaskMismatchDm([
      { externalTaskId: '1', taskType: 'comment', taskStatus: 'COMPLETED' },
      { externalTaskId: '2', taskType: 'POST', taskStatus: 'ARCHIVED', reward: '$1' },
    ]);
    expect(message).toContain('1 - Comment - Statbot: COMPLETED (OK)');
    expect(message).toContain('2 - Post - Statbot: ARCHIVED (OK) - $1');
  });

  it('caps rows and states how many were omitted', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      externalTaskId: String(i + 1),
      taskType: 'post',
      taskStatus: 'PENDING',
    }));
    const message = buildFailedTaskMismatchDm(rows, { maxRows: 3 })!;
    expect(message).toContain('1 - Post');
    expect(message).toContain('3 - Post');
    expect(message).not.toContain('4 - Post');
    expect(message).toContain('+7 more');
  });

  it('shrinks the row list to respect a tight character budget', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      externalTaskId: String(1000000 + i),
      taskType: 'post',
      taskStatus: 'REMINDER_70_SENT',
      reward: '$12.50',
    }));
    const message = buildFailedTaskMismatchDm(rows, { maxLength: 400 })!;
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain('+');
  });
});
