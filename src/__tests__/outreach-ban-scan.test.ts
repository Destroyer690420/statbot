/**
 * Daily outreach ban scan sweep: removal / ask / skip decisions.
 *
 * The service module pulls the DB layer (env-validated), so every boundary
 * is mocked before import — same pattern as `ticket-profile-check.test.ts`.
 * `discord.js` is mocked to a bare `TextChannel` class so the service's
 * `instanceof` gate passes for the fake ticket channels.
 */

const mockOutreachFindAll = jest.fn();
const mockUpsertSelection = jest.fn();
const mockOnboardingFindMany = jest.fn();
const mockOnboardingFindSingle = jest.fn();
const mockMarkChecked = jest.fn();
const mockLookup = jest.fn();
const mockAuditLog = jest.fn();

jest.mock(
  'discord.js',
  () => ({
    TextChannel: class MockTextChannel {},
  }),
  { virtual: false },
);

jest.mock('../database/repositories', () => ({
  outreachRepository: {
    findAll: (...args: unknown[]) => mockOutreachFindAll(...args),
    upsertSelection: (...args: unknown[]) => mockUpsertSelection(...args),
  },
  onboardingRepository: {
    findManyByChannelIds: (...args: unknown[]) => mockOnboardingFindMany(...args),
    findByChannelId: (...args: unknown[]) => mockOnboardingFindSingle(...args),
    markProfileChecked: (...args: unknown[]) => mockMarkChecked(...args),
  },
}));

jest.mock('../services/reddit-profile-check.service', () => ({
  lookupRedditProfile: (...args: unknown[]) => mockLookup(...args),
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: {
    log: (...args: unknown[]) => mockAuditLog(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../utils/permissions', () => ({
  getAllAdminIds: () => ['999'],
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TextChannel } = require('discord.js') as { TextChannel: new () => object };
import { runOutreachBanScan } from '../services/outreach-ban-scan.service';
import { OWNER_USER_ID, REDDIT_PROFILE_APPROVAL_ADMIN_ID } from '../config/constants';

const WORKER = '111';

function makeCollection(items: Array<{ id: string; user: { bot: boolean } }>) {
  const values = () => items.slice();
  return {
    filter: (fn: (m: { id: string; user: { bot: boolean } }) => boolean) => makeCollection(values().filter(fn)),
    first: () => values()[0],
    get size() {
      return items.length;
    },
  };
}

function makeChannel(id: string, workerId: string | null) {
  const sent: unknown[] = [];
  const base: Record<string, unknown> = {
    id,
    send: jest.fn(async (payload: unknown) => {
      sent.push(payload);
      return { id: 'msg-1' };
    }),
    guild: { members: { fetch: jest.fn(async () => undefined) } },
    members: makeCollection(
      workerId ? [{ id: workerId, user: { bot: false } }] : [],
    ),
  };
  Object.setPrototypeOf(base, TextChannel.prototype);
  return { channel: base as never, sent };
}

function makeClient(channelsById: Map<string, any>, opts: { workerDmFails?: boolean } = {}) {
  const dmSent: { id: string; content: string }[] = [];
  return {
    client: {
      guilds: { cache: { values: () => [] } },
      channels: {
        fetch: jest.fn(async (id: string) => channelsById.get(id) ?? null),
      },
      users: {
        fetch: jest.fn(async (id: string) => {
          if (opts.workerDmFails && id === WORKER) throw new Error('Cannot send messages to this user');
          return {
            send: jest.fn(async (payload: unknown) => {
              dmSent.push({ id, content: typeof payload === 'string' ? payload : JSON.stringify(payload) });
            }),
          };
        }),
      },
    } as never,
    dmSent,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOutreachFindAll.mockResolvedValue([]);
  mockOnboardingFindMany.mockResolvedValue([]);
  mockOnboardingFindSingle.mockResolvedValue(null);
  mockUpsertSelection.mockResolvedValue([]);
  mockMarkChecked.mockResolvedValue({});
  mockAuditLog.mockResolvedValue(undefined);
  mockLookup.mockResolvedValue({ kind: 'ok', profile: { username: 'w', linkKarma: 60, commentKarma: 60 } });
});

describe('runOutreachBanScan', () => {
  it('removes a suspended worker: deselects, stamps BANNED, DMs worker, tags owner, DMs admin', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: true }]);
    mockOnboardingFindMany.mockResolvedValue([{ channelId: 'chan-1', profileUsername: 'some_worker' }]);
    mockLookup.mockResolvedValue({ kind: 'suspended', username: 'some_worker' });
    const { channel, sent } = makeChannel('chan-1', WORKER);
    const { client, dmSent } = makeClient(new Map([['chan-1', channel]]));

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.selectedTotal).toBe(1);
    expect(result.checked).toBe(1);
    expect(result.banned).toHaveLength(1);
    expect(result.banned[0]).toMatchObject({ channelId: 'chan-1', username: 'some_worker' });
    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: 'chan-1', selected: false }]);
    expect(mockMarkChecked).toHaveBeenCalledWith(
      'chan-1',
      expect.objectContaining({ status: 'BANNED', username: 'some_worker' }),
    );
    // Worker DM (not a ticket message).
    const workerDm = dmSent.find((d) => d.id === WORKER);
    expect(workerDm).toBeDefined();
    expect(workerDm!.content.toLowerCase()).toContain('banned');
    expect(workerDm!.content).toContain('14');
    // Owner tag in the ticket.
    const ticketText = sent.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n');
    expect(ticketText).toContain(`<@${OWNER_USER_ID}>`);
    expect(ticketText).toContain('u/some_worker');
    // Admin summary DM.
    const adminDm = dmSent.find((d) => d.id === REDDIT_PROFILE_APPROVAL_ADMIN_ID);
    expect(adminDm).toBeDefined();
  });

  it('falls back to the ticket when the worker DM is closed (verdict never lost)', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: true }]);
    mockOnboardingFindMany.mockResolvedValue([{ channelId: 'chan-1', profileUsername: 'some_worker' }]);
    mockLookup.mockResolvedValue({ kind: 'suspended', username: 'some_worker' });
    const { channel, sent } = makeChannel('chan-1', WORKER);
    const { client } = makeClient(new Map([['chan-1', channel]]), { workerDmFails: true });

    await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    const ticketText = sent.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n');
    expect(ticketText).toContain('banned');
    expect(ticketText).toContain(`<@${OWNER_USER_ID}>`);
  });

  it('asks in-ticket (tagging the worker) when no profile username is stored', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: true }]);
    mockOnboardingFindMany.mockResolvedValue([{ channelId: 'chan-1', profileUsername: null }]);
    mockOnboardingFindSingle.mockResolvedValue({ channelId: 'chan-1', profileUsername: null });
    const { channel, sent } = makeChannel('chan-1', WORKER);
    const { client } = makeClient(new Map([['chan-1', channel]]));

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.missingAsked).toHaveLength(1);
    expect(result.banned).toHaveLength(0);
    expect(mockUpsertSelection).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
    const ticketText = sent.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n');
    expect(ticketText).toContain(`<@${WORKER}>`);
    expect(ticketText.toLowerCase()).toContain('reddit profile link');
  });

  it('leaves live accounts alone', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: true }]);
    mockOnboardingFindMany.mockResolvedValue([{ channelId: 'chan-1', profileUsername: 'healthy_guy' }]);
    mockLookup.mockResolvedValue({
      kind: 'ok',
      profile: { username: 'healthy_guy', linkKarma: 10, commentKarma: 10 },
    });
    const { channel } = makeChannel('chan-1', WORKER);
    const { client } = makeClient(new Map([['chan-1', channel]]));

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.checked).toBe(1);
    expect(result.banned).toHaveLength(0);
    expect(mockUpsertSelection).not.toHaveBeenCalled();
  });

  it('never removes on not_found (shadowban ambiguity) or lookup failures', async () => {
    mockOutreachFindAll.mockResolvedValue([
      { channelId: 'chan-1', selected: true },
      { channelId: 'chan-2', selected: true },
      { channelId: 'chan-3', selected: true },
    ]);
    mockOnboardingFindMany.mockResolvedValue([
      { channelId: 'chan-1', profileUsername: 'ghost_or_shadow' },
      { channelId: 'chan-2', profileUsername: 'rainy_day' },
      { channelId: 'chan-3', profileUsername: 'flaky_net' },
    ]);
    mockLookup
      .mockResolvedValueOnce({ kind: 'not_found', username: 'ghost_or_shadow' })
      .mockResolvedValueOnce({ kind: 'rate_limited' })
      .mockResolvedValueOnce({ kind: 'error', message: 'boom' });
    const c1 = makeChannel('chan-1', WORKER);
    const c2 = makeChannel('chan-2', WORKER);
    const c3 = makeChannel('chan-3', WORKER);
    const { client } = makeClient(
      new Map([
        ['chan-1', c1.channel],
        ['chan-2', c2.channel],
        ['chan-3', c3.channel],
      ]),
    );

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.banned).toHaveLength(0);
    expect(result.checked).toBe(0);
    expect(result.skipped).toHaveLength(3);
    expect(mockUpsertSelection).not.toHaveBeenCalled();
    expect(mockMarkChecked).not.toHaveBeenCalled();
  });

  it('flags session issues without removing anyone', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: true }]);
    mockOnboardingFindMany.mockResolvedValue([{ channelId: 'chan-1', profileUsername: 'w' }]);
    mockLookup.mockResolvedValue({ kind: 'no_session' });
    const { channel } = makeChannel('chan-1', WORKER);
    const { client, dmSent } = makeClient(new Map([['chan-1', channel]]));

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.sessionIssue).toBe(true);
    expect(result.banned).toHaveLength(0);
    expect(dmSent.find((d) => d.id === REDDIT_PROFILE_APPROVAL_ADMIN_ID)!.content.toLowerCase()).toContain(
      'session',
    );
  });

  it('ignores unselected tickets entirely', async () => {
    mockOutreachFindAll.mockResolvedValue([{ channelId: 'chan-1', selected: false }]);
    const { client } = makeClient(new Map());

    const result = await runOutreachBanScan(client, { dayKey: '2026-9-13' });

    expect(result.selectedTotal).toBe(0);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
