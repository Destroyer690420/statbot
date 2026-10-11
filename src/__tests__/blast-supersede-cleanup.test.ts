/**
 * Supersede-cleanup guards (2026-10-10 incident: second-tab same-scan
 * reports each opened a competing blast; beginBlast closed the previous one
 * WITHOUT deleting its messages, stranding ~50 loser messages per blast).
 *
 * Pinned behavior:
 * - beginBlast deletes the superseded blast's loser messages (winners keep
 *   theirs) and still opens the new blast when cleanup fails.
 * - cleanupClosedBlastMessages never touches an OPEN blast or unknown id.
 */
import type { TextChannel } from 'discord.js';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../database/repositories', () => ({
  outreachRepository: {
    getOpenBlast: jest.fn(),
    getBlast: jest.fn(),
    countReplies: jest.fn(),
    closeBlast: jest.fn(),
    createBlast: jest.fn(),
    listReplyChannelIds: jest.fn(),
    listBlastMessages: jest.fn(),
  },
  taskRepository: {},
  workerPortalAccessRepository: { findAll: jest.fn() },
}));

type OutreachService = typeof import('../services/outreach.service')['outreachService'];

let outreachRepository: any;
let service: OutreachService;
let TextChannelCtor: any;
let CollectionCtor: any;

function setEnv() {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(10);
  process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
  process.env.GUILD_ID = process.env.GUILD_ID || 'guild-1';
  process.env.ADMIN_USER_IDS = '111';
  process.env.MANAGER_USER_IDS = '222';
  process.env.MODERATOR_USER_IDS = '';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.JWT_SECRET = 'admin-secret-' + 'x'.repeat(24);
  process.env.DASHBOARD_USERNAME = 'admin';
  process.env.DASHBOARD_PASSWORD = 'pw';
  process.env.DASHBOARD_URL = 'https://statbot.test';
  process.env.GOPARTTIME_API_KEY = 'a'.repeat(64);
  process.env.OWNER_PIN = '1234';
  process.env.WORKER_JWT_SECRET = 'w'.repeat(40);
  process.env.WORKER_PORTAL_ENABLED = 'true';
  process.env.GOPARTTIME_SESSION_KEY = 'b'.repeat(32);
  process.env.GOPARTTIME_AUTO_ACCEPT = 'true';
}

beforeEach(async () => {
  jest.resetModules();
  setEnv();
  const dj = await import('discord.js');
  TextChannelCtor = dj.TextChannel;
  CollectionCtor = dj.Collection;
  outreachRepository = (await import('../database/repositories')).outreachRepository;
  service = (await import('../services/outreach.service')).outreachService;
  jest.clearAllMocks();
  (outreachRepository.getOpenBlast as jest.Mock).mockResolvedValue(null);
  (outreachRepository.countReplies as jest.Mock).mockResolvedValue(0);
  (outreachRepository.closeBlast as jest.Mock).mockResolvedValue(undefined);
  (outreachRepository.createBlast as jest.Mock).mockImplementation(async (slotsTotal: number) => ({
    id: 'blast-new',
    slotsTotal,
  }));
  (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue([]);
  (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([]);
});

const deletedIds: string[] = [];

function makeChannel(id: string): TextChannel {
  const channel = Object.create(TextChannelCtor.prototype) as any;
  Object.defineProperty(channel, 'id', { value: id, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(channel, 'name', { value: id, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(channel, 'members', {
    value: new CollectionCtor(),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(channel, 'messages', {
    value: {
      fetch: jest.fn(async (mid: string) => ({ id: mid, author: { id: 'bot' } })),
      delete: jest.fn(async (mid: string) => {
        deletedIds.push(mid);
        return {};
      }),
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  return channel as TextChannel;
}

function makeClient(ids: string[]) {
  const channels = new Map(ids.map((id) => [id, makeChannel(id)]));
  return {
    channels: {
      fetch: jest.fn(async (id: string) => {
        const found = channels.get(id);
        if (!found) throw new Error('Unknown Channel');
        return found;
      }),
    },
    guilds: { cache: { values: () => [].values() } },
  } as any;
}

beforeEach(() => {
  deletedIds.length = 0;
});

describe('beginBlast supersede cleanup', () => {
  it('opens cleanly when no blast is open (no deletions)', async () => {
    const out = await service.beginBlast(makeClient([]), 4, 'burst');
    expect(out).toEqual({ id: 'blast-new', slotsTotal: 4 });
    expect(outreachRepository.closeBlast).not.toHaveBeenCalled();
    expect(deletedIds).toEqual([]);
  });

  it('deletes the superseded losers, keeps the winner, then opens the new blast', async () => {
    (outreachRepository.getOpenBlast as jest.Mock).mockResolvedValue({ id: 'blast-old', status: 'OPEN' });
    (outreachRepository.countReplies as jest.Mock).mockResolvedValue(1);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c-winner']);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { blastId: 'blast-old', channelId: 'c-winner', messageId: 'm-winner' },
      { blastId: 'blast-old', channelId: 'c-loser1', messageId: 'm-loser1' },
      { blastId: 'blast-old', channelId: 'c-loser2', messageId: 'm-loser2' },
    ]);

    const out = await service.beginBlast(makeClient(['c-winner', 'c-loser1', 'c-loser2']), 3, 'burst');

    expect(outreachRepository.closeBlast).toHaveBeenCalledWith('blast-old', 1);
    expect(deletedIds.sort()).toEqual(['m-loser1', 'm-loser2']);
    expect(out.id).toBe('blast-new');
    expect(outreachRepository.createBlast).toHaveBeenCalledWith(3, 'burst');
  });

  it('still opens the new blast when the supersede cleanup fails', async () => {
    (outreachRepository.getOpenBlast as jest.Mock).mockResolvedValue({ id: 'blast-old', status: 'OPEN' });
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { blastId: 'blast-old', channelId: 'c1', messageId: 'm1' },
    ]);
    // Discord-side failure (gone channel): counted failed, never thrown —
    // the new batch must still open.
    const failingClient = {
      channels: { fetch: jest.fn(async () => { throw new Error('Missing Access'); }) },
      guilds: { cache: { values: () => [].values() } },
    } as any;

    const out = await service.beginBlast(failingClient, 2, 'burst');
    expect(out.id).toBe('blast-new');
    expect(deletedIds).toEqual([]);
  });
});

describe('cleanupClosedBlastMessages (stuck-message sweep)', () => {
  it('refuses an OPEN blast (live round untouched)', async () => {
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({ id: 'blast-live', status: 'OPEN' });
    const out = await service.cleanupClosedBlastMessages(makeClient([]), 'blast-live');
    expect(out.skipped).toBe(true);
    expect(out.deleted).toBe(0);
    expect(outreachRepository.listBlastMessages).not.toHaveBeenCalled();
  });

  it('skips unknown blast ids', async () => {
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue(null);
    const out = await service.cleanupClosedBlastMessages(makeClient([]), 'blast-nope');
    expect(out.skipped).toBe(true);
  });

  it('deletes closed-blast losers and keeps winners', async () => {
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: 'blast-old',
      status: 'CLOSED',
      slotsTotal: 4,
      slotsFilled: 1,
    });
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c-winner']);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { blastId: 'blast-old', channelId: 'c-winner', messageId: 'm-winner' },
      { blastId: 'blast-old', channelId: 'c-loser', messageId: 'm-loser' },
    ]);
    const out = await service.cleanupClosedBlastMessages(makeClient(['c-winner', 'c-loser']), 'blast-old');
    expect(out).toMatchObject({ deleted: 1, failed: 0, skipped: false });
    expect(deletedIds).toEqual(['m-loser']);
  });
});
