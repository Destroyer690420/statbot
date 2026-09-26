import { TaskStatus, TaskType } from '../types';
import {
  isFailedTask,
  getPayoutInfo,
  deriveWorkerStatus,
  mapFormatCheckHint,
  compareTodo,
  compareNewestFirst,
  getCompletionTime,
  computeHomeStats,
  buildActionNeeded,
  buildWalletSummary,
  toWorkerTaskDto,
  buildTimeline,
  buildInvitesSummary,
  formatMoney,
  WORKER_FORBIDDEN_FIELDS,
  TaskLike,
  ReminderLike,
} from '../utils/worker-view';
import { collectKeys } from './worker-helpers';

const RATES = { postRate: 60, commentRate: 30 };

function task(partial: Partial<TaskLike> & { id: string }): TaskLike {
  return {
    type: TaskType.POST,
    status: TaskStatus.PENDING,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...partial,
  };
}

function rem(partial: Partial<ReminderLike> & { type: string; dueAt: Date }): ReminderLike {
  return { sent: false, completed: false, ...partial };
}

describe('payout states (owner rules)', () => {
  it('ARCHIVED = paid with the actual item amount', () => {
    const t = task({ id: 'a', status: TaskStatus.ARCHIVED });
    expect(getPayoutInfo(t, { taskId: 'a', amount: 60, batchId: 'b', createdAt: new Date() }, RATES)).toEqual({
      state: 'paid',
      amount: 60,
      estimated: false,
      missingItem: false,
    });
  });

  it('ARCHIVED without a PayoutItem is still paid at current rates with a warning', () => {
    const t = task({ id: 'a', status: TaskStatus.ARCHIVED, type: TaskType.COMMENT });
    const seen: string[] = [];
    const info = getPayoutInfo(t, null, RATES, { onMissingPaidItem: (id) => seen.push(id) });
    expect(info.state).toBe('paid');
    expect(info.amount).toBe(30);
    expect(info.estimated).toBe(true);
    expect(info.missingItem).toBe(true);
    expect(seen).toEqual(['a']);
  });

  it('COMPLETED = awaiting payment, estimated at current rates', () => {
    const t = task({ id: 'c', status: TaskStatus.COMPLETED });
    expect(getPayoutInfo(t, null, RATES).state).toBe('awaiting');
    expect(getPayoutInfo(t, null, RATES)).toMatchObject({ amount: 60, estimated: true });
  });

  it('failed takes precedence over paid/completed', () => {
    const archivedDeleted = task({ id: 'x', status: TaskStatus.ARCHIVED, cancelledReason: 'deleted' });
    expect(isFailedTask(archivedDeleted)).toBe(true);
    expect(getPayoutInfo(archivedDeleted, { taskId: 'x', amount: 60, batchId: 'b', createdAt: new Date() }, RATES).state).toBe('none');
    const completedDeleted = task({ id: 'y', status: TaskStatus.COMPLETED, cancelledReason: 'deleted_later' });
    expect(getPayoutInfo(completedDeleted, null, RATES).state).toBe('none');
    // ANY non-null cancelledReason counts
    expect(isFailedTask(task({ id: 'z', cancelledReason: 'whatever' }))).toBe(true);
  });

  it('CANCELLED is failed', () => {
    expect(isFailedTask(task({ id: 'c', status: TaskStatus.CANCELLED }))).toBe(true);
  });

  it('in-flight tasks are not payable', () => {
    expect(getPayoutInfo(task({ id: 'p', status: TaskStatus.PENDING }), null, RATES).state).toBe('none');
  });
});

describe('derived worker status', () => {
  const now = new Date('2026-09-10T00:00:00Z');

  it('deleted tasks land in Failed even while PENDING', () => {
    const d = deriveWorkerStatus(
      task({ id: 'd', status: TaskStatus.PENDING, cancelledReason: 'deleted' }),
      [],
      now,
    );
    expect(d.tab).toBe('failed');
    expect(d.key).toBe('deleted');
    expect(d.label).toContain('not paid');
  });

  it('CANCELLED lands in Failed', () => {
    expect(deriveWorkerStatus(task({ id: 'c', status: TaskStatus.CANCELLED }), [], now).tab).toBe('failed');
  });

  it('ARCHIVED -> paid, COMPLETED -> payable (Completed tab)', () => {
    expect(deriveWorkerStatus(task({ id: 'a', status: TaskStatus.ARCHIVED }), [], now)).toMatchObject({
      tab: 'completed',
      key: 'paid',
    });
    expect(deriveWorkerStatus(task({ id: 'b', status: TaskStatus.COMPLETED }), [], now)).toMatchObject({
      tab: 'completed',
      key: 'payable',
    });
  });

  it('ACCEPTED without URL and not SENT -> preparing', () => {
    const d = deriveWorkerStatus(
      task({ id: 'p', status: TaskStatus.ACCEPTED, assignmentStatus: 'PENDING' }),
      [],
      now,
    );
    expect(d.key).toBe('preparing');
    expect(d.actionRequired).toBe(false);
  });

  it('ACCEPTED SENT without URL -> awaiting_link with action', () => {
    const d = deriveWorkerStatus(
      task({ id: 'p', status: TaskStatus.ACCEPTED, assignmentStatus: 'SENT' }),
      [],
      now,
    );
    expect(d.key).toBe('awaiting_link');
    expect(d.actionRequired).toBe(true);
    expect(d.action).toContain('Post it on Reddit');
  });

  it('ACCEPTED with URL -> under_review with format hint', () => {
    const d = deriveWorkerStatus(
      task({
        id: 'p',
        status: TaskStatus.ACCEPTED,
        submittedRedditUrl: 'https://reddit.com/r/x/1',
        formatCheckStatus: 'TITLE_MISMATCH',
      }),
      [],
      now,
    );
    expect(d.key).toBe('under_review');
    expect(d.hint).toContain("doesn't match");
  });

  it('PENDING shows the first reminder dueAt (never recomputed from createdAt)', () => {
    const due = new Date('2026-09-11T05:30:00Z');
    const d = deriveWorkerStatus(task({ id: 'p', status: TaskStatus.PENDING }), [rem({ type: 'POST_20H', dueAt: due })], now);
    expect(d.key).toBe('live');
    expect(d.nextDueAt).toBe(due.toISOString());
    expect(d.label).toContain('first insight due');
  });

  it('REMINDER_20_SENT requires the screenshot action, shows retries + overdue tone', () => {
    const past = new Date('2026-09-09T00:00:00Z');
    const d = deriveWorkerStatus(
      task({ id: 'p', status: TaskStatus.REMINDER_20_SENT }),
      [rem({ type: 'POST_20H', dueAt: past, sent: true, sentAt: past, retryCount: 2 })],
      now,
    );
    expect(d.key).toBe('insight_20_due');
    expect(d.actionRequired).toBe(true);
    expect(d.action).toContain('screenshot');
    expect(d.hint).toContain('Reminded 3 times');
    expect(d.overdue).toBe(true);
    expect(d.tone).toBe('danger');
  });

  it('INSIGHT_20_RECEIVED on a post waits for 70h; on a comment finalizes', () => {
    const due70 = new Date('2026-09-13T00:00:00Z');
    const post = deriveWorkerStatus(
      task({ id: 'p', status: TaskStatus.INSIGHT_20_RECEIVED }),
      [
        rem({ type: 'POST_20H', dueAt: new Date('2026-09-08T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-09-08T01:00:00Z') }),
        rem({ type: 'POST_70H', dueAt: due70 }),
      ],
      now,
    );
    expect(post.key).toBe('waiting_70h');
    expect(post.nextDueAt).toBe(due70.toISOString());
    const comment = deriveWorkerStatus(
      task({ id: 'c', type: TaskType.COMMENT, status: TaskStatus.INSIGHT_20_RECEIVED }),
      [],
      now,
    );
    expect(comment.key).toBe('finalizing');
  });

  it('REMINDER_70_SENT and INSIGHT_70_RECEIVED', () => {
    const future = new Date('2026-09-20T00:00:00Z');
    const d = deriveWorkerStatus(
      task({ id: 'p', status: TaskStatus.REMINDER_70_SENT }),
      [rem({ type: 'POST_70H', dueAt: future, sent: true, sentAt: now })],
      now,
    );
    expect(d.key).toBe('insight_70_due');
    expect(d.overdue).toBe(false);
    expect(deriveWorkerStatus(task({ id: 'p', status: TaskStatus.INSIGHT_70_RECEIVED }), [], now).key).toBe('finalizing');
  });
});

describe('format-check mapping', () => {
  it('maps real content problems to worker-friendly hints', () => {
    expect(mapFormatCheckHint('MATCH')).toContain('matches');
    expect(mapFormatCheckHint('PARA_MISMATCH')).toContain('blank line');
    expect(mapFormatCheckHint('TITLE_MISMATCH')).toContain('exactly');
    expect(mapFormatCheckHint('TEXT_MISMATCH')).toContain('differs');
  });

  it('hides infrastructure states', () => {
    for (const s of ['NO_SESSION', 'SESSION_EXPIRED', 'FETCH_ERROR', 'DELETED', 'SKIPPED', null, undefined, 'WEIRD']) {
      expect(mapFormatCheckHint(s as string)).toBe('Waiting for manager review');
    }
  });
});

describe('sorting', () => {
  it('to-do: action-needed + overdue first, then next due time', () => {
    const now = new Date('2026-09-10T00:00:00Z');
    const mk = (id: string, status: TaskStatus, dueAt?: Date, sent = true) => ({
      derived: deriveWorkerStatus(
        task({ id, status }),
        dueAt ? [rem({ type: 'POST_20H', dueAt, sent, sentAt: dueAt })] : [],
        now,
      ),
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });
    const live = mk('live', TaskStatus.PENDING, new Date('2026-09-11T00:00:00Z'), false);
    const due = mk('due', TaskStatus.REMINDER_20_SENT, new Date('2026-09-12T00:00:00Z'));
    const overdue = mk('over', TaskStatus.REMINDER_20_SENT, new Date('2026-09-08T00:00:00Z'));
    expect([live, due, overdue].sort(compareTodo).map((x) => x.derived.key)).toEqual([
      'insight_20_due',
      'insight_20_due',
      'live',
    ]);
  });

  it('completed/failed sort newest first', () => {
    const a = { createdAt: new Date('2026-09-01T00:00:00Z') };
    const b = { createdAt: new Date('2026-09-05T00:00:00Z') };
    expect(compareNewestFirst(a, b)).toBeGreaterThan(0);
  });
});

describe('completion time', () => {
  it('uses the latest completed reminder, falling back to updatedAt', () => {
    const t = task({ id: 't', updatedAt: new Date('2026-09-03T00:00:00Z') });
    const rems = [
      rem({ type: 'POST_20H', dueAt: new Date('2026-09-02T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-09-02T05:00:00Z') }),
      rem({ type: 'POST_70H', dueAt: new Date('2026-09-04T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-09-04T06:00:00Z') }),
    ];
    expect(getCompletionTime(t, rems)?.toISOString()).toBe('2026-09-04T06:00:00.000Z');
    expect(getCompletionTime(t, [])?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });
});

describe('home stats', () => {
  it('counts per 5.3 with failed excluded from completed/paid', () => {
    const now = new Date('2026-09-10T00:00:00Z');
    const tasks = [
      task({ id: 'paid1', status: TaskStatus.ARCHIVED }),
      task({ id: 'await1', status: TaskStatus.COMPLETED }),
      task({ id: 'due1', status: TaskStatus.REMINDER_20_SENT }),
      task({ id: 'live1', status: TaskStatus.PENDING }),
      task({ id: 'fail1', status: TaskStatus.PENDING, cancelledReason: 'deleted' }),
      task({ id: 'fail2', status: TaskStatus.ARCHIVED, cancelledReason: 'deleted' }),
    ];
    const rems: Record<string, ReminderLike[]> = {
      due1: [rem({ type: 'POST_20H', dueAt: new Date('2026-09-09T00:00:00Z'), sent: true, sentAt: new Date('2026-09-09T00:00:00Z') })],
      live1: [rem({ type: 'POST_20H', dueAt: new Date('2026-09-12T00:00:00Z') })],
    };
    const stats = computeHomeStats(tasks, rems, now);
    expect(stats).toMatchObject({
      total: 6,
      completed: 2,
      paid: 1,
      awaitingPayment: 1,
      insightsDue: 1,
      insightsOverdue: 1,
      inProgress: 1,
      failed: 2,
    });
  });

  it('action-needed list caps at 5, urgent first', () => {
    const now = new Date('2026-09-10T00:00:00Z');
    const tasks = Array.from({ length: 7 }, (_, i) =>
      task({ id: `t${i}`, status: TaskStatus.REMINDER_20_SENT }),
    );
    const rems: Record<string, ReminderLike[]> = {};
    tasks.forEach((t, i) => {
      rems[t.id] = [rem({ type: 'POST_20H', dueAt: new Date(`2026-09-0${i + 1}T00:00:00Z`), sent: true, sentAt: new Date('2026-09-09T00:00:00Z') })];
    });
    const actions = buildActionNeeded(tasks, rems, now, 5);
    expect(actions).toHaveLength(5);
    expect(actions[0].overdue).toBe(true);
  });
});

describe('wallet math + week bucketing', () => {
  // IST week Sun 2026-08-30 00:00 -> Sat 2026-09-05 23:59:59.999
  const weekStart = new Date('2026-08-29T18:30:00.000Z');
  const weekEnd = new Date('2026-09-05T18:29:59.999Z');
  const week = { weekStart, weekEnd, weekLabel: '30 Aug — 5 Sept' };
  const otherWeek = {
    weekStart: new Date('2026-09-05T18:30:00.000Z'),
    weekEnd: new Date('2026-09-12T18:29:59.999Z'),
    weekLabel: 'next',
  };
  const labelFor = () => 'label';

  function walletFixture() {
    const tasks = [
      task({ id: 'paid-post', type: TaskType.POST, status: TaskStatus.ARCHIVED, updatedAt: new Date('2026-09-02T00:00:00Z') }),
      task({ id: 'await-comment', type: TaskType.COMMENT, status: TaskStatus.COMPLETED, updatedAt: new Date('2026-09-03T00:00:00Z') }),
      task({ id: 'old-paid', type: TaskType.POST, status: TaskStatus.ARCHIVED, updatedAt: new Date('2026-08-20T00:00:00Z') }),
      task({ id: 'failed-paid', type: TaskType.POST, status: TaskStatus.ARCHIVED, cancelledReason: 'deleted', updatedAt: new Date('2026-09-02T00:00:00Z') }),
    ];
    return tasks;
  }

  it('splits paid (actual) vs awaiting (estimated), skips failed, buckets by completion time', () => {
    const tasks = walletFixture();
    const rems: Record<string, ReminderLike[]> = {
      'paid-post': [rem({ type: 'POST_20H', dueAt: new Date('2026-09-01T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-09-02T00:00:00Z') })],
      'await-comment': [rem({ type: 'COMMENT_20H', dueAt: new Date('2026-09-02T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-09-03T00:00:00Z') })],
      'old-paid': [rem({ type: 'POST_20H', dueAt: new Date('2026-08-19T00:00:00Z'), sent: true, completed: true, completedAt: new Date('2026-08-20T00:00:00Z') })],
    };
    const items = [
      { taskId: 'paid-post', amount: 60, batchId: 'b1', createdAt: new Date('2026-09-04T00:00:00Z') },
      { taskId: 'old-paid', amount: 60, batchId: 'b0', createdAt: new Date('2026-08-21T00:00:00Z') },
    ];
    const batches = {
      b1: { id: 'b1', batchNumber: 1, weekStart, weekEnd },
      b0: { id: 'b0', batchNumber: 0, weekStart: new Date('2026-08-22T18:30:00Z'), weekEnd: new Date('2026-08-29T18:29:59.999Z') },
    };
    const w = buildWalletSummary({
      tasks,
      remindersByTask: rems,
      payoutItems: items,
      batchesById: batches,
      rates: RATES,
      currentWeek: week,
      previousWeek: otherWeek,
      weekLabelFor: labelFor,
    });
    expect(w.thisWeek).toMatchObject({ tasks: 2, posts: 1, comments: 1, paid: 60, awaiting: 30, total: 90 });
    expect(w.awaitingAll).toEqual({ count: 1, estimated: 30 });
    expect(w.lifetimePaid).toBe(120);
    expect(w.payments).toHaveLength(2);
    expect(w.payments[0].batchNumber).toBe(1);
    // No batch totals leak into payment history
    expect(collectKeys(w.payments)).not.toContain('totalWorkers');
    expect(collectKeys(w.payments)).not.toContain('totalAmount');
  });

  it('buckets at the IST Saturday/Sunday boundary', () => {
    // Saturday 23:59 IST = 18:29Z; Sunday 00:00 IST = 18:30Z Saturday UTC.
    const satTask = task({ id: 'sat', type: TaskType.POST, status: TaskStatus.COMPLETED, updatedAt: new Date('2026-09-05T18:29:00.000Z') });
    const sunTask = task({ id: 'sun', type: TaskType.POST, status: TaskStatus.COMPLETED, updatedAt: new Date('2026-09-05T18:31:00.000Z') });
    const w = buildWalletSummary({
      tasks: [satTask, sunTask],
      remindersByTask: {},
      payoutItems: [],
      batchesById: {},
      rates: RATES,
      currentWeek: week,
      previousWeek: otherWeek,
      weekLabelFor: labelFor,
    });
    expect(w.thisWeek.tasks).toBe(1);
    expect(w.lastWeek.tasks).toBe(1);
  });
});

describe('task DTO whitelist', () => {
  it('exposes only whitelisted fields (nested included)', () => {
    const t = task({
      id: 'Post #1',
      status: TaskStatus.ARCHIVED,
      subreddit: 'test',
      title: 'hello',
      redditUrl: 'https://reddit.com/r/test/1',
      submittedRedditUrl: 'https://reddit.com/r/test/1',
      externalTaskId: '1',
    });
    const dto = toWorkerTaskDto(
      t,
      [rem({ type: 'POST_20H', dueAt: new Date(), sent: true, completed: true, completedAt: new Date() })],
      { taskId: 'Post #1', amount: 60, batchId: 'b1', createdAt: new Date('2026-09-04T00:00:00Z') },
      { id: 'b1', batchNumber: 7, weekStart: new Date(), weekEnd: new Date() },
      RATES,
      new Date(),
      { weekLabelFor: () => 'w' },
    );
    const keys = collectKeys(dto);
    for (const f of WORKER_FORBIDDEN_FIELDS) {
      expect(keys).not.toContain(f);
    }
    const json = JSON.stringify(dto);
    expect(json).not.toContain('owner-secret');
    expect(json).not.toContain('reviewer-secret');
    expect(json).not.toContain('job-secret');
    expect(dto.payout.batchNumber).toBe(7);
    expect(dto.displayId).toBe('Post #1');
  });

  it('timeline covers assigned -> paid without leaking internals', () => {
    const t = task({ id: 't', status: TaskStatus.COMPLETED, submittedRedditUrl: 'https://reddit.com/x' });
    const tl = buildTimeline(t, [], null);
    expect(tl.map((e) => e.key)).toContain('completed');
    expect(JSON.stringify(tl)).not.toContain('secret');
  });
});

describe('invites summary', () => {
  it('derives the counts from the listed rows and never trusts the caller', () => {
    const dto = buildInvitesSummary({
      directPaid: 120,
      directPending: 100,
      teamPaid: 10,
      invitees: [
        { inviteeName: 'Invited Two', ticketName: 'ticket-0022', tasks: 1, threshold: 2 },
        { inviteeName: 'Invited One', ticketName: 'ticket-0021', tasks: 2, threshold: 2 },
        { inviteeName: 'Invited Three', ticketName: null, tasks: 0, threshold: 2 },
      ],
    });

    expect(dto.summary).toEqual({
      invited: 3,
      withTicket: 2,
      qualified: 1,
      paid: 130,
      directPaid: 120,
      directPending: 100,
      teamPaid: 10,
    });
    // Closest to the bonus first, then alphabetical.
    expect(dto.invitees.map((i) => i.name)).toEqual(['Invited One', 'Invited Two', 'Invited Three']);
    expect(dto.invitees[0]).toEqual({ name: 'Invited One', ticket: 'ticket-0021', tasks: 2, threshold: 2, qualified: true });
  });

  it('stops the task count at the threshold because the bonus pays once', () => {
    const dto = buildInvitesSummary({
      directPaid: 0,
      directPending: 0,
      teamPaid: 0,
      invitees: [{ inviteeName: 'Marathon Worker', ticketName: 'ticket-0007', tasks: 9, threshold: 2 }],
    });
    expect(dto.invitees[0].tasks).toBe(2);
    expect(dto.invitees[0].qualified).toBe(true);
    expect(dto.summary.qualified).toBe(1);
  });

  it('uses a special inviter threshold of 1 when that is what the rate says', () => {
    const dto = buildInvitesSummary({
      directPaid: 0,
      directPending: 0,
      teamPaid: 0,
      invitees: [
        { inviteeName: 'Special One', ticketName: null, tasks: 4, threshold: 1 },
        { inviteeName: 'Normal One', ticketName: null, tasks: 0, threshold: 2 },
      ],
    });
    expect(dto.invitees[0]).toMatchObject({ name: 'Special One', tasks: 1, threshold: 1, qualified: true });
    expect(dto.invitees[1]).toMatchObject({ name: 'Normal One', tasks: 0, threshold: 2, qualified: false });
  });

  it('never reports a negative or fractional task count', () => {
    const dto = buildInvitesSummary({
      directPaid: 0,
      directPending: 0,
      teamPaid: 0,
      invitees: [
        { inviteeName: 'Weird A', ticketName: null, tasks: -3, threshold: 2 },
        { inviteeName: 'Weird B', ticketName: null, tasks: 1.7, threshold: 2 },
        { inviteeName: 'Weird C', ticketName: null, tasks: 1, threshold: 0 },
      ],
    });
    expect(dto.invitees.map((i) => [i.name, i.tasks, i.threshold])).toEqual([
      ['Weird B', 1, 2],
      ['Weird C', 1, 1],
      ['Weird A', 0, 2],
    ]);
  });

  it('is an all-zero payload for someone who never invited anyone', () => {
    const dto = buildInvitesSummary({ directPaid: 0, directPending: 0, teamPaid: 0, invitees: [] });
    expect(dto.invitees).toEqual([]);
    expect(dto.summary.invited).toBe(0);
    expect(dto.summary.qualified).toBe(0);
    expect(dto.summary.paid).toBe(0);
  });

  it('rounds money to paise and carries no forbidden field', () => {
    const dto = buildInvitesSummary({
      directPaid: 33.333,
      directPending: 0,
      teamPaid: 0,
      invitees: [{ inviteeName: 'X', ticketName: 'ticket-1', tasks: 1, threshold: 2 }],
    });
    expect(dto.summary.directPaid).toBe(33.33);

    const keys = collectKeys(dto);
    for (const f of WORKER_FORBIDDEN_FIELDS) {
      expect(keys).not.toContain(f);
    }
    expect(Object.keys(dto.invitees[0]).sort()).toEqual(['name', 'qualified', 'tasks', 'threshold', 'ticket']);
  });
});

describe('money formatting', () => {
  it('formats INR with at most 2 decimals', () => {
    expect(formatMoney(60)).toContain('60');
    expect(formatMoney(62.5)).toContain('62.5');
  });
});
