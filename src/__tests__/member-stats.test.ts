import { TaskStatus, TaskType } from '../types';
import {
  buildWorkerStats,
  isWorkDone,
  WorkerTaskRow,
  WorkerPaidItemRow,
  StatsRates,
  StatsWeek,
} from '../utils/member-stats';
import { workerStatsEmbed, inviterStatsEmbed } from '../bot/embeds';
import { InviterStats } from '../services/member-stats.service';

const rates: StatsRates = { postRate: 20, commentRate: 10 };
const week: StatsWeek = { startMs: 1000, endMs: 2000, label: '1 Jan — 7 Jan' };

function row(partial: Partial<WorkerTaskRow> & { id: string }): WorkerTaskRow {
  return {
    type: TaskType.POST,
    status: TaskStatus.COMPLETED,
    hasCancelledReason: false,
    completedAtMs: 1500,
    ...partial,
  };
}

function paid(taskId: string, amount = 20, batchPaid = true): WorkerPaidItemRow {
  return { taskId, taskType: TaskType.POST, amount, batchPaid };
}

describe('isWorkDone', () => {
  it('treats COMPLETED and ARCHIVED as done', () => {
    expect(isWorkDone(TaskStatus.COMPLETED)).toBe(true);
    expect(isWorkDone(TaskStatus.ARCHIVED)).toBe(true);
  });

  it('treats insight-in-flight states as not done', () => {
    expect(isWorkDone(TaskStatus.PENDING)).toBe(false);
    expect(isWorkDone(TaskStatus.REMINDER_20_SENT)).toBe(false);
    expect(isWorkDone(TaskStatus.INSIGHT_20_RECEIVED)).toBe(false);
    expect(isWorkDone(TaskStatus.REMINDER_70_SENT)).toBe(false);
    expect(isWorkDone(TaskStatus.INSIGHT_70_RECEIVED)).toBe(false);
  });
});

describe('buildWorkerStats', () => {
  it('counts totals by type and excludes cancelled tasks', () => {
    const stats = buildWorkerStats(
      [
        row({ id: 'p1', type: TaskType.POST }),
        row({ id: 'c1', type: TaskType.COMMENT }),
        row({ id: 'x1', status: TaskStatus.CANCELLED }),
      ],
      [],
      rates,
      week,
    );
    expect(stats.allTime.total).toBe(2);
    expect(stats.allTime.posts).toBe(1);
    expect(stats.allTime.comments).toBe(1);
  });

  it('keeps insight-in-flight tasks out of money-pending', () => {
    const stats = buildWorkerStats(
      [
        row({ id: 'p1', status: TaskStatus.COMPLETED }),
        row({ id: 'p2', status: TaskStatus.INSIGHT_20_RECEIVED, completedAtMs: null }),
        row({ id: 'p3', status: TaskStatus.PENDING, completedAtMs: null }),
      ],
      [],
      rates,
      week,
    );
    expect(stats.allTime.completed).toBe(1);
    expect(stats.allTime.inProgress).toBe(2);
    expect(stats.allTime.pending.tasks).toBe(1);
    expect(stats.allTime.pending.amount).toBe(20);
  });

  it('splits paid vs pending by batch paid flag, using actual paid amounts', () => {
    const stats = buildWorkerStats(
      [
        row({ id: 'p1' }),
        row({ id: 'p2' }),
        row({ id: 'c1', type: TaskType.COMMENT }),
      ],
      [paid('p1', 20, true), { taskId: 'p2', taskType: TaskType.POST, amount: 20, batchPaid: false }],
      rates,
      week,
    );
    expect(stats.allTime.paid.tasks).toBe(1);
    expect(stats.allTime.paid.amount).toBe(20);
    // p2 sits in an unpaid batch: pending, estimated at current rates
    // c1 has no item at all: pending too
    expect(stats.allTime.pending.tasks).toBe(2);
    expect(stats.allTime.pending.posts).toBe(1);
    expect(stats.allTime.pending.comments).toBe(1);
    expect(stats.allTime.pending.amount).toBe(30);
  });

  it('counts ARCHIVED without a paid item as pending (unpaid work)', () => {
    const stats = buildWorkerStats([row({ id: 'a1', status: TaskStatus.ARCHIVED })], [], rates, week);
    expect(stats.allTime.completed).toBe(1);
    expect(stats.allTime.pending.tasks).toBe(1);
    expect(stats.allTime.paid.tasks).toBe(0);
  });

  it('skips done tasks with a cancelled reason', () => {
    const stats = buildWorkerStats(
      [row({ id: 'd1', hasCancelledReason: true })],
      [],
      rates,
      week,
    );
    expect(stats.allTime.completed).toBe(0);
    expect(stats.allTime.pending.tasks).toBe(0);
  });

  it('filters the week section by completion time', () => {
    const stats = buildWorkerStats(
      [
        row({ id: 'in', completedAtMs: 1500 }),
        row({ id: 'old', completedAtMs: 500, type: TaskType.COMMENT }),
        row({ id: 'unknown', completedAtMs: null }),
      ],
      [paid('in', 20, true)],
      rates,
      week,
    );
    expect(stats.week.completed).toBe(1);
    expect(stats.week.posts).toBe(1);
    expect(stats.week.comments).toBe(0);
    expect(stats.week.paid.tasks).toBe(1);
    expect(stats.week.paid.amount).toBe(20);
    expect(stats.week.pending.tasks).toBe(0);
    expect(stats.weekLabel).toBe('1 Jan — 7 Jan');
  });

  it('returns zeros for an empty task list', () => {
    const stats = buildWorkerStats([], [], rates, week);
    expect(stats.allTime.total).toBe(0);
    expect(stats.allTime.completed).toBe(0);
    expect(stats.allTime.paid.amount).toBe(0);
    expect(stats.week.completed).toBe(0);
  });
});

describe('workerStatsEmbed', () => {
  it('shows only the This Week section (no All Time)', () => {
    const stats = buildWorkerStats([row({ id: 'p1' })], [], rates, week);
    const json = workerStatsEmbed('tester', stats).toJSON();
    expect(json.fields).toHaveLength(1);
    expect(json.fields![0].name).toContain('This Week');
    expect(JSON.stringify(json.fields)).not.toContain('All Time');
  });
});

describe('inviterStatsEmbed ticket display', () => {
  function inviterStatsWith(ticketId: string | null): InviterStats {
    return {
      inviterId: 'inv1',
      inviterName: 'inviter',
      inviterType: 'normal',
      totals: {
        invited: 1,
        ticketsCreated: ticketId ? 1 : 0,
        qualified: 0,
        bonusPaid: 0,
        bonusPending: 0,
        perTaskPaid: 0,
        perTaskPending: 0,
      },
      invitees: [
        {
          inviteeId: '111111111111111111',
          inviteeName: 'invitee',
          ticketId,
          tasks: 2,
          posts: 1,
          comments: 1,
          threshold: 2,
          thresholdMet: true,
          bonusPaid: 0,
          bonusPending: 100,
        },
      ],
    };
  }

  it('renders a stored <#channelId> mention without backticks', () => {
    const desc = inviterStatsEmbed(inviterStatsWith('<#1545535525447736212>')).toJSON().description!;
    expect(desc).toContain('🎟 <#1545535525447736212>');
    expect(desc).not.toContain('`<#1545535525447736212>`');
  });

  it('converts a raw channel id into a channel mention', () => {
    const desc = inviterStatsEmbed(inviterStatsWith('1545535525447736212')).toJSON().description!;
    expect(desc).toContain('🎟 <#1545535525447736212>');
  });

  it('renders a plain ticket name as #name', () => {
    const desc = inviterStatsEmbed(inviterStatsWith('ticket-0036')).toJSON().description!;
    expect(desc).toContain('🎟 #ticket-0036');
  });

  it('shows a fallback when there is no ticket yet', () => {
    const desc = inviterStatsEmbed(inviterStatsWith(null)).toJSON().description!;
    expect(desc).toContain('🎟 no ticket yet');
  });

  it('shows the capped 2/2 progress', () => {
    const desc = inviterStatsEmbed(inviterStatsWith('ticket-0001')).toJSON().description!;
    expect(desc).toContain('tasks **2/2**');
  });
});
