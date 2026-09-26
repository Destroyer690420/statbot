import express from 'express';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line prefer-const
let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
  initializeDatabase: jest.fn(),
}));

import {
  FixtureState,
  createMockDb,
  makeMockChannel,
  makeMockDiscordClient,
  collectKeys,
  MockChannel,
} from './worker-helpers';
import { WORKER_FORBIDDEN_FIELDS } from '../utils/worker-view';

/**
 * End-to-end worker isolation over real HTTP (ephemeral port + global fetch):
 * two fixture workers sharing one payout batch; every endpoint called as A
 * must never leak B, and never leak owner/admin fields.
 */

const A = '100000000000000001';
const B = '200000000000000002';
const WX = '300000000000000003';
const WY = '400000000000000004';
/** Workers Alice personally invited (A's own referral data — must be visible to A). */
const INVITEE1 = '500000000000000005';
const INVITEE2 = '500000000000000006';
/** Bob's invitee: reachable by A only as an anonymous multi-level total. */
const DOWNSTREAM = '600000000000000007';

function buildState(failChannel: MockChannel): FixtureState {
  const d = (s: string) => new Date(s);
  return {
    postRate: 60,
    commentRate: 30,
    tasks: [
      // ——— Alice (worker A) ———
      { id: 'tA1', type: 'POST', status: 'PENDING', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-09-01T00:00:00Z'), updatedAt: d('2026-09-02T00:00:00Z'), subreddit: 'AliceSub', title: 'Alice post', externalTaskId: '101' },
      { id: 'tA2', type: 'POST', status: 'REMINDER_20_SENT', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-09-01T01:00:00Z'), updatedAt: d('2026-09-02T01:00:00Z'), subreddit: 'AliceSub', title: 'Alice post two', externalTaskId: '102' },
      { id: 'tA3', type: 'COMMENT', status: 'COMPLETED', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-08-20T00:00:00Z'), updatedAt: d('2026-08-25T00:00:00Z'), subreddit: 'AliceSub', title: 'Alice comment', externalTaskId: '103' },
      { id: 'tA4', type: 'POST', status: 'ARCHIVED', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-08-10T00:00:00Z'), updatedAt: d('2026-08-15T00:00:00Z'), subreddit: 'AliceSub', title: 'Alice old post', externalTaskId: '104' },
      { id: 'tA5', type: 'POST', status: 'PENDING', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-09-03T00:00:00Z'), updatedAt: d('2026-09-03T00:00:00Z'), cancelledReason: 'deleted', subreddit: 'AliceSub', title: 'Alice deleted', externalTaskId: '105' },
      { id: 'tA6', type: 'COMMENT', status: 'COMPLETED', channelId: 'chan-alice', channelName: 'ticket-0001', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-08-21T00:00:00Z'), updatedAt: d('2026-08-26T00:00:00Z'), subreddit: 'AliceSub', title: 'Alice comment 2', externalTaskId: '106' },
      { id: 'tAF', type: 'POST', status: 'ACCEPTED', channelId: failChannel.id, channelName: 'ticket-0010', assignedUserId: A, assignedUserName: 'Alice Worker', createdAt: d('2026-09-04T00:00:00Z'), updatedAt: d('2026-09-04T00:00:00Z'), assignmentStatus: 'SENT', subreddit: 'AliceSub', title: 'Alice preparing', externalTaskId: '107' },
      // ——— Workers invited by Alice (invitee tasks only feed referral math) ———
      { id: 'tI21', type: 'POST', status: 'ARCHIVED', channelId: 'chan-inv1', channelName: 'ticket-0021', assignedUserId: INVITEE1, assignedUserName: 'Invited One', createdAt: d('2026-08-01T00:00:00Z'), updatedAt: d('2026-08-05T00:00:00Z'), subreddit: 'InvSub1', title: 'invited one post', externalTaskId: '501' },
      { id: 'tI22', type: 'COMMENT', status: 'COMPLETED', channelId: 'chan-inv2', channelName: 'ticket-0022', assignedUserId: INVITEE2, assignedUserName: 'Invited Two', createdAt: d('2026-08-02T00:00:00Z'), updatedAt: d('2026-08-06T00:00:00Z'), subreddit: 'InvSub2', title: 'invited two comment', externalTaskId: '502' },
      { id: 'tI23', type: 'POST', status: 'COMPLETED', channelId: 'chan-inv2', channelName: 'ticket-0022', assignedUserId: INVITEE2, assignedUserName: 'Invited Two', createdAt: d('2026-08-03T00:00:00Z'), updatedAt: d('2026-08-07T00:00:00Z'), subreddit: 'InvSub2', title: 'invited two post two', externalTaskId: '503' },
      // ——— Bob (worker B) ———
      { id: 'tB1', type: 'POST', status: 'PENDING', channelId: 'chan-bob', channelName: 'ticket-0002', assignedUserId: B, assignedUserName: 'Bobson McOther', createdAt: d('2026-09-01T00:00:00Z'), updatedAt: d('2026-09-02T00:00:00Z'), subreddit: 'ZzzSecretSubB', title: 'Bob secret title', externalTaskId: '201' },
      { id: 'tB2', type: 'POST', status: 'ARCHIVED', channelId: 'chan-bob', channelName: 'ticket-0002', assignedUserId: B, assignedUserName: 'Bobson McOther', createdAt: d('2026-08-10T00:00:00Z'), updatedAt: d('2026-08-15T00:00:00Z'), subreddit: 'ZzzSecretSubB', title: 'Bob old post', externalTaskId: '202' },
      { id: 'tB3', type: 'COMMENT', status: 'COMPLETED', channelId: 'chan-bob', channelName: 'ticket-0002', assignedUserId: B, assignedUserName: 'Bobson McOther', createdAt: d('2026-08-20T00:00:00Z'), updatedAt: d('2026-08-25T00:00:00Z'), subreddit: 'ZzzSecretSubB', title: 'Bob comment', externalTaskId: '203' },
      // ——— multi-assignee ticket (older X, newer Y) ———
      { id: 'tMX', type: 'POST', status: 'PENDING', channelId: 'chan-multi', channelName: 'ticket-0011', assignedUserId: WX, assignedUserName: 'X Old', createdAt: d('2026-08-01T00:00:00Z'), updatedAt: d('2026-08-02T00:00:00Z'), subreddit: 'Multi', title: 'old', externalTaskId: '301' },
      { id: 'tMY', type: 'POST', status: 'PENDING', channelId: 'chan-multi', channelName: 'ticket-0011', assignedUserId: WY, assignedUserName: 'Y New', createdAt: d('2026-09-01T00:00:00Z'), updatedAt: d('2026-09-02T00:00:00Z'), subreddit: 'Multi', title: 'new', externalTaskId: '302' },
      // ——— extra ticket channels for the 5-result cap ———
      ...[3, 4, 5, 6, 7, 8].map((n) => ({
        id: `tX${n}`,
        type: 'POST',
        status: 'PENDING',
        channelId: `chan-x${n}`,
        channelName: `ticket-000${n}`,
        assignedUserId: `90000000000000000${n}`,
        assignedUserName: `Extra ${n}`,
        createdAt: d('2026-09-01T00:00:00Z'),
        updatedAt: d('2026-09-02T00:00:00Z'),
        subreddit: 'Extra',
        title: `extra ${n}`,
        externalTaskId: `40${n}`,
      })),
    ],
    reminders: [
      { id: 'rA1', taskId: 'tA1', type: 'POST_20H', dueAt: d('2026-12-01T00:00:00Z'), sent: false, completed: false },
      { id: 'rA2', taskId: 'tA2', type: 'POST_20H', dueAt: d('2026-09-02T00:00:00Z'), sent: true, sentAt: d('2026-09-02T00:00:00Z'), completed: false, retryCount: 1 },
      { id: 'rA3', taskId: 'tA3', type: 'COMMENT_20H', dueAt: d('2026-08-21T00:00:00Z'), sent: true, sentAt: d('2026-08-21T00:00:00Z'), completed: true, completedAt: d('2026-08-22T00:00:00Z') },
      { id: 'rA6', taskId: 'tA6', type: 'COMMENT_20H', dueAt: d('2026-08-22T00:00:00Z'), sent: true, sentAt: d('2026-08-22T00:00:00Z'), completed: true, completedAt: d('2026-08-23T00:00:00Z') },
      { id: 'rB3', taskId: 'tB3', type: 'COMMENT_20H', dueAt: d('2026-08-21T00:00:00Z'), sent: true, sentAt: d('2026-08-21T00:00:00Z'), completed: true, completedAt: d('2026-08-24T00:00:00Z') },
    ],
    items: [
      { id: 'piA4', batchId: 'batch-1', taskId: 'tA4', workerId: A, taskType: 'POST', amount: 60, completedAt: d('2026-08-15T00:00:00Z'), createdAt: d('2026-08-28T00:00:00Z') },
      { id: 'piB2', batchId: 'batch-1', taskId: 'tB2', workerId: B, taskType: 'POST', amount: 77, completedAt: d('2026-08-15T00:00:00Z'), createdAt: d('2026-08-28T00:00:00Z') },
    ],
    batches: [
      { id: 'batch-1', batchNumber: 5, weekStart: d('2026-08-22T18:30:00Z'), weekEnd: d('2026-08-29T18:29:59.999Z'), totalWorkers: 2, totalTasks: 2, totalPosts: 2, totalComments: 0, totalAmount: 9999 },
    ],
    portalAccess: [],
    referrals: [
      // Alice's own invite whose ticket is stored as a channel mention.
      { id: 'REF-A1', inviterId: A, inviterName: 'Alice Worker', inviteeId: INVITEE1, inviteeName: 'Invited One', inviterType: 'normal', status: 'qualified', oneTimeCommissionPaid: true, oneTimeCommissionPaidAt: d('2026-08-10T00:00:00Z'), perTaskCommissionActive: false, ticketId: '<#chan-inv1>', indirectSpecialInviterId: null, createdAt: d('2026-07-20T00:00:00Z'), updatedAt: d('2026-08-10T00:00:00Z') },
      // Ticket stored as a plain channel name; bonus unlocked but unpaid.
      { id: 'REF-A2', inviterId: A, inviterName: 'Alice Worker', inviteeId: INVITEE2, inviteeName: 'Invited Two', inviterType: 'normal', status: 'pending', oneTimeCommissionPaid: false, oneTimeCommissionPaidAt: null, perTaskCommissionActive: false, ticketId: 'ticket-0022', indirectSpecialInviterId: null, createdAt: d('2026-08-01T00:00:00Z'), updatedAt: d('2026-08-01T00:00:00Z') },
      // Closed referrals are never listed.
      { id: 'REF-A3', inviterId: A, inviterName: 'Alice Worker', inviteeId: '500000000000000008', inviteeName: 'ClosedInviteSecret', inviterType: 'normal', status: 'closed', oneTimeCommissionPaid: false, oneTimeCommissionPaidAt: null, perTaskCommissionActive: false, ticketId: 'ticket-0099', indirectSpecialInviterId: null, createdAt: d('2026-07-01T00:00:00Z'), updatedAt: d('2026-07-01T00:00:00Z') },
      // Bob's referral: A only ever sees its money as an anonymous total.
      { id: 'REF-B1', inviterId: B, inviterName: 'Bobson McOther', inviteeId: DOWNSTREAM, inviteeName: 'ReferralSecret', inviterType: 'normal', status: 'pending', oneTimeCommissionPaid: false, oneTimeCommissionPaidAt: null, perTaskCommissionActive: false, ticketId: '<#chan-bob>', indirectSpecialInviterId: A, createdAt: d('2026-08-01T00:00:00Z'), updatedAt: d('2026-08-01T00:00:00Z') },
    ],
    commissionItems: [
      { id: 'ci-a1', batchId: 'cb-1', referralId: 'REF-A1', inviterId: A, invitedWorkerId: INVITEE1, sourceTaskId: null, commissionKind: 'one_time', amount: 100, createdAt: d('2026-08-10T00:00:00Z') },
      { id: 'ci-a2', batchId: 'cb-1', referralId: 'REF-A1', inviterId: A, invitedWorkerId: INVITEE1, sourceTaskId: 'tI21', commissionKind: 'per_task', amount: 20, createdAt: d('2026-08-10T00:00:00Z') },
      // Multi-level credit on somebody else's referral (Bob's invitee, Bob's task).
      { id: 'ci-team', batchId: 'cb-2', referralId: 'REF-B1', inviterId: A, invitedWorkerId: DOWNSTREAM, sourceTaskId: 'tB3', commissionKind: 'per_task_indirect', amount: 10, createdAt: d('2026-08-12T00:00:00Z') },
      // Bob's own commission: must never be counted for Alice.
      { id: 'ci-b1', batchId: 'cb-1', referralId: 'REF-B1', inviterId: B, invitedWorkerId: DOWNSTREAM, sourceTaskId: null, commissionKind: 'one_time', amount: 555, createdAt: d('2026-08-10T00:00:00Z') },
    ],
  };
}

const B_MARKERS = [B, 'Bobson McOther', 'ticket-0002', 'chan-bob', 'tB1', 'tB2', 'tB3', 'ZzzSecretSubB', 'Bob secret title', '77', '9999', 'ReferralSecret'];
const EXTRA_MARKERS = [WX, WY, 'X Old', 'Y New', 'chan-multi', 'ticket-0011', 'tMX', 'tMY'];

describe('worker isolation (HTTP)', () => {
  let base: string;
  let server: { close: (cb?: () => void) => void };
  let svc: typeof import('../services/worker-auth.service');
  let loggerMod: typeof import('../utils/logger');
  let tokenA: string;
  let channels: MockChannel[];
  let chanAlice: MockChannel;
  let chanBob: MockChannel;
  let chanFail: MockChannel;
  let chanMulti: MockChannel;
  let fixtureState: FixtureState;

  const api = async (path: string, init?: RequestInit, token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    return { status: res.status, body };
  };

  beforeAll(async () => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = 'x'.repeat(10);
    process.env.CLIENT_ID = 'test-client';
    process.env.GUILD_ID = 'guild-1';
    process.env.ADMIN_USER_IDS = '111';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'admin-secret-xyz-1234567890abcdef';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'pw';
    process.env.WORKER_JWT_SECRET = 'w'.repeat(40);
    process.env.WORKER_PORTAL_ENABLED = 'true';

    svc = await import('../services/worker-auth.service');
    loggerMod = await import('../utils/logger');
    const routes = (await import('../api/routes/worker')).default;

    chanAlice = makeMockChannel('chan-alice', 'ticket-0001');
    chanBob = makeMockChannel('chan-bob', 'ticket-0002');
    const chanEmpty = makeMockChannel('chan-empty', 'ticket-0009');
    chanFail = makeMockChannel('chan-fail', 'ticket-0010', { failSend: true });
    chanMulti = makeMockChannel('chan-multi', 'ticket-0011');
    const extras = [3, 4, 5, 6, 7, 8].map((n) => makeMockChannel(`chan-x${n}`, `ticket-000${n}`));
    channels = [chanAlice, chanBob, chanEmpty, chanFail, chanMulti, ...extras];
    const client = makeMockDiscordClient(channels);

    fixtureState = buildState(chanFail);
    mockDb = createMockDb(fixtureState);

    const app = express();
    app.use(express.json());
    app.use('/api/v1/worker', routes(client));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve()) as unknown as { close: (cb?: () => void) => void };
    });
    const addr = (server as unknown as { address: () => { port: number } }).address();
    base = `http://127.0.0.1:${addr.port}/api/v1/worker`;

    tokenA = svc.signWorkerToken({ workerId: A, channelId: 'chan-alice', name: 'Alice Worker' });
  }, 30000);

  afterAll((done) => {
    server?.close(() => done());
  });

  test('auth status reports the portal as enabled', async () => {
    const { status, body } = await api('/auth/status');
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.guildId).toBe('guild-1');
  });

  test('type-ahead: short queries return nothing; results are capped and whitelisted', async () => {
    const short = await api('/auth/tickets?q=ab', undefined, tokenA);
    expect(short.body.data).toEqual([]);

    const res = await api('/auth/tickets?q=ticket-000', undefined, tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.data.length).toBe(5);
    for (const item of res.body.data) {
      expect(Object.keys(item).sort()).toEqual(['channelId', 'name']);
    }
    // No counts, no worker data anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain('taskCount');
    expect(JSON.stringify(res.body)).not.toContain(A);
    expect(JSON.stringify(res.body)).not.toContain(B);
    // Case-insensitive contains.
    const upper = await api('/auth/tickets?q=TICKET-0002', undefined, tokenA);
    expect(upper.body.data).toEqual([{ channelId: 'chan-bob', name: 'ticket-0002' }]);
    // Channels without tasks never qualify.
    const empty = await api('/auth/tickets?q=ticket-0009', undefined, tokenA);
    expect(empty.body.data).toEqual([]);
  });

  test('request-code posts a mention-only message and never returns the code or identity', async () => {
    const { status, body } = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-alice' }) });
    expect(status).toBe(200);
    expect(body.data.expiresInSeconds).toBe(300);
    expect(body.data.cooldownSeconds).toBe(60);
    expect(JSON.stringify(body)).not.toContain(A);
    expect(JSON.stringify(body)).not.toContain('Alice');
    expect(chanAlice.sentMessages).toHaveLength(1);
    const sent = chanAlice.sentMessages[0];
    expect(sent.content).toContain(`<@${A}>`);
    expect(sent.content).not.toContain(B);
    expect(sent.allowedMentions).toEqual({ users: [A] });
  });

  test('a second request while the code is active does not post again', async () => {
    const { status, body } = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-alice' }) });
    expect(status).toBe(429);
    expect(body.message).toContain('already sent');
    expect(body.remainingSeconds).toBeGreaterThan(0);
    expect(chanAlice.sentMessages).toHaveLength(1);
  });

  test('unknown and task-less tickets share one generic 404', async () => {
    const bogus = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'nope-123' }) });
    const empty = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-empty' }) });
    expect(bogus.status).toBe(404);
    expect(empty.status).toBe(404);
    expect(bogus.body.message).toBe(empty.body.message);
  });

  test('sending failure leaves no stored code behind (502)', async () => {
    const { status } = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: chanFail.id }) });
    expect(status).toBe(502);
    expect(await svc.readOtpRecord(chanFail.id)).toBeNull();
  });

  test('newest task identity wins; multiple assignees log a warning (IDs only)', async () => {
    const warn = loggerMod.logger.warn as jest.Mock;
    warn.mockClear();
    const { status } = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-multi' }) });
    expect(status).toBe(200);
    expect(chanMulti.sentMessages).toHaveLength(1);
    expect(chanMulti.sentMessages[0].content).toContain(`<@${WY}>`);
    expect(chanMulti.sentMessages[0].content).not.toContain(WX);
    expect(chanMulti.sentMessages[0].allowedMentions).toEqual({ users: [WY] });
    expect(warn).toHaveBeenCalled();
  });

  test('verify-code: wrong code 401, correct code logs in and deletes the message, single-use', async () => {
    const before = chanAlice.sentMessages.length;
    expect(before).toBe(1);
    const wrong = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-alice', code: 'ZZZZZZZZ' }) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toContain('attempt');

    // Extract the real code from the mock (never sent to the client).
    const raw = chanAlice.sentMessages[0].content;
    const code = raw.replace(/.*\*\*([A-Z0-9-]+)\*\*.*/, '$1');
    const good = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-alice', code }) });
    expect(good.status).toBe(200);
    expect(good.body.data.token).toBeTruthy();
    expect(good.body.data.workerName).toBe('Alice Worker');
    expect(good.body.data.ticketName).toBe('ticket-0001');
    expect(JSON.stringify(good.body)).not.toContain(A);
    expect(fixtureState.portalAccess).toEqual(
      expect.arrayContaining([expect.objectContaining({ channelId: 'chan-alice', workerId: A })]),
    );
    // Bot message deleted on successful login.
    expect(chanAlice.deletedMessages).toContain(chanAlice.messageIds[0]);
    // Single-use.
    const reuse = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-alice', code }) });
    expect(reuse.status).toBe(401);
  });

  test('portal-access tracking failure does not fail a successful login', async () => {
    const channel = channels[5];
    const originalUpsert = mockDb.workerPortalAccess.upsert;
    mockDb.workerPortalAccess.upsert = async () => {
      throw new Error('tracking unavailable');
    };
    try {
      const requested = await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: channel.id }) });
      expect(requested.status).toBe(200);
      const code = channel.sentMessages[0].content.replace(/.*\*\*([A-Z0-9-]+)\*\*.*/, '$1');
      const verified = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ channelId: channel.id, code }) });
      expect(verified.status).toBe(200);
      expect(verified.body.data.token).toBeTruthy();
    } finally {
      mockDb.workerPortalAccess.upsert = originalUpsert;
    }
  });

  test('invalidation deletes the bot message too', async () => {
    // Fresh code on the multi channel (already has one active from the identity test — use bob).
    await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-bob' }) });
    const mid = chanBob.messageIds[chanBob.messageIds.length - 1];
    for (let i = 0; i < 5; i++) {
      await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ channelId: 'chan-bob', code: 'QQQQQQQQ' }) });
    }
    expect(chanBob.deletedMessages).toContain(mid);
  });

  test('logout denylists the token', async () => {
    const login = await api('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({
        channelId: 'chan-multi',
        code: chanMulti.sentMessages[0].content.replace(/.*\*\*([A-Z0-9-]+)\*\*.*/, '$1'),
      }),
    });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const out = await api('/auth/logout', { method: 'POST' }, token);
    expect(out.status).toBe(200);
    const me = await api('/me', undefined, token);
    expect(me.status).toBe(401);
  });

  describe('isolation: worker A sees only worker A', () => {
    const paths = [
      '/me',
      '/home',
      '/tasks?tab=todo',
      '/tasks?tab=completed&sub=all',
      '/tasks?tab=completed&sub=awaiting',
      '/tasks?tab=completed&sub=paid',
      '/tasks?tab=failed',
      '/tasks/tA1',
      '/wallet',
      '/invites',
    ];
    for (const p of paths) {
      test(`GET ${p} leaks nothing`, async () => {
        const { status, body } = await api(p, undefined, tokenA);
        expect(status).toBe(200);
        const json = JSON.stringify(body);
        for (const marker of [...B_MARKERS, ...EXTRA_MARKERS]) {
          expect(json).not.toContain(marker);
        }
        const keys = collectKeys(body);
        for (const f of WORKER_FORBIDDEN_FIELDS) {
          expect(keys).not.toContain(f);
        }
        for (const f of ['portalAccessed', 'portalLastSeenAt', 'firstSeenAt', 'lastSeenAt']) {
          expect(keys).not.toContain(f);
        }
        // Cache privacy.
        // (Cache-Control asserted separately below.)
      });
    }

    test('Cache-Control: no-store on data responses', async () => {
      const res = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
      expect(res.headers.get('cache-control')).toContain('no-store');
    });

    test("B's task detail returns the same 404 as a nonexistent id", async () => {
      const other = await api('/tasks/tB1', undefined, tokenA);
      const missing = await api('/tasks/definitely-missing', undefined, tokenA);
      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.body).toEqual(missing.body);
    });

    test('search for B returns nothing; pagination totals count only A', async () => {
      const search = await api('/tasks?tab=todo&q=ZzzSecretSubB', undefined, tokenA);
      expect(search.body.data).toEqual([]);
      expect(search.body.total).toBe(0);
      const todo = await api('/tasks?tab=todo', undefined, tokenA);
      // tA1, tA2, tAF — never B's or anyone else's.
      expect(todo.body.total).toBe(3);
      expect(todo.body.counts).toEqual({ todo: 3, completed: 3, failed: 1 });
      const failed = await api('/tasks?tab=failed', undefined, tokenA);
      expect(failed.body.total).toBe(1);
      expect(failed.body.data[0].id).toBe('tA5');
    });

    test('/me and /wallet shapes are worker-scoped', async () => {
      const me = await api('/me', undefined, tokenA);
      expect(me.body.data.workerId).toBe(A);
      expect(me.body.data.ticket.channelId).toBe('chan-alice');
      expect(me.body.data.ticket.discordUrl).toBe('https://discord.com/channels/guild-1/chan-alice');
      expect(me.body.data.rates).toEqual({ post: 60, comment: 30 });

      const wallet = await api('/wallet', undefined, tokenA);
      expect(wallet.body.data.lifetimePaid).toBe(60);
      expect(wallet.body.data.payments).toHaveLength(1);
      expect(wallet.body.data.payments[0].batchNumber).toBe(5);
      // Only A's own tasks inside the shared batch.
      expect(wallet.body.data.payments[0].tasks.map((t: { taskId: string }) => t.taskId)).toEqual(['tA4']);
    });

    test('/invites exposes A\'s own referrals, ticket numbers and referral money only', async () => {
      const res = await api('/invites', undefined, tokenA);
      expect(res.status).toBe(200);
      const { summary, invitees } = res.body.data;

      // Closed referrals never appear; counts come from the listed rows.
      expect(summary.invited).toBe(2);
      expect(summary.withTicket).toBe(2);
      // 100 bonus + 20 per-task already disbursed on REF-A1.
      expect(summary.directPaid).toBe(120);
      // REF-A2 crossed the 2-task threshold with no CommissionItem yet.
      expect(summary.directPending).toBe(100);
      // A's multi-level credit on Bob's referral — anonymous total only.
      expect(summary.teamPaid).toBe(10);
      expect(summary.paid).toBe(130);

      // Ticket numbers resolved from a channel mention and a plain name.
      expect(invitees).toEqual([
        { name: 'Invited One', ticket: 'ticket-0021', paid: 120 },
        { name: 'Invited Two', ticket: 'ticket-0022', paid: 0 },
      ]);

      const json = JSON.stringify(res.body);
      // No ids, no referral internals, no rates, no closed rows.
      for (const forbidden of [A, INVITEE1, INVITEE2, DOWNSTREAM, 'REF-A1', 'REF-A2', 'REF-B1', 'ClosedInviteSecret', 'one_time', 'per_task_indirect', 'normalInviteBonus']) {
        expect(json).not.toContain(forbidden);
      }
      // B's downstream invitee stays anonymous even though their task paid A.
      expect(json).not.toContain('ReferralSecret');
      expect(json).not.toContain('tB3');
      // Keys are exactly the whitelisted shape.
      expect(Object.keys(summary).sort()).toEqual(['directPaid', 'directPending', 'invited', 'paid', 'teamPaid', 'withTicket']);
      for (const row of invitees) {
        expect(Object.keys(row).sort()).toEqual(['name', 'paid', 'ticket']);
      }
    });

    test('/invites is empty (not an error) for a worker who never invited anyone', async () => {
      const tokenWx = svc.signWorkerToken({ workerId: WX, channelId: 'chan-multi', name: 'X Old' });
      const res = await api('/invites', undefined, tokenWx);
      expect(res.status).toBe(200);
      expect(res.body.data.invitees).toEqual([]);
      expect(res.body.data.summary).toEqual({
        invited: 0, withTicket: 0, paid: 0, directPaid: 0, directPending: 0, teamPaid: 0,
      });
    });
  });

  describe('wallet parity with payoutService.findEligibleTasks', () => {
    test('payable set for a week equals the payout service selection for that worker', async () => {
      const workerSvc = await import('../services/worker.service');
      const payoutSvc = (await import('../services/payout.service')).payoutService;
      const weekStart = new Date('2026-08-20T00:00:00Z');
      const weekEnd = new Date('2026-08-27T00:00:00Z');
      const mine = await workerSvc.findPayableTasksForWorkerWeek(A, weekStart, weekEnd);
      const eligible = await payoutSvc.findEligibleTasks(weekStart, weekEnd);
      const theirs = eligible.filter((t) => t.assignedUserId === A).map((t) => t.id).sort();
      expect(mine.map((m) => m.taskId).sort()).toEqual(theirs);
      // tA3 completes 2026-08-22 (in week), tA6 completes 2026-08-23 (in week), tA4 paid (excluded).
      expect(theirs).toEqual(['tA3', 'tA6']);
    });
  });

  describe('kill switch', () => {
    test('disabled portal: status reports disabled, everything else 404s', async () => {
      process.env.WORKER_PORTAL_ENABLED = 'false';
      jest.resetModules();
      const freshSvc = await import('../services/worker-auth.service');
      const freshRoutes = (await import('../api/routes/worker')).default;
      const client = makeMockDiscordClient(channels);
      const app = express();
      app.use(express.json());
      app.use('/api/v1/worker', freshRoutes(client));
      const srv: { close: (cb?: () => void) => void } = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s as never)) as never;
      });
      const addr = (srv as unknown as { address: () => { port: number } }).address();
      const b2 = `http://127.0.0.1:${addr.port}/api/v1/worker`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = (await (await fetch(`${b2}/auth/status`)).json()) as any;
        expect(st.data.enabled).toBe(false);
        const meRes = await fetch(`${b2}/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
        expect(meRes.status).toBe(404);
        expect(freshSvc.isWorkerPortalAvailable()).toBe(false);
      } finally {
        await new Promise<void>((r) => srv.close(() => r()));
        process.env.WORKER_PORTAL_ENABLED = 'true';
        jest.resetModules();
      }
    });
  });
});
