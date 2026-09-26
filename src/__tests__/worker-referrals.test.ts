let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockGetCommissionRates = jest.fn();
const mockGetPayableItems = jest.fn();
const mockGetIndirectPayableItems = jest.fn();
jest.mock('../services/commission.service', () => ({
  commissionService: {
    getCommissionRates: (...args: unknown[]) => mockGetCommissionRates(...args),
    getPayableItems: (...args: unknown[]) => mockGetPayableItems(...args),
    getIndirectPayableItems: (...args: unknown[]) => mockGetIndirectPayableItems(...args),
  },
}));

import { getInvitesForWorker } from '../services/worker-referrals.service';

const ME = '100000000000000001';
const OTHER = '200000000000000002';

const RATES = {
  normalInviteBonus: 100,
  normalInviteTaskThreshold: 2,
  specialInviteBonus: 50,
  specialInviteTaskThreshold: 1,
  specialPerComment: 10,
  specialPerPost: 20,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  updatedBy: 'test',
};

function referral(partial: Record<string, unknown>) {
  return {
    id: 'REF-1',
    inviterId: ME,
    inviterName: 'Me',
    inviteeId: '500000000000000005',
    inviteeName: 'Invitee',
    inviterType: 'normal',
    status: 'pending',
    oneTimeCommissionPaid: false,
    oneTimeCommissionPaidAt: null,
    perTaskCommissionActive: false,
    ticketId: null,
    indirectSpecialInviterId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...partial,
  };
}

describe('getInvitesForWorker', () => {
  let referrals: Record<string, unknown>[];
  let items: Record<string, unknown>[];
  let taskChannelNames: Record<string, string>;
  let taskRows: Record<string, unknown>[];
  let taskFindMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    referrals = [];
    items = [];
    taskChannelNames = {};
    taskRows = [];
    mockGetCommissionRates.mockResolvedValue(RATES);
    mockGetPayableItems.mockResolvedValue([]);
    mockGetIndirectPayableItems.mockResolvedValue([]);

    taskFindMany = jest.fn(async (args: any = {}) => {
      const where = args?.where ?? {};
      const select = args?.select;
      let rows = taskRows;
      if (Array.isArray(where.channelId?.in)) {
        rows = rows.filter((r) => where.channelId.in.includes(r.channelId));
      }
      if (Array.isArray(where.assignedUserId?.in)) {
        rows = rows.filter((r) => where.assignedUserId.in.includes(r.assignedUserId));
      }
      if (Array.isArray(where.status?.in)) {
        rows = rows.filter((r) => where.status.in.includes(r.status));
      }
      if (!select) return rows;
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          out[key] = key === 'channelName' ? taskChannelNames[r.channelId as string] ?? null : r[key];
        }
        return out;
      });
    });

    mockDb = {
      referral: {
        findMany: jest.fn(async (args: any = {}) =>
          referrals.filter((r) => r.inviterId === args.where?.inviterId),
        ),
      },
      commissionItem: {
        findMany: jest.fn(async (args: any = {}) =>
          items
            .filter((i) => i.inviterId === args.where?.inviterId)
            .map((i) => ({
              referralId: i.referralId,
              commissionKind: i.commissionKind,
              amount: i.amount,
              batch: { batchNumber: i.batchNumber ?? null, paidAt: i.batchPaidAt ?? null },
            })),
        ),
        findFirst: jest.fn(async () => null),
      },
      task: { findMany: taskFindMany },
    };
  });

  function completedTask(partial: Record<string, unknown>) {
    return { assignedUserId: '500000000000000005', channelId: 'chan-1', status: 'COMPLETED', cancelledReason: null, ...partial };
  }

  it('resolves a stored channel mention to the ticket name', async () => {
    referrals = [referral({ ticketId: '<#1234567890123456789>' })];
    taskChannelNames = { '1234567890123456789': 'ticket-0021' };
    taskRows = [completedTask({ channelId: '1234567890123456789' })];

    const dto = await getInvitesForWorker(ME);

    expect(dto.invitees).toEqual([
      { name: 'Invitee', ticket: 'ticket-0021', tasks: 1, threshold: 2, qualified: false, earned: 0 },
    ]);
    expect(taskFindMany).toHaveBeenCalledWith({
      where: { channelId: { in: ['1234567890123456789'] } },
      select: { channelId: true, channelName: true },
    });
  });

  it('resolves a bare snowflake the same way', async () => {
    referrals = [referral({ ticketId: '1234567890123456789' })];
    taskChannelNames = { '1234567890123456789': 'ticket-0031' };
    taskRows = [completedTask({ channelId: '1234567890123456789' })];

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].ticket).toBe('ticket-0031');
  });

  it('keeps a stored plain ticket name and strips a leading #', async () => {
    referrals = [referral({ ticketId: '#ticket-0041' })];
    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].ticket).toBe('ticket-0041');
    // A plain name needs no channel-name lookup (the count query may still run).
    const channelLookups = taskFindMany.mock.calls.filter((c) => c[0]?.select?.channelName);
    expect(channelLookups).toHaveLength(0);
  });

  it('never leaks an unresolvable reference: no id, no mention, no angle brackets', async () => {
    referrals = [
      referral({ id: 'REF-A', ticketId: '<#999999999999999999>' }),
      referral({ id: 'REF-B', ticketId: '1234567890123456789' }),
    ];
    // Channel names known to nothing.
    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees.map((i) => i.ticket)).toEqual([null, null]);
    expect(dto.summary.withTicket).toBe(0);
    const json = JSON.stringify(dto);
    expect(json).not.toContain('999999999999999999');
    expect(json).not.toContain('1234567890123456789');
    expect(json).not.toContain('<#');
  });

  it('survives a failing ticket-name lookup instead of erroring the page', async () => {
    referrals = [referral({ ticketId: '<#1234567890123456789>' })];
    taskFindMany.mockRejectedValueOnce(new Error('db down'));

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].ticket).toBeNull();
    expect(dto.summary.invited).toBe(1);
  });

  it('skips closed referrals', async () => {
    referrals = [
      referral({ id: 'REF-OPEN', status: 'pending' }),
      referral({ id: 'REF-CLOSED', status: 'closed' }),
    ];
    const dto = await getInvitesForWorker(ME);
    expect(dto.summary.invited).toBe(1);
    expect(mockGetPayableItems).toHaveBeenCalledTimes(1);
  });

  it('splits direct earnings from anonymous multi-level earnings', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    items = [
      { referralId: 'REF-MINE', commissionKind: 'one_time', amount: 100, inviterId: ME },
      { referralId: 'REF-MINE', commissionKind: 'per_task', amount: 20, inviterId: ME },
      // Someone else's referral, credited to me for the downstream chain.
      { referralId: 'REF-SOMEONE-ELSE', commissionKind: 'per_task_indirect', amount: 35, inviterId: ME },
    ];

    const dto = await getInvitesForWorker(ME);

    expect(dto.summary).toMatchObject({ invited: 1, directPaid: 120, teamPaid: 35, paid: 155 });
    // The multi-level money is never attributed to a row.
    expect(dto.invitees).toEqual([
      { name: 'Invitee', ticket: null, tasks: 0, threshold: 2, qualified: false, earned: 120 },
    ]);
    expect(JSON.stringify(dto)).not.toContain('per_task_indirect');
    expect(JSON.stringify(dto)).not.toContain('REF-SOMEONE-ELSE');
  });

  it('reports the most recent batch that paid this inviter as lastBatch', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    items = [
      { referralId: 'REF-MINE', commissionKind: 'one_time', amount: 100, inviterId: ME, batchNumber: 7, batchPaidAt: new Date('2026-08-01T00:00:00Z') },
      { referralId: 'REF-MINE', commissionKind: 'per_task', amount: 20, inviterId: ME, batchNumber: 9, batchPaidAt: new Date('2026-09-22T14:19:00Z') },
      // Same newest batch: must add into it, not replace it.
      { referralId: 'REF-SOMEONE-ELSE', commissionKind: 'per_task_indirect', amount: 35, inviterId: ME, batchNumber: 9, batchPaidAt: new Date('2026-09-22T14:19:00Z') },
      // An older batch must not win.
      { referralId: 'REF-MINE', commissionKind: 'per_task', amount: 5, inviterId: ME, batchNumber: 8, batchPaidAt: new Date('2026-08-15T00:00:00Z') },
      // No batch at all (defensive: ignored by lastBatch but still counted as paid).
      { referralId: 'REF-MINE', commissionKind: 'per_task', amount: 1, inviterId: ME },
    ];

    const dto = await getInvitesForWorker(ME);

    expect(dto.summary.lastBatch).toEqual({
      amount: 55,
      batchNumber: 9,
      paidAt: new Date('2026-09-22T14:19:00Z').toISOString(),
    });
    expect(dto.summary.paid).toBe(161);
  });

  it('leaves lastBatch empty for an inviter who has never been paid', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    const dto = await getInvitesForWorker(ME);
    expect(dto.summary.lastBatch).toEqual({ amount: 0, batchNumber: null, paidAt: null });
  });

  it('adds multi-level pending money only where it exists, and keeps it out of direct', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    mockGetPayableItems.mockResolvedValue([{ commissionKind: 'one_time', amount: 100, sourceTaskId: null }]);
    mockGetIndirectPayableItems.mockResolvedValue([
      { commissionKind: 'per_task_indirect', amount: 40, sourceTaskId: 't1' },
      { commissionKind: 'per_task_indirect', amount: 5, sourceTaskId: 't2' },
    ]);

    const dto = await getInvitesForWorker(ME);

    expect(dto.summary.directPending).toBe(100);
    expect(dto.summary.chainPending).toBe(45);
    // The chain share is never attributed to the inviter's own invitee rows.
    expect(dto.invitees.every((i) => i.earned === 0)).toBe(true);
  });

  it('skips the multi-level walk for an inviter with no referrals at all', async () => {
    referrals = [];
    const dto = await getInvitesForWorker(ME);
    expect(dto.summary.chainPending).toBe(0);
    expect(mockGetIndirectPayableItems).not.toHaveBeenCalled();
  });

  it('counts completed tasks per invitee and stops at the threshold', async () => {
    referrals = [referral({ id: 'REF-MINE', inviteeId: '500000000000000005' })];
    // Five completed + one archived, plus noise that must not count.
    taskRows = [
      ...[1, 2, 3, 4].map((n) => completedTask({ id: `t${n}` })),
      completedTask({ id: 't5', status: 'ARCHIVED' }),
      completedTask({ id: 't6', status: 'CANCELLED' }),
      completedTask({ id: 't7', cancelledReason: 'deleted' }),
      completedTask({ id: 't8', status: 'PENDING' }),
      completedTask({ id: 'other', assignedUserId: '500000000000000099' }),
    ];

    const dto = await getInvitesForWorker(ME);

    expect(dto.invitees[0].tasks).toBe(2);
    expect(dto.invitees[0].threshold).toBe(2);
    expect(dto.invitees[0].qualified).toBe(true);
    expect(dto.summary.qualified).toBe(1);
  });

  it('reports partial progress below the threshold', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    taskRows = [completedTask({ id: 't1' })];

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0]).toMatchObject({ tasks: 1, threshold: 2, qualified: false });
    expect(dto.summary.qualified).toBe(0);
  });

  it('uses the special inviter threshold of 1 when the rate says so', async () => {
    referrals = [referral({ id: 'REF-SPECIAL', inviterType: 'special' })];
    taskRows = [completedTask({ id: 't1' }), completedTask({ id: 't2' })];

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0]).toMatchObject({ tasks: 1, threshold: 1, qualified: true });
  });

  it('counts every invitee in a single batched task query', async () => {
    referrals = [
      referral({ id: 'REF-1', inviteeId: '500000000000000005' }),
      referral({ id: 'REF-2', inviteeId: '500000000000000006' }),
      referral({ id: 'REF-3', inviteeId: '500000000000000005' }),
    ];
    taskRows = [
      completedTask({ id: 't1', assignedUserId: '500000000000000005' }),
      completedTask({ id: 't2', assignedUserId: '500000000000000005' }),
      completedTask({ id: 't3', assignedUserId: '500000000000000006' }),
    ];

    await getInvitesForWorker(ME);

    const countQueries = taskFindMany.mock.calls.filter((c) => c[0]?.select?.assignedUserId);
    expect(countQueries).toHaveLength(1);
    expect(countQueries[0][0].where.assignedUserId.in.sort()).toEqual([
      '500000000000000005',
      '500000000000000006',
    ]);
  });

  it('degrades to zero tasks when the count lookup fails', async () => {
    referrals = [referral({ id: 'REF-MINE', ticketId: 'ticket-0044' })];
    taskFindMany.mockRejectedValueOnce(new Error('db down'));

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].tasks).toBe(0);
    expect(dto.summary.invited).toBe(1);
  });

  it('adds the payable engine output as pending, and skips it when there are no referrals', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    mockGetPayableItems.mockResolvedValue([
      { commissionKind: 'one_time', amount: 100, sourceTaskId: null },
      { commissionKind: 'per_task', amount: 20, sourceTaskId: 'task-1' },
    ]);

    const paid = await getInvitesForWorker(ME);
    expect(paid.summary.directPending).toBe(120);

    referrals = [];
    mockGetPayableItems.mockClear();
    mockGetCommissionRates.mockClear();
    const none = await getInvitesForWorker(ME);
    expect(none.summary.directPending).toBe(0);
    expect(none.summary.invited).toBe(0);
    // No rate lookup and no per-referral work on the empty path.
    expect(mockGetCommissionRates).not.toHaveBeenCalled();
    expect(mockGetPayableItems).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder when the stored invitee name is blank', async () => {
    referrals = [referral({ inviteeName: '   ' })];
    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].name).toBe('Invited worker');
  });

  it('reads only this worker\'s referrals and commissions', async () => {
    referrals = [referral({ id: 'REF-MINE' })];
    items = [
      { referralId: 'REF-MINE', commissionKind: 'one_time', amount: 100, inviterId: ME },
      { referralId: 'REF-THEIRS', commissionKind: 'one_time', amount: 999, inviterId: OTHER },
    ];

    const dto = await getInvitesForWorker(ME);

    expect(mockDb.referral.findMany).toHaveBeenCalledWith({ where: { inviterId: ME } });
    expect(mockDb.commissionItem.findMany).toHaveBeenCalledWith({
      where: { inviterId: ME },
      select: {
        referralId: true,
        commissionKind: true,
        amount: true,
        batch: { select: { batchNumber: true, paidAt: true } },
      },
    });
    const json = JSON.stringify(dto);
    expect(json).not.toContain(String(OTHER));
    expect(json).not.toContain('999');
  });
});
