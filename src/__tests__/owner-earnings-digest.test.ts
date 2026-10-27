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

function taskRow(partial: any) {
  const now = partial.createdAt ?? new Date('2026-10-16T10:00:00Z');
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
    updatedAt: now,
    ...partial,
  };
}

describe('ownerEarningsService.getDigestWindow (weekly owner digest)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (settingsService.getPayoutRates as jest.Mock).mockResolvedValue({ commentRate: 30, postRate: 60 });
    (commissionService.getCommissionRates as jest.Mock).mockResolvedValue({
      normalInviteBonus: 100,
      normalInviteTaskThreshold: 2,
      specialInviteBonus: 50,
      specialInviteTaskThreshold: 1,
      specialPerComment: 10,
      specialPerPost: 20,
    });
    (referralRepository.findAll as jest.Mock).mockResolvedValue([]);
    (commissionRepository.findAllItems as jest.Mock).mockResolvedValue([]);
  });

  it('splits the created cohort by outcome and prices only the live tasks', async () => {
    const start = new Date('2026-10-14T18:30:00.000Z');
    const end = new Date('2026-10-21T18:29:59.999Z');
    const windowTasks = [
      taskRow({ id: 't1', type: 'POST', status: 'COMPLETED', createdAt: new Date('2026-10-15T05:00:00Z') }),
      taskRow({ id: 't2', type: 'POST', status: 'COMPLETED', createdAt: new Date('2026-10-16T05:00:00Z') }),
      taskRow({ id: 't3', type: 'POST', status: 'ARCHIVED', createdAt: new Date('2026-10-17T05:00:00Z') }),
      taskRow({ id: 't4', type: 'COMMENT', status: 'PENDING', createdAt: new Date('2026-10-18T05:00:00Z') }),
      taskRow({
        id: 't5',
        type: 'POST',
        status: 'CANCELLED',
        cancelledReason: 'deleted',
        createdAt: new Date('2026-10-19T05:00:00Z'),
      }),
    ];
    (getDb as jest.Mock).mockReturnValue({
      task: {
        findMany: jest.fn(async (args: any) => {
          if (args?.where?.createdAt) {
            expect(args.where.createdAt.gte).toBe(start);
            expect(args.where.createdAt.lte).toBe(end);
            return windowTasks;
          }
          return [];
        }),
      },
      reminder: { findMany: jest.fn(async () => []) },
    });

    const result = await ownerEarningsService.getDigestWindow(start, end);

    // 3 posts + 1 comment live, 1 deleted, 1 open (the PENDING comment).
    expect(result.cohort).toEqual({
      total: 5,
      posts: 4,
      comments: 1,
      completed: 3,
      deleted: 1,
      open: 1,
    });
    // Money: 3 posts + 1 comment created live → 3×250 + 100 revenue, 3×60 + 30 worker.
    expect(result.summary.totalRevenue).toBe(850);
    expect(result.summary.totalWorkerCost).toBe(210);
    expect(result.summary.totalSpecialPerTaskComm).toBe(0);
    expect(result.summary.totalNormalBonuses).toBe(0);
    expect(result.summary.totalSpecialBonuses).toBe(0);
    expect(result.summary.totalEarnings).toBe(850 - 210);
    expect(result.rates).toEqual({
      revenuePerPost: 250,
      revenuePerComment: 100,
      workerPerPost: 60,
      workerPerComment: 30,
    });
  });

  it('counts a deleted_later task as deleted and prices it at exactly zero', async () => {
    const start = new Date('2026-10-14T18:30:00.000Z');
    const end = new Date('2026-10-21T18:29:59.999Z');
    (getDb as jest.Mock).mockReturnValue({
      task: {
        findMany: jest.fn(async (args: any) =>
          args?.where?.createdAt
            ? [
                taskRow({
                  id: 'x1',
                  type: 'COMMENT',
                  status: 'CANCELLED',
                  cancelledReason: 'deleted_later',
                  createdAt: new Date('2026-10-16T05:00:00Z'),
                }),
              ]
            : [],
        ),
      },
      reminder: { findMany: jest.fn(async () => []) },
    });

    const result = await ownerEarningsService.getDigestWindow(start, end);

    expect(result.cohort).toEqual({
      total: 1,
      posts: 0,
      comments: 1,
      completed: 0,
      deleted: 1,
      open: 0,
    });
    expect(result.summary.totalRevenue).toBe(0);
    expect(result.summary.totalWorkerCost).toBe(0);
    expect(result.summary.totalEarnings).toBe(0);
  });

  it('returns an all-zero digest for an empty week', async () => {
    const start = new Date('2026-10-14T18:30:00.000Z');
    const end = new Date('2026-10-21T18:29:59.999Z');
    (getDb as jest.Mock).mockReturnValue({
      task: {
        findMany: jest.fn(async (args: any) => (args?.where?.createdAt ? [] : [])),
      },
      reminder: { findMany: jest.fn(async () => []) },
    });

    const result = await ownerEarningsService.getDigestWindow(start, end);

    expect(result.cohort).toEqual({
      total: 0,
      posts: 0,
      comments: 0,
      completed: 0,
      deleted: 0,
      open: 0,
    });
    expect(result.summary.totalEarnings).toBe(0);
  });
});
