/**
 * Equivalence guards for the Phase 1 blast speedup.
 *
 * The send loop went from a serial `for` loop with `await` in the body to a
 * bounded worker pool, the per-ticket daily-cap read became one grouped query,
 * and the two-round-trip delete became a single delete. These tests pin the
 * observable outcome — which tickets are sent, skipped, or failed, and with
 * which reason — so none of that can drift.
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
    findAll: jest.fn(),
    getMessage: jest.fn(),
    resetCycle: jest.fn(),
    getBlast: jest.fn(),
    recordBlastMessage: jest.fn(),
    setMessageSent: jest.fn(),
    listReplyChannelIds: jest.fn(),
    listBlastMessages: jest.fn(),
    getOpenBlast: jest.fn(),
  },
  taskRepository: {
    countGoPartTimePostsByWorkerInRange: jest.fn(),
    findByCreatedAt: jest.fn(),
  },
  workerPortalAccessRepository: { findAll: jest.fn() },
}));

/**
 * `jest.resetModules()` gives the freshly-imported service a NEW mock
 * repository instance, so the handles under test must be re-acquired from the
 * same registry rather than captured once at file scope.
 */
type OutreachService = typeof import('../services/outreach.service')['outreachService'];

let outreachRepository: any;
let taskRepository: any;
let service: OutreachService;

/**
 * `jest.resetModules()` re-instantiates discord.js, so the class objects the
 * service compares against (`channel instanceof TextChannel`) are NOT the ones
 * a top-level import would hold. These are re-acquired from the same fresh
 * registry as the service, otherwise every channel looks "not a text channel".
 */
let TextChannelCtor: any;
let CollectionCtor: any;

const BLAST = { id: 'blast-1', slotsTotal: 3 };

beforeEach(async () => {
  jest.resetModules();
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

  const dj = await import('discord.js');
  TextChannelCtor = dj.TextChannel;
  CollectionCtor = dj.Collection;

  const repos = await import('../database/repositories');
  outreachRepository = repos.outreachRepository;
  taskRepository = repos.taskRepository;
  service = (await import('../services/outreach.service')).outreachService;

  jest.clearAllMocks();
  (outreachRepository.getMessage as jest.Mock).mockResolvedValue({ message: 'hello {user}' });
  (outreachRepository.resetCycle as jest.Mock).mockResolvedValue(undefined);
  (outreachRepository.recordBlastMessage as jest.Mock).mockResolvedValue(undefined);
  (outreachRepository.setMessageSent as jest.Mock).mockResolvedValue(undefined);
  (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue([]);
  (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([]);
  (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValue(new Map());
  // Blast stays OPEN and unfilled: no post-send sweep unless a test says so.
  (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
    id: BLAST.id,
    status: 'OPEN',
    slotsTotal: 3,
    slotsFilled: 0,
  });
});

interface FakeMember {
  id: string;
  user: { bot: boolean };
}

function makeChannel(opts: {
  id: string;
  name: string;
  members?: FakeMember[];
  sendImpl?: (content: string) => Promise<{ id: string }>;
  deleteImpl?: (id: string) => Promise<unknown>;
}): TextChannel {
  // `Object.create(TextChannel.prototype)` gives a real `instanceof TextChannel`
  // (the service branches on it) without constructing a guild. Several
  // TextChannel members are prototype accessors delegating to `guild`, so they
  // must be shadowed with own data properties rather than assigned.
  const channel = Object.create(TextChannelCtor.prototype) as any;
  const define = (key: string, value: unknown) =>
    Object.defineProperty(channel, key, { value, writable: true, configurable: true, enumerable: true });

  define('id', opts.id);
  define('name', opts.name);

  const members = new CollectionCtor();
  for (const m of opts.members ?? []) members.set(m.id, m);
  define('members', members);

  define('send', jest.fn(async (content: string) =>
    opts.sendImpl ? opts.sendImpl(content) : { id: `msg-${opts.id}` },
  ));
  define('messages', {
    fetch: jest.fn(async (id: string) => ({ id, author: { id: 'bot' } })),
    delete: jest.fn(async (id: string) => {
      if (opts.deleteImpl) return opts.deleteImpl(id);
      return {};
    }),
  });
  return channel as TextChannel;
}

function makeClient(channels: Map<string, TextChannel>) {
  return {
    channels: {
      fetch: jest.fn(async (id: string) => {
        const found = channels.get(id);
        if (!found) throw new Error('Unknown Channel');
        return found;
      }),
    },
    guilds: {
      cache: {
        values: () => [].values(),
      },
    },
  } as any;
}

function outreachRow(channelId: string, overrides: Record<string, unknown> = {}) {
  return {
    channelId,
    selected: true,
    messageSentAt: new Date(),
    availableAt: null,
    ...overrides,
  };
}


describe('sendBlastMessages - classification is unchanged', () => {
  it('sends to every selected ticket that has a worker under the cap', async () => {
    const rows = [outreachRow('c1'), outreachRow('c2'), outreachRow('c3')];
    (outreachRepository.findAll as jest.Mock).mockResolvedValue(rows);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
      ['c3', makeChannel({ id: 'c3', name: 't3', members: [{ id: 'w3', user: { bot: false } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent.filter((s) => s.ok).map((s) => s.channelId).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(skipped).toEqual([]);
    // Message content is still built with the worker's mention.
    expect(channels.get('c1')!.send).toHaveBeenCalledWith('hello <@w1>');
  });

  it('skips a ticket with no non-bot worker', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'b1', user: { bot: true } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent).toEqual([]);
    expect(skipped).toEqual([
      { channelId: 'c1', channelName: 't1', reason: 'no worker in ticket' },
    ]);
  });

  it('never treats a bot or the admin as the ticket worker', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    // Only an admin is present: staff must not be counted as the worker.
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: process.env.ADMIN_USER_IDS!.split(',')[0], user: { bot: false } }] })],
    ]);

    const { skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(skipped).toEqual([
      { channelId: 'c1', channelName: 't1', reason: 'no worker in ticket' },
    ]);
  });

  it('skips a capped worker with the same reason string as before', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValue(
      new Map([['w1', 2]]),
    );
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent).toEqual([]);
    expect(skipped).toEqual([
      { channelId: 'c1', channelName: 't1', reason: 'worker at daily cap (2/2)' },
    ]);
  });

  it('reports an unresolvable channel as a failed send, not a skip', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('gone')]);
    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(new Map()),
      BLAST,
      'manager',
    );

    expect(skipped).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channelId: 'gone', ok: false });
    expect(sent[0].error).toContain('Unknown Channel');
  });

  it('reports a send failure without abandoning the other tickets', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1'), outreachRow('c2')]);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }], sendImpl: async () => { throw new Error('Missing Permissions'); } })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
    ]);

    const { sent } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    const byId = new Map(sent.map((s) => [s.channelId, s]));
    expect(byId.get('c1')).toMatchObject({ ok: false, error: 'Missing Permissions' });
    expect(byId.get('c2')).toMatchObject({ ok: true, channelName: 't2' });
  });

  it('records a blast message for every successful send', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1'), outreachRow('c2')]);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
    ]);

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    const recorded = (outreachRepository.recordBlastMessage as jest.Mock).mock.calls.map((c) => c[2]);
    expect(recorded.sort()).toEqual(['msg-c1', 'msg-c2']);
    for (const call of (outreachRepository.recordBlastMessage as jest.Mock).mock.calls) {
      expect(call[0]).toBe(BLAST.id);
    }
  });

  it('ignores unselected tickets entirely', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([
      outreachRow('c1', { selected: false }),
    ]);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent).toEqual([]);
    expect(skipped).toEqual([]);
    expect(channels.get('c1')!.send).not.toHaveBeenCalled();
  });
});

describe('sendBlastMessages - daily cap is read ONCE for the whole blast', () => {
  it('does not issue one cap query per ticket', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => outreachRow(`c${i}`));
    (outreachRepository.findAll as jest.Mock).mockResolvedValue(rows);
    const channels = new Map<string, TextChannel>(
      rows.map((r) => [
        r.channelId,
        makeChannel({ id: r.channelId, name: r.channelId, members: [{ id: `w${r.channelId}`, user: { bot: false } }] }),
      ]),
    );

    const { sent } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent.filter((s) => s.ok)).toHaveLength(40);
    // The whole point of the grouped query: ONE call, not 40.
    const capCalls = (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mock.calls;
    expect(capCalls).toHaveLength(1);
    expect(capCalls[0][0].sort()).toEqual(
      Array.from({ length: 40 }, (_, i) => `wc${i}`).sort(),
    );
  });

  it('does not load the whole task day per ticket any more', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1'), outreachRow('c2')]);
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
    ]);

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    expect(taskRepository.findByCreatedAt).not.toHaveBeenCalled();
  });

  it('treats a worker missing from the cap map as zero', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValue(new Map());
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);

    const { sent } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );
    expect(sent.filter((s) => s.ok)).toHaveLength(1);
  });

  it('still sends everything if the grouped cap read fails (fail-open, as an empty day did)', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockRejectedValue(new Error('db down'));
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);

    const { sent } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );
    expect(sent.filter((s) => s.ok)).toHaveLength(1);
  });
});

describe('sendBlastMessages - stop-the-send still fails closed', () => {
  it('skips the rest and sends nothing once the blast is not OPEN', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1'), outreachRow('c2')]);
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'CLOSED',
      slotsTotal: 3,
      slotsFilled: 3,
    });
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      'blast closed before send',
      'blast closed before send',
    ]);
    expect(channels.get('c1')!.send).not.toHaveBeenCalled();
  });

  it('fails closed when the blast row cannot be read at all', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.getBlast as jest.Mock).mockRejectedValue(new Error('db down'));
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);

    const { sent, skipped } = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );

    expect(sent).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['blast closed before send']);
  });

  it('collapses the per-send liveness read into a bounded number of reads', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => outreachRow(`c${i}`));
    (outreachRepository.findAll as jest.Mock).mockResolvedValue(rows);
    const channels = new Map<string, TextChannel>(
      rows.map((r) => [
        r.channelId,
        makeChannel({ id: r.channelId, name: r.channelId, members: [{ id: `w${r.channelId}`, user: { bot: false } }] }),
      ]),
    );

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    // One liveness read (shared by all 30 sends) + one final check. Previously
    // this was one read per send, i.e. 30.
    const blastReads = (outreachRepository.getBlast as jest.Mock).mock.calls.length;
    expect(blastReads).toBeLessThanOrEqual(3);
  });
});

describe('sendBlastMessages - stale daily reset', () => {
  it('resets stale rows and does not touch fresh ones', async () => {
    const stale = outreachRow('c1', { messageSentAt: new Date('2020-01-01T00:00:00Z') });
    const fresh = outreachRow('c2', { messageSentAt: new Date() });
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([stale, fresh]);
    const channels = new Map<string, TextChannel>([
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [{ id: 'w2', user: { bot: false } }] })],
    ]);

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    expect(outreachRepository.resetCycle).toHaveBeenCalledTimes(1);
    expect(outreachRepository.resetCycle).toHaveBeenCalledWith('c1');
  });
});

describe('blast cleanup deletes in one round trip per message', () => {
  async function fillAndSweep(blastMessages: { channelId: string; messageId: string }[], winners: string[]) {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue(blastMessages);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(winners);
    // Filled blast -> the post-send sweep runs.
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'OPEN',
      slotsTotal: 1,
      slotsFilled: 1,
    });
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
    ]);
    return service.sendBlastMessages(makeClient(channels), BLAST, 'manager');
  }

  it('deletes loser messages and never touches a winner', async () => {
    const messages = [
      { channelId: 'c1', messageId: 'm-win' },
      { channelId: 'c2', messageId: 'm-lose1' },
      { channelId: 'c3', messageId: 'm-lose2' },
    ];
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [] })],
      ['c3', makeChannel({ id: 'c3', name: 't3', members: [] })],
    ]);
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue(messages);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c1']);
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'OPEN',
      slotsTotal: 1,
      slotsFilled: 1,
    });

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    expect(channels.get('c1')!.messages.delete).not.toHaveBeenCalled();
    expect(channels.get('c2')!.messages.delete).toHaveBeenCalledWith('m-lose1');
    expect(channels.get('c3')!.messages.delete).toHaveBeenCalledWith('m-lose2');
  });

  it('no longer fetches each message before deleting it', async () => {
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      ['c2', makeChannel({ id: 'c2', name: 't2', members: [] })],
    ]);
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { channelId: 'c2', messageId: 'm-lose' },
    ]);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c1']);
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'OPEN',
      slotsTotal: 1,
      slotsFilled: 1,
    });

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    // The removed authorship pre-check: no messages.fetch round trip.
    expect(channels.get('c2')!.messages.fetch).not.toHaveBeenCalled();
    expect(channels.get('c2')!.messages.delete).toHaveBeenCalledTimes(1);
  });

  it('does not count an already-deleted message (404) as a failure', async () => {
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      [
        'c2',
        makeChannel({
          id: 'c2',
          name: 't2',
          members: [],
          deleteImpl: async () => {
            const err: any = new Error('Unknown Message');
            err.code = 10007;
            throw err;
          },
        }),
      ],
    ]);
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { channelId: 'c2', messageId: 'm-gone' },
    ]);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c1']);
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'OPEN',
      slotsTotal: 1,
      slotsFilled: 1,
    });

    const result = await service.sendBlastMessages(
      makeClient(channels),
      BLAST,
      'manager',
    );
    // The public result only reports sends/skips; the important assertion is
    // that a 404 does not throw out of the sweep.
    expect(result.sent.filter((s) => s.ok)).toHaveLength(1);
  });

  it('counts a real delete failure without aborting the rest', async () => {
    const channels = new Map<string, TextChannel>([
      ['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })],
      [
        'c2',
        makeChannel({
          id: 'c2',
          name: 't2',
          members: [],
          deleteImpl: async () => {
            throw new Error('Missing Permissions');
          },
        }),
      ],
      ['c3', makeChannel({ id: 'c3', name: 't3', members: [] })],
    ]);
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    (outreachRepository.listBlastMessages as jest.Mock).mockResolvedValue([
      { channelId: 'c2', messageId: 'm-fail' },
      { channelId: 'c3', messageId: 'm-ok' },
    ]);
    (outreachRepository.listReplyChannelIds as jest.Mock).mockResolvedValue(['c1']);
    (outreachRepository.getBlast as jest.Mock).mockResolvedValue({
      id: BLAST.id,
      status: 'OPEN',
      slotsTotal: 1,
      slotsFilled: 1,
    });

    await service.sendBlastMessages(makeClient(channels), BLAST, 'manager');

    expect(channels.get('c2')!.messages.delete).toHaveBeenCalled();
    expect(channels.get('c3')!.messages.delete).toHaveBeenCalledWith('m-ok');
  });

  it('is a no-op when the blast has no recorded messages', async () => {
    await expect(fillAndSweep([], [])).resolves.toMatchObject({ sent: expect.any(Array) });
  });
});

describe('member cache safety net', () => {
  it('refreshes guild members when a ticket has none cached', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    const channel = makeChannel({ id: 'c1', name: 't1', members: [] });
    const membersFetch = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(new Map([['c1', channel]]));
    (client.guilds.cache as any).values = () => [{ members: { fetch: membersFetch } }][Symbol.iterator]();

    const { skipped } = await service.sendBlastMessages(client, BLAST, 'manager');

    // The recovery path ran...
    expect(membersFetch).toHaveBeenCalled();
    // ...and with an empty member list the ticket is still reported honestly.
    expect(skipped.map((s) => s.reason)).toEqual(['no worker in ticket']);
  });

  it('does NOT refresh guild members when every ticket already has a cached worker', async () => {
    (outreachRepository.findAll as jest.Mock).mockResolvedValue([outreachRow('c1')]);
    const membersFetch = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(
      new Map([['c1', makeChannel({ id: 'c1', name: 't1', members: [{ id: 'w1', user: { bot: false } }] })]]),
    );
    (client.guilds.cache as any).values = () => [{ members: { fetch: membersFetch } }][Symbol.iterator]();

    await service.sendBlastMessages(client, BLAST, 'manager');

    // This is the 1.2s-per-blast call we stopped paying for.
    expect(membersFetch).not.toHaveBeenCalled();
  });
});
