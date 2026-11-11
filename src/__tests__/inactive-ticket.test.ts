process.env.DISCORD_TOKEN = 'test-discord-token-12345';
process.env.CLIENT_ID = 'test-client-id';
process.env.GUILD_ID = 'test-guild-id';
process.env.ADMIN_USER_IDS = '1299323714101317715';
process.env.MANAGER_USER_IDS = '222';
process.env.MODERATOR_USER_IDS = '333';
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.DASHBOARD_PASSWORD = 'test-password';

import { InactiveTicketService } from '../services/inactive-ticket.service';
import { ticketInactivityRepository } from '../database/repositories';
import { OWNER_USER_ID } from '../config/constants';

jest.mock('../database/db', () => ({
  getDb: jest.fn(),
  initializeDatabase: jest.fn(),
}));

jest.mock('../services/payout.service', () => ({
  payoutService: {
    getPaidTaskIds: jest.fn().mockResolvedValue(new Set()),
  },
}));

jest.mock('../services/commission.service', () => ({
  commissionService: {
    getCommissionRates: jest.fn().mockResolvedValue({
      normalInviteBonus: 100,
      normalInviteTaskThreshold: 2,
      specialInviteBonus: 50,
      specialInviteTaskThreshold: 1,
      specialPerComment: 10,
      specialPerPost: 20,
    }),
    getPayableItems: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('InactiveTicketService', () => {
  let service: InactiveTicketService;
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InactiveTicketService();

    mockDb = {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      workerPortalAccess: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      inviteDetection: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      referral: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ticketInactivity: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(({ create, update }) => Promise.resolve({ ...create, ...update })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };

    const { getDb } = require('../database/db');
    (getDb as jest.Mock).mockReturnValue(mockDb);
  });

  describe('auditChannel', () => {
    const STAFF_ID = '999999999999999999';
    const staffSet = new Set([STAFF_ID]);
    const paidTaskIds = new Set<string>();

    it('uses the latest worker message timestamp as lastActivityAt', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z');
      const workerMsgTime = new Date('2026-10-26T12:00:00Z'); // 8 days ago relative to 2026-11-03
      const staffMsgTime = new Date('2026-11-02T12:00:00Z');  // 1 day ago (should be ignored!)

      const mockWorker = { id: 'worker-1', user: { bot: false, tag: 'worker#1234' }, displayName: 'worker1' };
      const mockStaff = { id: STAFF_ID, user: { bot: false, tag: 'staff#0001' }, displayName: 'staff' };

      const mockMessages = [
        { id: 'm1', author: { id: STAFF_ID, bot: false }, createdAt: staffMsgTime, content: 'staff msg' },
        { id: 'm2', author: { id: 'worker-1', bot: false }, createdAt: workerMsgTime, content: 'worker reply' },
        { id: 'm3', author: { id: 'bot-1', bot: true }, createdAt: new Date('2026-11-01T00:00:00Z'), content: 'bot msg' },
      ];

      const channel: any = {
        id: 'ch-1',
        name: 'ticket-0001',
        createdAt: channelCreatedAt,
        members: new Map([
          ['worker-1', mockWorker],
          [STAFF_ID, mockStaff],
        ]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map(mockMessages.map((m) => [m.id, m]))),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.workerId).toBe('worker-1');
      expect(audit.hasWorkerMessages).toBe(true);
      expect(audit.lastActivityAt.toISOString()).toBe(workerMsgTime.toISOString());
      expect(audit.inactivityDays).toBe(8);
      expect(audit.isFirstWarningDue).toBe(true);
      expect(audit.isFinalWarningDue).toBe(false);
      expect(audit.isDeletionDue).toBe(false);
      expect(audit.eligibleForDeletion).toBe(false);
    });

    it('flags deletion once the ticket crosses the 15-day window', async () => {
      const channelCreatedAt = new Date('2026-10-19T12:00:00Z'); // exactly 15 days before now

      const channel: any = {
        id: 'ch-boundary',
        name: 'ticket-0001b',
        createdAt: channelCreatedAt,
        members: new Map(),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.inactivityDays).toBe(15);
      expect(audit.isFirstWarningDue).toBe(true);
      expect(audit.isFinalWarningDue).toBe(true);
      expect(audit.isDeletionDue).toBe(true);
      expect(audit.eligibleForDeletion).toBe(true);
    });

    it('uses channel creation date as starting point if worker never sent a message', async () => {
      const channelCreatedAt = new Date('2026-09-01T00:00:00Z'); // 63 days ago
      const staffMsgTime = new Date('2026-10-30T12:00:00Z'); // staff message does NOT count!

      const mockWorker = { id: 'worker-2', user: { bot: false, tag: 'worker2#1234' }, displayName: 'worker2' };

      const mockMessages = [
        { id: 'm1', author: { id: STAFF_ID, bot: false }, createdAt: staffMsgTime, content: 'Hey worker' },
        { id: 'm2', author: { id: 'bot-1', bot: true }, createdAt: new Date('2026-09-01T00:01:00Z'), content: 'welcome' },
      ];

      const channel: any = {
        id: 'ch-2',
        name: 'ticket-0002',
        createdAt: channelCreatedAt,
        members: new Map([['worker-2', mockWorker]]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map(mockMessages.map((m) => [m.id, m]))),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.workerId).toBe('worker-2');
      expect(audit.hasWorkerMessages).toBe(false);
      expect(audit.lastActivityAt.toISOString()).toBe(channelCreatedAt.toISOString());
      expect(audit.inactivityDays).toBe(63.5);
      expect(audit.isDeletionDue).toBe(true);
      expect(audit.isProtected).toBe(false);
      expect(audit.eligibleForDeletion).toBe(true);
    });

    it('does NOT protect tickets whose in-progress tasks are older than the 15-day deletion window', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z'); // 90 days ago
      const taskCreatedAt = new Date('2026-08-15T00:00:00Z');    // ~80 days ago

      mockDb.task.findMany.mockResolvedValue([
        { id: 'TASK-STALE', status: 'PENDING', createdAt: taskCreatedAt, assignedUserId: 'worker-3', cancelledReason: null },
      ]);

      const channel: any = {
        id: 'ch-3',
        name: 'ticket-0003',
        createdAt: channelCreatedAt,
        members: new Map(),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.isDeletionDue).toBe(true);
      expect(audit.isProtected).toBe(false);
      expect(audit.eligibleForDeletion).toBe(true);
    });

    it('retains (does NOT delete) tickets with recent in-progress tasks (< 15 days old)', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z');
      const taskCreatedAt = new Date('2026-10-30T00:00:00Z'); // 4 days ago

      mockDb.task.findMany.mockResolvedValue([
        { id: 'TASK-RECENT', status: 'PENDING', createdAt: taskCreatedAt, assignedUserId: 'worker-3', cancelledReason: null },
      ]);

      const channel: any = {
        id: 'ch-3b',
        name: 'ticket-0003b',
        createdAt: channelCreatedAt,
        members: new Map(),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.isDeletionDue).toBe(true);
      expect(audit.isProtected).toBe(false); // Only pending payments protect
      expect(audit.eligibleForDeletion).toBe(false); // Retained because task is < 15 days old
    });

    it('protects tickets with unpaid completed tasks', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z');

      mockDb.task.findMany.mockResolvedValue([
        { id: 'TASK-UNPAID', status: 'COMPLETED', assignedUserId: 'worker-4', cancelledReason: null },
      ]);

      const channel: any = {
        id: 'ch-4',
        name: 'ticket-0004',
        createdAt: channelCreatedAt,
        members: new Map(),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.isDeletionDue).toBe(true);
      expect(audit.isProtected).toBe(true);
      expect(audit.protectionReasons[0]).toContain('Pending payment on task TASK-UNPAID');
      expect(audit.eligibleForDeletion).toBe(false);
    });

    it('does NOT protect tickets whose completed tasks have already been paid', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z');
      const paidSet = new Set(['TASK-PAID']);

      mockDb.task.findMany.mockResolvedValue([
        { id: 'TASK-PAID', status: 'COMPLETED', assignedUserId: 'worker-5', cancelledReason: null },
      ]);

      const channel: any = {
        id: 'ch-5',
        name: 'ticket-0005',
        createdAt: channelCreatedAt,
        members: new Map(),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidSet, now);

      expect(audit.isDeletionDue).toBe(true);
      expect(audit.isProtected).toBe(false);
      expect(audit.eligibleForDeletion).toBe(true);
    });

    it('protects tickets with pending payable referral commissions', async () => {
      const channelCreatedAt = new Date('2026-08-01T00:00:00Z');
      const mockWorker = { id: 'worker-ref', user: { bot: false, tag: 'refworker' }, displayName: 'ref' };

      mockDb.referral.findMany.mockResolvedValue([
        { id: 'REF-1', inviterId: 'worker-ref', inviteeId: 'someone-else', status: 'qualified' },
      ]);

      const { commissionService } = require('../services/commission.service');
      commissionService.getPayableItems.mockResolvedValueOnce([
        { commissionKind: 'one_time', amount: 100 },
      ]);

      const channel: any = {
        id: 'ch-6',
        name: 'ticket-0006',
        createdAt: channelCreatedAt,
        members: new Map([['worker-ref', mockWorker]]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      };

      const now = new Date('2026-11-03T12:00:00Z');
      const audit = await service.auditChannel(channel, staffSet, paidTaskIds, now);

      expect(audit.isProtected).toBe(true);
      expect(audit.protectionReasons[0]).toContain('Pending commission on referral REF-1');
      expect(audit.eligibleForDeletion).toBe(false);
    });
  });

  describe('onWorkerMessage', () => {
    it('resets inactivity counter and clears warning states when worker messages', async () => {
      const recordSpy = jest.spyOn(ticketInactivityRepository, 'recordWorkerMessage');
      const now = new Date();

      await service.onWorkerMessage('ch-100', 'worker-100', 'bob', now);

      expect(recordSpy).toHaveBeenCalledWith('ch-100', 'worker-100', 'bob', now);
    });
  });

  describe('runLifecycleSweep', () => {
    it('deletes 15+ days inactive tickets directly without disk backup and notifies admin mac', async () => {
      const channelCreatedAt = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000); // 16 days ago

      const mockDelete = jest.fn().mockResolvedValue(undefined);
      const mockChannel: any = {
        id: 'ch-del',
        name: 'ticket-0499',
        createdAt: channelCreatedAt,
        members: new Map([
          ['worker-del', { id: 'worker-del', user: { bot: false, tag: 'del#1' }, displayName: 'del' }],
        ]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
        delete: mockDelete,
      };

      const mockAdminUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };

      const mockClient: any = {
        guilds: {
          fetch: jest.fn().mockResolvedValue({
            channels: {
              fetch: jest.fn().mockResolvedValue(undefined),
              cache: new Map([['ch-del', mockChannel]]),
            },
            members: {
              fetch: jest.fn().mockResolvedValue(undefined),
            },
          }),
        },
        users: {
          fetch: jest.fn().mockImplementation((id: string) => {
            if (id === OWNER_USER_ID) return Promise.resolve(mockAdminUser);
            return Promise.resolve({ send: jest.fn().mockResolvedValue(undefined) });
          }),
        },
      };

      const result = await service.runLifecycleSweep(mockClient, {
        dryRun: false,
        sendWarnings: true,
        deleteEligible: true,
        notifyAdminOnDeletion: true,
      });

      expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('Inactive for'));
      expect(mockAdminUser.send).toHaveBeenCalledWith(expect.stringContaining('Inactive Ticket Deleted'));
      expect(mockAdminUser.send).toHaveBeenCalledWith(expect.stringContaining('ticket-0499'));
      expect(result.deleted).toBe(1);
    });

    it('sends protected tickets report with buttons and attachment to admin mac', async () => {
      const mockAdminUser = {
        send: jest.fn().mockResolvedValue(undefined),
      };

      const mockClient: any = {
        users: {
          fetch: jest.fn().mockImplementation((id: string) => {
            if (id === OWNER_USER_ID) return Promise.resolve(mockAdminUser);
            return Promise.resolve(null);
          }),
        },
      };

      jest.spyOn(ticketInactivityRepository, 'findByStatus').mockResolvedValueOnce([
        {
          channelId: 'ch-prot-1',
          channelName: 'ticket-0010',
          workerId: 'worker-10',
          workerUsername: 'alex',
          lastActivityAt: new Date('2026-09-01T00:00:00Z'),
          status: 'PROTECTED',
          protectionReason: 'Pending payment on task clxxxx1',
        } as any,
      ]);

      await service.sendProtectedTicketsReport(mockClient);

      expect(mockAdminUser.send).toHaveBeenCalled();
      const sendPayload = mockAdminUser.send.mock.calls[0][0];
      expect(sendPayload.content).toContain('Protected Tickets Report');
      expect(sendPayload.content).toContain('Pending Payments');
      expect(sendPayload.components.length).toBeGreaterThan(0);
      expect(sendPayload.files.length).toBe(1);
    });

    it('sends the first warning at Day 7 without deleting', async () => {
      // 8 days ago (Day 7-9 first warning range)
      const channelCreatedAt8 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      const mockChannelSend = jest.fn().mockResolvedValue(undefined);
      const mockWorkerSend = jest.fn().mockResolvedValue(undefined);

      const mockChannel7: any = {
        id: 'ch-warn7',
        name: 'ticket-0007',
        createdAt: channelCreatedAt8,
        members: new Map([
          ['worker-07', { id: 'worker-07', user: { bot: false, tag: 'w7#1' }, displayName: 'w7' }],
        ]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
        send: mockChannelSend,
        delete: jest.fn(),
      };

      const mockClient: any = {
        guilds: {
          fetch: jest.fn().mockResolvedValue({
            channels: {
              fetch: jest.fn().mockResolvedValue(undefined),
              cache: new Map([['ch-warn7', mockChannel7]]),
            },
            members: {
              fetch: jest.fn().mockResolvedValue(undefined),
            },
          }),
        },
        users: {
          fetch: jest.fn().mockResolvedValue({ send: mockWorkerSend }),
        },
      };

      const result = await service.runLifecycleSweep(mockClient, {
        dryRun: false,
        sendWarnings: true,
        deleteEligible: true,
      });

      expect(mockChannelSend).toHaveBeenCalledWith(expect.stringContaining('7 days'));
      expect(mockWorkerSend).toHaveBeenCalledWith(expect.stringContaining('7 days'));
      expect(mockChannel7.delete).not.toHaveBeenCalled();
      expect(result.firstWarningsSent).toBe(1);
      expect(result.finalWarningsSent).toBe(0);
    });

    it('sends the final warning at Day 10 stating deletion in 5 days, without deleting', async () => {
      // 12 days ago (Day 10-14 final warning range)
      const channelCreatedAt12 = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);

      const mockChannelSend = jest.fn().mockResolvedValue(undefined);
      const mockWorkerSend = jest.fn().mockResolvedValue(undefined);

      const mockChannel12: any = {
        id: 'ch-warn12',
        name: 'ticket-0012',
        createdAt: channelCreatedAt12,
        members: new Map([
          ['worker-12', { id: 'worker-12', user: { bot: false, tag: 'w12#1' }, displayName: 'w12' }],
        ]),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
        send: mockChannelSend,
        delete: jest.fn(),
      };

      const mockClient: any = {
        guilds: {
          fetch: jest.fn().mockResolvedValue({
            channels: {
              fetch: jest.fn().mockResolvedValue(undefined),
              cache: new Map([['ch-warn12', mockChannel12]]),
            },
            members: {
              fetch: jest.fn().mockResolvedValue(undefined),
            },
          }),
        },
        users: {
          fetch: jest.fn().mockResolvedValue({ send: mockWorkerSend }),
        },
      };

      const result = await service.runLifecycleSweep(mockClient, {
        dryRun: false,
        sendWarnings: true,
        deleteEligible: true,
      });

      expect(mockChannelSend).toHaveBeenCalledWith(expect.stringContaining('10 consecutive days'));
      expect(mockChannelSend).toHaveBeenCalledWith(expect.stringContaining('deleted in 5 days'));
      expect(mockWorkerSend).toHaveBeenCalledWith(expect.stringContaining('10 consecutive days'));
      expect(mockChannel12.delete).not.toHaveBeenCalled();
      expect(result.finalWarningsSent).toBe(1);
      expect(result.deleted).toBe(0);
    });
  });
});
