import { referralRepository } from '../database/repositories';
import { commissionService, resolveIndirectSpecialInviterId } from '../services/commission.service';

jest.mock('../database/repositories', () => ({
  taskRepository: {},
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
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const SPECIAL = '111122223333444455556666';
const SOREN = 'soren_thunder';
const NOTSHA = 'notshagunatp';
const BAVISH = 'bavish.exe';
const BATMAN = 'batman_441';

function parentRef(inviterId: string, inviterType: 'normal' | 'special', status = 'pending') {
  return { id: `r-${inviterId}`, inviterId, inviteeId: 'x', inviterType, status };
}

function mockChain(chain: Record<string, Array<ReturnType<typeof parentRef>>>) {
  (referralRepository.findByInviteeId as jest.Mock).mockImplementation(
    async (id: string) => chain[id] ?? [],
  );
}

describe('resolveIndirectSpecialInviterId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the direct special inviter (one level)', async () => {
    mockChain({ [SOREN]: [parentRef(SPECIAL, 'special')] });
    await expect(resolveIndirectSpecialInviterId(SOREN)).resolves.toBe(SPECIAL);
  });

  it('walks a two-level chain to the top special inviter', async () => {
    mockChain({
      [NOTSHA]: [parentRef(SOREN, 'normal')],
      [SOREN]: [parentRef(SPECIAL, 'special')],
    });
    await expect(resolveIndirectSpecialInviterId(NOTSHA)).resolves.toBe(SPECIAL);
  });

  it('walks the full four-level chain (special -> soren -> notsha -> bavish -> batman)', async () => {
    mockChain({
      [BAVISH]: [parentRef(NOTSHA, 'normal')],
      [BATMAN]: [parentRef(BAVISH, 'normal')],
      [NOTSHA]: [parentRef(SOREN, 'normal')],
      [SOREN]: [parentRef(SPECIAL, 'special')],
    });
    await expect(resolveIndirectSpecialInviterId(BAVISH)).resolves.toBe(SPECIAL);
    await expect(resolveIndirectSpecialInviterId(BATMAN)).resolves.toBe(SPECIAL);
  });

  it('returns null when there is no ancestor chain', async () => {
    mockChain({});
    await expect(resolveIndirectSpecialInviterId(SOREN)).resolves.toBeNull();
  });

  it('returns null when the whole chain is normal inviters', async () => {
    mockChain({
      [BATMAN]: [parentRef(BAVISH, 'normal')],
      [BAVISH]: [parentRef(NOTSHA, 'normal')],
      [NOTSHA]: [parentRef(SOREN, 'normal')],
    });
    await expect(resolveIndirectSpecialInviterId(BATMAN)).resolves.toBeNull();
  });

  it('skips a closed special link but keeps walking past it', async () => {
    mockChain({
      [BAVISH]: [parentRef(NOTSHA, 'normal')],
      [NOTSHA]: [parentRef(SOREN, 'normal'), parentRef(SPECIAL, 'special', 'closed')],
      [SOREN]: [parentRef(SPECIAL, 'special')],
    });
    await expect(resolveIndirectSpecialInviterId(BAVISH)).resolves.toBe(SPECIAL);
  });

  it('prefers the shallowest special inviter on branching chains', async () => {
    const OTHER_SPECIAL = '999988887777666655554444';
    mockChain({
      [BAVISH]: [parentRef(SPECIAL, 'special'), parentRef(NOTSHA, 'normal')],
      [NOTSHA]: [parentRef(OTHER_SPECIAL, 'special')],
    });
    await expect(resolveIndirectSpecialInviterId(BAVISH)).resolves.toBe(SPECIAL);
  });

  it('terminates on referral cycles without hanging', async () => {
    mockChain({
      a: [parentRef('b', 'normal')],
      b: [parentRef('a', 'normal')],
    });
    await expect(resolveIndirectSpecialInviterId('a')).resolves.toBeNull();
  });
});

describe('createReferral indirect wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
    (referralRepository.create as jest.Mock).mockImplementation(async (data) => data);
  });

  it('stores the resolved multi-level special inviter on the new referral', async () => {
    mockChain({
      [BAVISH]: [parentRef(NOTSHA, 'normal')],
      [NOTSHA]: [parentRef(SOREN, 'normal')],
      [SOREN]: [parentRef(SPECIAL, 'special')],
    });

    const referral = await commissionService.createReferral(
      {
        inviterId: BAVISH,
        inviterName: 'bavish',
        inviteeId: BATMAN,
        inviteeName: 'batman',
        inviterType: 'normal',
        ticketId: 'ticket-0042',
      },
      'admin-1',
    );

    expect(referral.indirectSpecialInviterId).toBe(SPECIAL);
    const created = (referralRepository.create as jest.Mock).mock.calls[0][0];
    expect(created.indirectSpecialInviterId).toBe(SPECIAL);
  });

  it('does not set an indirect link when the direct inviter is special', async () => {
    mockChain({});

    const referral = await commissionService.createReferral(
      {
        inviterId: SPECIAL,
        inviterName: 'isee_speed',
        inviteeId: SOREN,
        inviteeName: 'soren',
        inviterType: 'special',
      },
      'admin-1',
    );

    expect(referral.indirectSpecialInviterId).toBeNull();
    expect(referralRepository.findByInviteeId as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('updateReferral with inviter/invitee IDs', () => {
  const baseRow = {
    id: 'REF-1',
    inviterId: '111111111111111111',
    inviterName: 'old-boss',
    inviteeId: '222222222222222222',
    inviteeName: 'worker',
    inviterType: 'normal',
    status: 'pending',
    oneTimeCommissionPaid: false,
    oneTimeCommissionPaidAt: null,
    perTaskCommissionActive: false,
    ticketId: null,
    indirectSpecialInviterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    let saved: any = { ...baseRow };
    (referralRepository.findById as jest.Mock).mockImplementation(async () => ({ ...saved }));
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue(null);
    (referralRepository.update as jest.Mock).mockImplementation(async (_id: string, d: any) => {
      saved = { ...saved, ...d };
      return { ...saved };
    });
    mockChain({});
  });

  it('updates names + ticket without touching the chain when IDs are unchanged', async () => {
    const updated = await commissionService.updateReferral(
      'REF-1',
      { inviterName: 'new-boss', inviteeName: 'worker2', ticketId: 'ticket-1' },
      'admin-1',
    );

    expect(updated.inviterName).toBe('new-boss');
    expect(referralRepository.findByInviteeAndInviter as jest.Mock).not.toHaveBeenCalled();
    expect(referralRepository.findByInviteeId as jest.Mock).not.toHaveBeenCalled();
  });

  it('recomputes the indirect chain when the inviter changes to normal', async () => {
    mockChain({
      ['333333333333333333']: [parentRef(SPECIAL, 'special')],
    });

    await commissionService.updateReferral(
      'REF-1',
      { inviterId: '333333333333333333' },
      'admin-1',
    );

    const updateArg = (referralRepository.update as jest.Mock).mock.calls[0][1];
    expect(updateArg.inviterId).toBe('333333333333333333');
    expect(updateArg.inviterType).toBe('normal');
    expect(updateArg.indirectSpecialInviterId).toBe(SPECIAL);
  });

  it('flips to special with no indirect link when the new inviter is special', async () => {
    const REAL_SPECIAL = '582595416294555649';
    await commissionService.updateReferral('REF-1', { inviterId: REAL_SPECIAL }, 'admin-1');

    const updateArg = (referralRepository.update as jest.Mock).mock.calls[0][1];
    expect(updateArg.inviterType).toBe('special');
    expect(updateArg.indirectSpecialInviterId).toBeNull();
  });

  it('rejects a pair that belongs to another referral', async () => {
    (referralRepository.findByInviteeAndInviter as jest.Mock).mockResolvedValue({ id: 'REF-OTHER' });

    await expect(
      commissionService.updateReferral('REF-1', { inviterId: '333333333333333333' }, 'admin-1'),
    ).rejects.toThrow('Another referral already exists');
  });

  it('rejects invalid snowflakes', async () => {
    await expect(
      commissionService.updateReferral('REF-1', { inviterId: 'abc' }, 'admin-1'),
    ).rejects.toThrow('Invalid inviter ID.');
  });
});
