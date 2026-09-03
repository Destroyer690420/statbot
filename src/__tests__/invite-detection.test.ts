import { findIncreasedInvite } from '../services/invite-tracker.service';
import { inviteDetectionService } from '../services/invite-detection.service';
import { inviteDetectionRepository, referralRepository } from '../database/repositories';

jest.mock('../database/repositories', () => ({
  taskRepository: {},
  inviteDetectionRepository: {
    findById: jest.fn(),
    findPendingByInviteeId: jest.fn(),
    findPendingUnticketedByInviteeId: jest.fn(),
    findPending: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  referralRepository: {
    findByInviteeAndInviter: jest.fn(),
    findByInviteeId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findById: jest.fn(),
  },
  commissionRepository: {},
  settingsRepository: {},
}));

jest.mock('../database/db', () => ({
  getDb: jest.fn(),
  initializeDatabase: jest.fn(),
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../services/commission.service', () => ({
  commissionService: { createReferral: jest.fn() },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { commissionService } = require('../services/commission.service');

describe('findIncreasedInvite', () => {
  it('returns the code whose uses grew', () => {
    const before = new Map([['aaa', 3], ['bbb', 5]]);
    const after = new Map([['aaa', 4], ['bbb', 5]]);
    expect(findIncreasedInvite(before, after)).toBe('aaa');
  });

  it('returns null when nothing grew', () => {
    const before = new Map([['aaa', 3]]);
    const after = new Map([['aaa', 3]]);
    expect(findIncreasedInvite(before, after)).toBeNull();
  });

  it('picks the largest delta on burst joins', () => {
    const before = new Map([['aaa', 1], ['bbb', 1]]);
    const after = new Map([['aaa', 2], ['bbb', 3]]);
    expect(findIncreasedInvite(before, after)).toBe('bbb');
  });

  it('ignores brand-new codes with zero prior uses only if they grew', () => {
    const before = new Map<string, number>();
    const after = new Map([['new', 1]]);
    expect(findIncreasedInvite(before, after)).toBe('new');
  });
});

describe('inviteDetectionService.recordJoin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a staging row for a fresh invitee', async () => {
    (inviteDetectionRepository.findPendingByInviteeId as jest.Mock).mockResolvedValue([]);
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
    (inviteDetectionRepository.create as jest.Mock).mockImplementation(async (d) => d);

    const row = await inviteDetectionService.recordJoin({
      inviteeId: 'invitee-1',
      inviteeName: 'worker',
      inviterId: 'inviter-1',
      inviterName: 'boss',
      inviteCode: 'abc',
    });

    expect(row?.inviteeId).toBe('invitee-1');
    expect(row?.ticketChannelId).toBeNull();
    expect(row?.status).toBe('pending');
    expect(inviteDetectionRepository.create).toHaveBeenCalledTimes(1);
  });

  it('keep-first: skips when a pending row already exists', async () => {
    const existing = { id: 'INV-X', inviteeId: 'invitee-1', status: 'pending' };
    (inviteDetectionRepository.findPendingByInviteeId as jest.Mock).mockResolvedValue([existing]);

    const row = await inviteDetectionService.recordJoin({ inviteeId: 'invitee-1' });

    expect(row?.id).toBe('INV-X');
    expect(inviteDetectionRepository.create).not.toHaveBeenCalled();
  });

  it('skips when the referral already exists for the pair', async () => {
    (inviteDetectionRepository.findPendingByInviteeId as jest.Mock).mockResolvedValue([]);
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue({ id: 'REF-1' });

    const row = await inviteDetectionService.recordJoin({
      inviteeId: 'invitee-1',
      inviterId: 'inviter-1',
    });

    expect(row).toBeNull();
    expect(inviteDetectionRepository.create).not.toHaveBeenCalled();
  });
});

describe('inviteDetectionService.linkTicket', () => {
  beforeEach(() => jest.clearAllMocks());

  it('links the first ticket and backfills an unticketed referral', async () => {
    (inviteDetectionRepository.findPendingUnticketedByInviteeId as jest.Mock).mockResolvedValue([
      { id: 'INV-1', inviteeId: 'u1', status: 'pending', ticketChannelId: null },
    ]);
    (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
      id: _id,
      inviteeId: 'u1',
      status: 'pending',
      inviterId: 'i1',
      inviterName: 'boss',
      inviteeName: 'worker',
      inviteCode: 'abc',
      ticketChannelId: d.ticketChannelId,
      ticketName: d.ticketName,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    (referralRepository.findByInviteeId as jest.Mock).mockResolvedValue([
      { id: 'REF-1', ticketId: null },
    ]);
    (referralRepository.update as jest.Mock).mockResolvedValue({});

    const linked = await inviteDetectionService.linkTicket('u1', 'chan-1', 'ticket-0007');

    expect(linked?.ticketChannelId).toBe('chan-1');
    expect(referralRepository.update).toHaveBeenCalledWith(
      'REF-1',
      expect.objectContaining({ ticketId: '<#chan-1>' }),
    );
  });

  it('first-ticket-only: does not overwrite an already-linked row', async () => {
    // No unticketed pending rows → staging untouched.
    (inviteDetectionRepository.findPendingUnticketedByInviteeId as jest.Mock).mockResolvedValue([]);
    (referralRepository.findByInviteeId as jest.Mock).mockResolvedValue([
      { id: 'REF-1', ticketId: '<#chan-1>' },
    ]);

    const linked = await inviteDetectionService.linkTicket('u1', 'chan-2', 'ticket-0008');

    expect(linked).toBeNull();
    expect(inviteDetectionRepository.update).not.toHaveBeenCalled();
    // Referral already has a ticket → no backfill either.
    expect(referralRepository.update).not.toHaveBeenCalled();
  });
});

describe('inviteDetectionService approve/reject', () => {
  beforeEach(() => jest.clearAllMocks());

  const pendingRow = {
    id: 'INV-1',
    inviterId: 'inviter-1',
    inviterName: 'boss',
    inviteeId: 'invitee-1',
    inviteeName: 'worker',
    inviteCode: 'abc',
    ticketChannelId: 'chan-1',
    ticketName: 'ticket-0007',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('approve creates the referral with the linked ticket', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
    (commissionService.createReferral as jest.Mock).mockResolvedValue({ id: 'REF-9' });
    (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
      ...pendingRow,
      ...d,
    }));

    const { referralId } = await inviteDetectionService.approve('INV-1', 'admin-1');

    expect(referralId).toBe('REF-9');
    expect(commissionService.createReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        inviterId: 'inviter-1',
        inviteeId: 'invitee-1',
        ticketId: '<#chan-1>',
      }),
      'admin-1',
    );
  });

  it('approve without a ticket still works (ticket undefined)', async () => {
    const noTicket = { ...pendingRow, ticketChannelId: null, ticketName: null };
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(noTicket);
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
    (commissionService.createReferral as jest.Mock).mockResolvedValue({ id: 'REF-10' });
    (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
      ...noTicket,
      ...d,
    }));

    await inviteDetectionService.approve('INV-1', 'admin-1');

    expect(commissionService.createReferral).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: undefined }),
      'admin-1',
    );
  });

  it('approve rejects unknown inviters', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue({
      ...pendingRow,
      inviterId: null,
    });

    await expect(inviteDetectionService.approve('INV-1', 'admin-1')).rejects.toThrow(
      'Unknown inviter',
    );
    expect(commissionService.createReferral).not.toHaveBeenCalled();
  });

  it('reject marks the row rejected', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
    (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
      ...pendingRow,
      ...d,
    }));

    const row = await inviteDetectionService.reject('INV-1', 'admin-1');

    expect(row.status).toBe('rejected');
  });
});

describe('inviteDetectionService.updateDetection', () => {
  beforeEach(() => jest.clearAllMocks());

  const pendingRow = {
    id: 'INV-1',
    inviterId: null,
    inviterName: null,
    inviteeId: 'invitee-1',
    inviteeName: 'worker',
    inviteCode: null,
    ticketChannelId: null,
    ticketName: null,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('sets the inviter on an unknown row', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
    (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
      ...pendingRow,
      ...d,
    }));

    const row = await inviteDetectionService.updateDetection(
      'INV-1',
      { inviterId: '123456789012345678', inviterName: 'boss' },
      'admin-1',
    );

    expect(row.inviterId).toBe('123456789012345678');
    expect(row.inviterName).toBe('boss');
  });

  it('rejects invalid inviter IDs', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);

    await expect(
      inviteDetectionService.updateDetection('INV-1', { inviterId: 'not-a-snowflake' }, 'admin-1'),
    ).rejects.toThrow('Invalid inviter ID.');
    expect(inviteDetectionRepository.update).not.toHaveBeenCalled();
  });

  it('refuses to edit non-pending rows', async () => {
    (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue({
      ...pendingRow,
      status: 'approved',
    });

    await expect(
      inviteDetectionService.updateDetection('INV-1', { inviterName: 'x' }, 'admin-1'),
    ).rejects.toThrow('already approved');
  });

  describe('inviter name auto-fill', () => {
    const realFetch = global.fetch;

    beforeEach(() => {
      process.env.DISCORD_TOKEN = 'test-token';
    });

    afterEach(() => {
      global.fetch = realFetch;
      delete process.env.DISCORD_TOKEN;
    });

    it('fills a missing name from Discord on update', async () => {
      (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: 'boss_login', global_name: 'Boss Display' }),
      }) as any;
      (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
        ...pendingRow,
        ...d,
      }));

      const row = await inviteDetectionService.updateDetection(
        'INV-1',
        { inviterId: '123456789012345678', inviterName: null },
        'admin-1',
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/users/123456789012345678',
        expect.objectContaining({ headers: { Authorization: 'Bot test-token' } }),
      );
      expect(row.inviterName).toBe('Boss Display');
    });

    it('does not fetch when a name is given', async () => {
      (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
      global.fetch = jest.fn() as any;
      (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
        ...pendingRow,
        ...d,
      }));

      await inviteDetectionService.updateDetection(
        'INV-1',
        { inviterId: '123456789012345678', inviterName: 'typed-name' },
        'admin-1',
      );

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps a null name when Discord lookup fails', async () => {
      (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue(pendingRow);
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
      (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
        ...pendingRow,
        ...d,
      }));

      const row = await inviteDetectionService.updateDetection(
        'INV-1',
        { inviterId: '123456789012345678', inviterName: null },
        'admin-1',
      );

      expect(row.inviterName).toBeNull();
    });

    it('approve falls back to the Discord name when the row has none', async () => {
      (inviteDetectionRepository.findById as jest.Mock).mockResolvedValue({
        ...pendingRow,
        inviterId: '123456789012345678',
        inviterName: null,
        ticketChannelId: null,
        ticketName: null,
      });
      (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: 'boss_login', global_name: null }),
      }) as any;
      (commissionService.createReferral as jest.Mock).mockResolvedValue({ id: 'REF-11' });
      (inviteDetectionRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => ({
        ...pendingRow,
        ...d,
      }));

      await inviteDetectionService.approve('INV-1', 'admin-1');

      expect(commissionService.createReferral).toHaveBeenCalledWith(
        expect.objectContaining({ inviterName: 'boss_login' }),
        'admin-1',
      );
    });
  });
});
