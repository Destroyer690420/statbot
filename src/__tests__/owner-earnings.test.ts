import { ownerEarningsService } from '../services/owner-earnings.service';
import { referralRepository } from '../database/repositories/referral.repository';
import { commissionRepository } from '../database/repositories/commission.repository';
import { commissionService } from '../services/commission.service';
import { settingsService } from '../services/settings.service';
import { getDb } from '../database/db';

jest.mock('../database/repositories/referral.repository', () => ({
  referralRepository: { findAll: jest.fn() },
}));
jest.mock('../database/repositories/commission.repository', () => ({
  commissionRepository: { findAllItems: jest.fn() },
}));
jest.mock('../services/commission.service', () => ({
  commissionService: { getCommissionRates: jest.fn() },
}));
jest.mock('../services/settings.service', () => ({
  settingsService: { getPayoutRates: jest.fn() },
}));
jest.mock('../database/db', () => ({
  getDb: jest.fn(),
  initializeDatabase: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const RATES = {
  normalInviteBonus: 100,
  normalInviteTaskThreshold: 2,
  specialInviteBonus: 50,
  specialInviteTaskThreshold: 1,
  specialPerComment: 10,
  specialPerPost: 20,
};

function refRow(partial: any) {
  return {
    id: 'r1',
    inviterId: 'inv1',
    inviterName: 'Inv',
    inviteeId: 'w1',
    inviteeName: 'W',
    inviterType: 'normal',
    status: 'pending',
    oneTimeCommissionPaid: false,
    oneTimeCommissionPaidAt: null,
    perTaskCommissionActive: false,
    ticketId: null,
    indirectSpecialInviterId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

function taskRow(partial: any) {
  const now = partial.createdAt ?? new Date('2026-06-01T00:00:00Z');
  return {
    id: 't',
    redditUrl: null,
    type: 'POST',
    status: 'COMPLETED',
    guildId: 'g',
    channelId: 'c',
    channelName: 'ticket-0001',
    assignedUserId: 'w1',
    assignedUserName: 'W',
    createdById: 'admin',
    notes: null,
    cancelledReason: null,
    source: null,
    externalTaskId: null,
    sourceUrl: null,
    subreddit: null,
    subredditUrl: null,
    flair: null,
    title: null,
    postLink: null,
    contentHtml: null,
    formattedContent: null,
    payment: null,
    deadline: null,
    taskImages: null,
    deliveryMessages: null,
    assignmentStatus: null,
    assignmentError: null,
    submittedRedditUrl: null,
    submittedAt: null,
    submittedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
    ...partial,
  };
}

function setupMocks(opts: {
  refs: any[];
  inviteeTasks: any[];
  channelTasks?: any[];
  reminders?: any[];
  commissionItems?: any[];
  windowTasks: any[];
}) {
  (settingsService.getPayoutRates as jest.Mock).mockResolvedValue({ commentRate: 30, postRate: 60 });
  (commissionService.getCommissionRates as jest.Mock).mockResolvedValue({ ...RATES });
  (referralRepository.findAll as jest.Mock).mockResolvedValue(opts.refs);
  (commissionRepository.findAllItems as jest.Mock).mockResolvedValue(opts.commissionItems ?? []);
  const db: any = {
    task: {
      findMany: jest.fn(async (args: any) => {
        if (args?.where?.createdAt) return opts.windowTasks;
        if (args?.where?.assignedUserId) return opts.inviteeTasks;
        if (args?.where?.channelName) return opts.channelTasks ?? [];
        return [];
      }),
    },
    reminder: {
      findMany: jest.fn(async () => opts.reminders ?? []),
    },
  };
  (getDb as jest.Mock).mockReturnValue(db);
}

const calc = (s: Date, e: Date) =>
  (ownerEarningsService as any).calculateForRange(s, e);

describe('owner earnings (creation-basis)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes PENDING but excludes deleted and CANCELLED; worker cost comes from settings', async () => {
    const day = new Date('2026-06-01T05:00:00Z'); // inside 2026-06-01 IST window
    setupMocks({
      refs: [],
      inviteeTasks: [],
      windowTasks: [
        taskRow({ id: 'pending-post', status: 'PENDING', type: 'POST', assignedUserId: 'w9', createdAt: day, updatedAt: day }),
        taskRow({ id: 'pending-comment', status: 'PENDING', type: 'COMMENT', assignedUserId: 'w9', createdAt: day, updatedAt: day }),
        taskRow({ id: 'gone', status: 'COMPLETED', cancelledReason: 'deleted', createdAt: day, updatedAt: day }),
        taskRow({ id: 'gone2', status: 'COMPLETED', cancelledReason: 'deleted_later', createdAt: day, updatedAt: day }),
        taskRow({ id: 'cx', status: 'CANCELLED', cancelledReason: null, createdAt: day, updatedAt: day }),
      ],
    });
    const r = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(r.summary.totalTasks).toBe(2);
    expect(r.summary.posts).toBe(1);
    expect(r.summary.comments).toBe(1);
    expect(r.summary.totalRevenue).toBe(350); // 250 + 100
    expect(r.summary.totalWorkerCost).toBe(90); // 60 + 30 from settings
    expect(r.summary.totalEarnings).toBe(260);
  });

  it('deducts per-task only when the invitee is actually qualified', async () => {
    const day = new Date('2026-06-01T05:00:00Z');
    // W3 has 1 payable completed task; R3 is normal+indirect -> per-task qualifies (special threshold 1), one-time does not (normal threshold 2)
    const q = taskRow({ id: 'q4', status: 'COMPLETED', type: 'POST', assignedUserId: 'w3', createdAt: new Date('2026-05-20T05:00:00Z'), updatedAt: new Date('2026-05-21T05:00:00Z') });
    setupMocks({
      refs: [refRow({ id: 'r3', inviterId: 'n2', inviterType: 'normal', inviteeId: 'w3', indirectSpecialInviterId: 's1' })],
      inviteeTasks: [q],
      reminders: [{ taskId: 'q4', completed: true, completedAt: new Date('2026-05-21T05:00:00Z') }],
      windowTasks: [
        taskRow({ id: 'new-post', status: 'PENDING', type: 'POST', assignedUserId: 'w3', createdAt: day, updatedAt: day }),
      ],
    });
    const r = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(r.summary.totalSpecialPerTaskComm).toBe(20);
    expect(r.summary.totalNormalBonuses).toBe(0); // threshold 2 not met
    // revenue 250 - cost 60 - perTask 20 = 170
    expect(r.summary.totalEarnings).toBe(170);
  });

  it('does NOT deduct per-task for an unqualified normal referral', async () => {
    const day = new Date('2026-06-01T05:00:00Z');
    const q = taskRow({ id: 'q1', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-05-20T05:00:00Z'), updatedAt: new Date('2026-05-21T05:00:00Z') });
    setupMocks({
      refs: [refRow({ id: 'r1', inviterId: 'n1', inviterType: 'normal', inviteeId: 'w1', indirectSpecialInviterId: null })],
      inviteeTasks: [q], // only 1 of 2 needed
      reminders: [{ taskId: 'q1', completed: true, completedAt: new Date('2026-05-21T05:00:00Z') }],
      windowTasks: [
        taskRow({ id: 'new-post', status: 'PENDING', type: 'POST', assignedUserId: 'w1', createdAt: day, updatedAt: day }),
      ],
    });
    const r = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(r.summary.totalSpecialPerTaskComm).toBe(0);
    expect(r.summary.totalNormalBonuses).toBe(0);
  });

  it('attributes the one-time bonus ONCE to the creation day of the threshold task', async () => {
    const q1 = taskRow({ id: 'q1', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-05-20T05:00:00Z'), updatedAt: new Date('2026-05-21T05:00:00Z') });
    const q2 = taskRow({ id: 'q2', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-06-01T05:00:00Z'), updatedAt: new Date('2026-06-02T05:00:00Z') });
    const refs = [refRow({ id: 'r1', inviterId: 'n1', inviterType: 'normal', inviteeId: 'w1' })];
    const rems = [
      { taskId: 'q1', completed: true, completedAt: new Date('2026-05-21T05:00:00Z') },
      { taskId: 'q2', completed: true, completedAt: new Date('2026-06-02T05:00:00Z') },
    ];
    // Window A: only day 2026-05-20 (holds q1, threshold not reached there)
    setupMocks({ refs, inviteeTasks: [q1, q2], reminders: rems, windowTasks: [q1] });
    const a = await calc(new Date('2026-05-19T18:30:00Z'), new Date('2026-05-20T18:29:59.999Z'));
    expect(a.summary.totalNormalBonuses).toBe(0);
    // Window B: day 2026-06-01 (holds q2 = threshold task) -> bonus once
    setupMocks({ refs, inviteeTasks: [q1, q2], reminders: rems, windowTasks: [q2] });
    const b = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(b.summary.totalNormalBonuses).toBe(100);
    expect(b.referralDeductions).toHaveLength(1);
    expect(b.referralDeductions[0]).toMatchObject({ deductionType: 'one_time_bonus', amount: 100, alreadyPaid: false });
    // Full range covering both days -> still exactly 100 (no repeat)
    setupMocks({ refs, inviteeTasks: [q1, q2], reminders: rems, windowTasks: [q1, q2] });
    const full = await calc(new Date('2026-05-19T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(full.summary.totalNormalBonuses).toBe(100);
  });

  it('keeps the bonus in its day after Sunday payment (label flips to paid, totals unchanged)', async () => {
    const q1 = taskRow({ id: 'q1', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-06-01T05:00:00Z'), updatedAt: new Date('2026-06-01T06:00:00Z') });
    const q2 = taskRow({ id: 'q2', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-06-01T07:00:00Z'), updatedAt: new Date('2026-06-01T08:00:00Z') });
    const refs = [refRow({ id: 'r1', inviterId: 'n1', inviterType: 'normal', inviteeId: 'w1', oneTimeCommissionPaid: true })];
    const rems = [
      { taskId: 'q1', completed: true, completedAt: new Date('2026-06-01T06:00:00Z') },
      { taskId: 'q2', completed: true, completedAt: new Date('2026-06-01T08:00:00Z') },
    ];
    setupMocks({
      refs,
      inviteeTasks: [q1, q2],
      reminders: rems,
      commissionItems: [{ referralId: 'r1', inviterId: 'n1', commissionKind: 'one_time' }],
      windowTasks: [q1, q2],
    });
    const r = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(r.summary.totalNormalBonuses).toBe(100);
    expect(r.referralDeductions[0]).toMatchObject({ amount: 100, alreadyPaid: true });
  });

  it('pays each inviter separately (no last-wins map)', async () => {
    const q1 = taskRow({ id: 'q1', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-06-01T05:00:00Z'), updatedAt: new Date('2026-06-01T06:00:00Z') });
    const q2 = taskRow({ id: 'q2', status: 'COMPLETED', type: 'POST', assignedUserId: 'w1', createdAt: new Date('2026-06-01T07:00:00Z'), updatedAt: new Date('2026-06-01T08:00:00Z') });
    const refs = [
      refRow({ id: 'r1', inviterId: 'n1', inviterType: 'normal', inviteeId: 'w1' }),
      refRow({ id: 'r2', inviterId: 'n2', inviterType: 'normal', inviteeId: 'w1' }),
    ];
    const rems = [
      { taskId: 'q1', completed: true, completedAt: new Date('2026-06-01T06:00:00Z') },
      { taskId: 'q2', completed: true, completedAt: new Date('2026-06-01T08:00:00Z') },
    ];
    setupMocks({ refs, inviteeTasks: [q1, q2], reminders: rems, windowTasks: [q1, q2] });
    const r = await calc(new Date('2026-05-31T18:30:00Z'), new Date('2026-06-01T18:29:59.999Z'));
    expect(r.summary.totalNormalBonuses).toBe(200);
    expect(r.referralDeductions).toHaveLength(2);
  });
});
