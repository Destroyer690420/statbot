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
jest.mock('../services/commission.service', () => ({
  commissionService: {
    getCommissionRates: (...args: unknown[]) => mockGetCommissionRates(...args),
    getPayableItems: (...args: unknown[]) => mockGetPayableItems(...args),
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
  let taskFindMany: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    referrals = [];
    items = [];
    taskChannelNames = {};
    mockGetCommissionRates.mockResolvedValue(RATES);
    mockGetPayableItems.mockResolvedValue([]);

    taskFindMany = jest.fn(async (args: any = {}) => {
      const ids: string[] = args?.where?.channelId?.in ?? [];
      return ids
        .filter((id) => taskChannelNames[id])
        .map((id) => ({ channelId: id, channelName: taskChannelNames[id] }));
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
            .map((i) => ({ referralId: i.referralId, commissionKind: i.commissionKind, amount: i.amount })),
        ),
        findFirst: jest.fn(async () => null),
      },
      task: { findMany: taskFindMany },
    };
  });

  it('resolves a stored channel mention to the ticket name', async () => {
    referrals = [referral({ ticketId: '<#1234567890123456789>' })];
    taskChannelNames = { '1234567890123456789': 'ticket-0021' };

    const dto = await getInvitesForWorker(ME);

    expect(dto.invitees).toEqual([{ name: 'Invitee', ticket: 'ticket-0021', paid: 0 }]);
    expect(taskFindMany).toHaveBeenCalledWith({
      where: { channelId: { in: ['1234567890123456789'] } },
      select: { channelId: true, channelName: true },
    });
  });

  it('resolves a bare snowflake the same way', async () => {
    referrals = [referral({ ticketId: '1234567890123456789' })];
    taskChannelNames = { '1234567890123456789': 'ticket-0031' };

    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].ticket).toBe('ticket-0031');
  });

  it('keeps a stored plain ticket name and strips a leading #', async () => {
    referrals = [referral({ ticketId: '#ticket-0041' })];
    const dto = await getInvitesForWorker(ME);
    expect(dto.invitees[0].ticket).toBe('ticket-0041');
    // A plain name needs no channel lookup at all.
    expect(taskFindMany).not.toHaveBeenCalled();
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
    expect(dto.invitees).toEqual([{ name: 'Invitee', ticket: null, paid: 120 }]);
    expect(JSON.stringify(dto)).not.toContain('per_task_indirect');
    expect(JSON.stringify(dto)).not.toContain('REF-SOMEONE-ELSE');
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
      select: { referralId: true, commissionKind: true, amount: true },
    });
    const json = JSON.stringify(dto);
    expect(json).not.toContain(String(OTHER));
    expect(json).not.toContain('999');
  });
});
