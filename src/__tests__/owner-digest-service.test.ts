import { Client } from 'discord.js';
import { OWNER_USER_ID } from '../config/constants';
import { runOwnerDigestForWeekKey, startOwnerDigestScheduler, stopOwnerDigestScheduler } from '../services/owner-digest.service';
import { auditRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';
import { ownerEarningsService } from '../services/owner-earnings.service';
import { logger } from '../utils/logger';
import { AuditAction } from '../types';

jest.mock('../database/repositories', () => ({
  auditRepository: { findLatestByAction: jest.fn() },
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../services/owner-earnings.service', () => ({
  ownerEarningsService: { getDigestWindow: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istMs = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  Date.UTC(y, mo - 1, d, h, mi, 0, 0) - IST_OFFSET_MS;

const DIGEST_DATA = {
  cohort: { total: 87, posts: 41, comments: 46, completed: 62, deleted: 9, open: 16 },
  summary: {
    totalTasks: 78,
    posts: 41,
    comments: 37,
    totalRevenue: 11250,
    totalWorkerCost: 3720,
    totalSpecialPerTaskComm: 1100,
    totalNormalBonuses: 150,
    totalSpecialBonuses: 90,
    totalEarnings: 11250 - 3720 - 1100 - 150 - 90,
  },
  rates: { revenuePerPost: 250, revenuePerComment: 100, workerPerPost: 60, workerPerComment: 30 },
};

function makeClient(): { client: Client; send: jest.Mock; fetchUser: jest.Mock } {
  const send = jest.fn().mockResolvedValue(undefined);
  const fetchUser = jest.fn().mockResolvedValue({ send });
  return { client: { users: { fetch: fetchUser } } as unknown as Client, send, fetchUser };
}

function mockServedKeys(keys: string[]): void {
  (auditRepository.findLatestByAction as jest.Mock).mockResolvedValue(
    keys.map((k) => ({ details: `owner-digest:${k}`, createdAt: new Date() })),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (ownerEarningsService.getDigestWindow as jest.Mock).mockResolvedValue(DIGEST_DATA);
  mockServedKeys([]);
});

afterEach(() => {
  stopOwnerDigestScheduler();
  jest.useRealTimers();
});

describe('runOwnerDigestForWeekKey', () => {
  it('sends the rendered digest to the owner and stamps the audit marker after the send', async () => {
    const { client, send, fetchUser } = makeClient();

    const result = await runOwnerDigestForWeekKey(client, '2026-10-15');

    expect(result.sent).toBe(true);
    expect(fetchUser).toHaveBeenCalledWith(OWNER_USER_ID);
    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0][0].content as string;
    expect(text).toContain('**Thu 15 Oct 2026 → Wed 21 Oct 2026** (IST)');
    expect(text).toContain('✅ Completed: 62');
    expect(text).toContain('🗑️ Deleted: 9');
    expect(text).toContain('💎 **Saved (net): ₹6,190**');
    expect(auditLogService.log).toHaveBeenCalledWith(
      AuditAction.DIGEST_SENT,
      null,
      OWNER_USER_ID,
      'owner-digest:2026-10-15',
    );
    // The window passed to the math is exactly Thursday→Wednesday IST.
    const [startUTC, endUTC] = (ownerEarningsService.getDigestWindow as jest.Mock).mock.calls[0];
    expect(startUTC.toISOString()).toBe('2026-10-14T18:30:00.000Z');
    expect(endUTC.toISOString()).toBe('2026-10-21T18:29:59.999Z');
  });

  it('marks a late catch-up send in the audit details', async () => {
    const { client } = makeClient();
    const result = await runOwnerDigestForWeekKey(client, '2026-10-15', { late: true });
    expect(result.sent).toBe(true);
    expect(auditLogService.log).toHaveBeenCalledWith(
      AuditAction.DIGEST_SENT,
      null,
      OWNER_USER_ID,
      'owner-digest:2026-10-15 [late]',
    );
  });

  it('skips a week that already has its DIGEST_SENT marker (even with a suffix)', async () => {
    mockServedKeys(['2026-10-08', '2026-10-15']);
    const { client, send, fetchUser } = makeClient();

    const result = await runOwnerDigestForWeekKey(client, '2026-10-15');

    expect(result.skipped).toBe('already_audited');
    expect(result.sent).toBe(false);
    expect(fetchUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(auditLogService.log).not.toHaveBeenCalled();
    expect(ownerEarningsService.getDigestWindow).not.toHaveBeenCalled();
  });

  it('without a client it returns the message and audits nothing (dry-run path)', async () => {
    const result = await runOwnerDigestForWeekKey(null, '2026-10-15');
    expect(result.skipped).toBe('no_client');
    expect(result.message).toContain('💎 **Saved (net): ₹6,190**');
    expect(auditLogService.log).not.toHaveBeenCalled();
  });

  it('a failed DM writes no audit marker so a later boot can retry the week', async () => {
    const { client, send } = makeClient();
    send.mockRejectedValue(new Error('DiscordAPIError: Cannot send messages to this user'));

    const result = await runOwnerDigestForWeekKey(client, '2026-10-15');

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe('send_failed');
    expect(result.error).toContain('Cannot send messages');
    expect(auditLogService.log).not.toHaveBeenCalled();
  });

  it('rejects a non-Thursday key instead of silently sending a wrong window', async () => {
    const { client } = makeClient();
    await expect(runOwnerDigestForWeekKey(client, '2026-10-16')).rejects.toThrow(/Thursday/);
    expect(ownerEarningsService.getDigestWindow).not.toHaveBeenCalled();
  });
});

describe('startOwnerDigestScheduler', () => {
  it('a Wednesday boot schedules Thursday 00:10 IST for the in-progress week, then serves it and re-arms', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(istMs(2026, 10, 28, 12, 0));
    const { client, send } = makeClient();

    await startOwnerDigestScheduler(client);

    expect(logger.info).toHaveBeenCalledWith(
      'Owner digest scheduled',
      expect.objectContaining({ key: '2026-10-22', late: false }),
    );

    // Fires at 00:10 IST Thursday, serves the closed week, re-arms for the next.
    await jest.advanceTimersByTimeAsync(istMs(2026, 10, 29, 0, 10) - istMs(2026, 10, 28, 12, 0) + 1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(auditLogService.log).toHaveBeenCalledWith(
      AuditAction.DIGEST_SENT,
      null,
      OWNER_USER_ID,
      'owner-digest:2026-10-22',
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Owner digest scheduled',
      expect.objectContaining({ key: '2026-10-29', late: false }),
    );

    // The next Thursday serves the next week — the chain keeps itself alive.
    await jest.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(auditLogService.log).toHaveBeenCalledWith(
      AuditAction.DIGEST_SENT,
      null,
      OWNER_USER_ID,
      'owner-digest:2026-10-29',
    );
  });

  it('a boot just after the send moment catches the closed week up late', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(istMs(2026, 10, 29, 0, 12));
    const { client, send } = makeClient();

    await startOwnerDigestScheduler(client);

    expect(logger.info).toHaveBeenCalledWith(
      'Owner digest scheduled',
      expect.objectContaining({ key: '2026-10-22', late: true }),
    );
    await jest.advanceTimersByTimeAsync(5100);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a restart after the week was already served never re-sends it', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(istMs(2026, 10, 29, 0, 12));
    mockServedKeys(['2026-10-22']);
    const { client, send } = makeClient();

    await startOwnerDigestScheduler(client);

    expect(logger.info).toHaveBeenCalledWith(
      'Owner digest scheduled',
      expect.objectContaining({ key: '2026-10-29', late: false }),
    );
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('is idempotent — a second start does not arm a second chain', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(istMs(2026, 10, 28, 12, 0));
    const { client } = makeClient();

    await startOwnerDigestScheduler(client);
    await startOwnerDigestScheduler(client);

    const scheduledCalls = (logger.info as jest.Mock).mock.calls.filter(
      ([msg]) => msg === 'Owner digest scheduled',
    );
    expect(scheduledCalls).toHaveLength(1);
  });
});
