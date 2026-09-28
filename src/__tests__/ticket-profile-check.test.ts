/**
 * The ticket profile-check flow: which branch runs for a given ticket state
 * and worker message, and what reaches Discord.
 *
 * The guard that matters most is the first one — a ticket with no enrollment
 * must be completely ignored. There are ~250 tickets that predate this
 * feature, and if this flow touched them, every one of those workers would be
 * asked for a profile link again months into their work.
 */

const mockFindByChannelId = jest.fn();
const mockMarkProfileChecked = jest.fn();
const mockMarkGuideSent = jest.fn();
const mockIncrementProfileReask = jest.fn();
const mockLookup = jest.fn();

jest.mock('../database/repositories', () => ({
  onboardingRepository: {
    findByChannelId: (...args: unknown[]) => mockFindByChannelId(...args),
    markProfileChecked: (...args: unknown[]) => mockMarkProfileChecked(...args),
    markGuideSent: (...args: unknown[]) => mockMarkGuideSent(...args),
    incrementProfileReask: (...args: unknown[]) => mockIncrementProfileReask(...args),
  },
}));

jest.mock('../services/reddit-profile-check.service', () => ({
  lookupRedditProfile: (...args: unknown[]) => mockLookup(...args),
  describeLookupFailure: (r: { kind: string }) => `reason:${r.kind}`,
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../utils/permissions', () => ({
  getAllAdminIds: () => ['999'],
}));

import { handleTicketProfileFlow } from '../services/ticket-profile-check.service';
import { REDDIT_PROFILE_APPROVAL_ADMIN_ID, REDDIT_PROFILE_MAX_REASKS } from '../config/constants';

const WORKER = '111';

const sent: string[] = [];
const dmSent: { id: string; content: string }[] = [];

/**
 * Minimal stand-in for a discord.js Collection. The service calls
 * `channel.members.filter(...)` and then reads `.size`/`.first()`, which a
 * plain Map does not provide.
 */
function makeCollection(items: Array<{ id: string; user: { bot: boolean } }>) {
  const values = () => items.slice();
  return {
    filter: (fn: (m: { id: string; user: { bot: boolean } }) => boolean) =>
      makeCollection(values().filter(fn)),
    first: () => values()[0],
    get size() {
      return items.length;
    },
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chan-1',
    name: 'ticket-0001',
    send: jest.fn(async (payload: unknown) => {
      sent.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }),
    guild: { members: { fetch: jest.fn(async () => undefined) } },
    members: makeCollection([{ id: WORKER, user: { bot: false } }]),
    ...overrides,
  } as never;
}

const approverSend = jest.fn(async (payload: unknown) => {
  dmSent.push({ id: 'approver', content: typeof payload === 'string' ? payload : JSON.stringify(payload) });
});

const fetchUser = jest.fn(async (id: string) => ({
  send: jest.fn(async (payload: unknown) => {
    dmSent.push({ id, content: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }),
}));
const client = { users: { fetch: fetchUser } } as never;

beforeEach(() => {
  jest.clearAllMocks();
  sent.length = 0;
  dmSent.length = 0;
  mockFindByChannelId.mockResolvedValue({ profileCheckStatus: 'PENDING', profileReaskCount: 0, guideSentAt: null });
  mockLookup.mockResolvedValue({ kind: 'ok', profile: { username: 'some_worker', linkKarma: 30, commentKarma: 40 } });
  fetchUser.mockImplementation(async (id: string) => ({
    send: jest.fn(async (payload: unknown) => {
      dmSent.push({ id, content: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }),
  }));
});

describe('tickets that must not be touched', () => {
  it('ignores a ticket that predates the feature (no enrollment)', async () => {
    // This is the ~250 existing tickets. Null status means "not enrolled".
    mockFindByChannelId.mockResolvedValue({ profileCheckStatus: null, welcomeSentAt: new Date(), guideSentAt: null });

    const handled = await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'hello there',
    });

    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('ignores a ticket with no onboarding row at all', async () => {
    mockFindByChannelId.mockResolvedValue(null);

    expect(
      await handleTicketProfileFlow({ client, channel: makeChannel(), authorId: WORKER, content: 'hi' }),
    ).toBe(false);
  });

  it('ignores a status it does not recognise instead of guessing', async () => {
    mockFindByChannelId.mockResolvedValue({ profileCheckStatus: 'SOMETHING_NEW', profileReaskCount: 0 });

    expect(
      await handleTicketProfileFlow({
        client,
        channel: makeChannel(),
        authorId: WORKER,
        content: 'https://www.reddit.com/user/some_worker',
      }),
    ).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('stays quiet once a worker has passed', async () => {
    mockFindByChannelId.mockResolvedValue({ profileCheckStatus: 'PASSED', guideSentAt: new Date() });

    expect(
      await handleTicketProfileFlow({
        client,
        channel: makeChannel(),
        authorId: WORKER,
        content: 'https://www.reddit.com/user/some_worker',
      }),
    ).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('stays quiet once a worker is known to be banned', async () => {
    mockFindByChannelId.mockResolvedValue({ profileCheckStatus: 'BANNED', profileReaskCount: 0 });

    expect(
      await handleTicketProfileFlow({
        client,
        channel: makeChannel(),
        authorId: WORKER,
        content: 'https://www.reddit.com/user/some_worker',
      }),
    ).toBe(false);
  });

  it('ignores a message from someone who is not the ticket worker', async () => {
    expect(
      await handleTicketProfileFlow({
        client,
        channel: makeChannel(),
        authorId: 'somebody-else',
        content: 'https://www.reddit.com/user/some_worker',
      }),
    ).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('ignores a channel with more than one non-staff member (not a ticket)', async () => {
    const channel = makeChannel({
      members: makeCollection([
        { id: WORKER, user: { bot: false } },
        { id: '222', user: { bot: false } },
      ]),
    });

    expect(
      await handleTicketProfileFlow({
        client,
        channel,
        authorId: WORKER,
        content: 'https://www.reddit.com/user/some_worker',
      }),
    ).toBe(false);
  });

  it('ignores a staff member even when they are the only member', async () => {
    const channel = makeChannel({ members: makeCollection([{ id: '999', user: { bot: false } }]) });

    expect(
      await handleTicketProfileFlow({ client, channel, authorId: '999', content: 'https://www.reddit.com/user/x_1' }),
    ).toBe(false);
  });
});

describe('replies that are not a profile link', () => {
  it('asks again when the worker says something else', async () => {
    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'hi, when do i start?',
    });

    expect(sent.join('\n')).toContain(`<@${WORKER}>`);
    expect(mockIncrementProfileReask).toHaveBeenCalledWith('chan-1');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('does not claim a non-link message, so a screenshot reply is not swallowed', async () => {
    // A ticket can hold a live task before the worker ever shares a profile,
    // and a 20h insight upload in that window must still reach its handler.
    // The re-ask is a side effect, not a claim on the message.
    const handled = await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'here is my view data',
    });

    expect(handled).toBe(false);
    expect(sent.join('\n')).toContain(`<@${WORKER}>`);
  });

  it('claims a profile link so it cannot be recorded as a submitted post', async () => {
    // Otherwise handleInstructionReply would accept the profile URL as the
    // worker's submission.
    const handled = await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(handled).toBe(true);
  });

  it('goes quiet at the re-ask cap so small talk cannot loop forever', async () => {
    mockFindByChannelId.mockResolvedValue({
      profileCheckStatus: 'PENDING',
      profileReaskCount: REDDIT_PROFILE_MAX_REASKS,
    });

    await handleTicketProfileFlow({ client, channel: makeChannel(), authorId: WORKER, content: 'ok' });

    expect(sent).toHaveLength(0);
    expect(mockIncrementProfileReask).not.toHaveBeenCalled();
  });

  it('still checks a link after the re-ask cap is reached', async () => {
    // The cap limits nagging, not the worker's ability to answer.
    mockFindByChannelId.mockResolvedValue({
      profileCheckStatus: 'PENDING',
      profileReaskCount: REDDIT_PROFILE_MAX_REASKS,
    });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(mockLookup).toHaveBeenCalledWith('some_worker');
  });
});

describe('passing the check', () => {
  it('sends the guide, stamps it, and DMs the approver', async () => {
    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    const ticketText = sent.join('\n');
    // The guide is the reward for passing. It references the three onboarding
    // channels by id, so that is what identifies it here.
    expect(ticketText).toContain('<#1520466000477163550>');
    expect(ticketText).toContain('verified');
    expect(mockMarkGuideSent).toHaveBeenCalledWith('chan-1');
    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'PASSED', username: 'some_worker', linkKarma: 30, commentKarma: 40 },
    );

    const dm = dmSent.find((d) => d.id === REDDIT_PROFILE_APPROVAL_ADMIN_ID);
    expect(dm).toBeDefined();
    expect(dm!.content).toContain('ticket-0001');
    expect(dm!.content).toContain('u/some_worker');
  });

  it('does not DMs the worker on a pass, so nothing in the ticket looks like a test', async () => {
    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(dmSent.some((d) => d.id === WORKER)).toBe(false);
  });

  it('does not stamp the guide when the send failed, so it can be retried', async () => {
    const channel = makeChannel({
      send: jest.fn(async () => {
        throw new Error('discord down');
      }),
    });

    await handleTicketProfileFlow({
      client,
      channel,
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(mockMarkGuideSent).not.toHaveBeenCalled();
  });
});

describe('failing the check', () => {
  it('tells a suspended worker to make a new account and never tags the admin', async () => {
    mockLookup.mockResolvedValue({ kind: 'suspended', username: 'some_worker' });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    const dm = dmSent.find((d) => d.id === WORKER);
    expect(dm).toBeDefined();
    expect(dm!.content.toLowerCase()).toContain('banned');
    expect(dm!.content.toLowerCase()).toContain('new account');
    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'BANNED', username: 'some_worker', linkKarma: null, commentKarma: null },
    );
    // A banned worker must not be queued for outreach.
    expect(dmSent.some((d) => d.id === REDDIT_PROFILE_APPROVAL_ADMIN_ID)).toBe(false);
    expect(sent.join('\n')).not.toContain('<#1520466000477163550>');
  });

  it('asks a low-karma worker to raise it and does not send the guide', async () => {
    mockLookup.mockResolvedValue({ kind: 'ok', profile: { username: 'some_worker', linkKarma: 5, commentKarma: 7 } });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(sent.join('\n')).toContain('12');
    expect(sent.join('\n')).not.toContain('<#1520466000477163550>');
    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'LOW_KARMA', username: 'some_worker', linkKarma: 5, commentKarma: 7 },
    );
  });

  it('re-checks a low-karma worker who comes back with more karma', async () => {
    // LOW_KARMA is not terminal on purpose.
    mockFindByChannelId.mockResolvedValue({ profileCheckStatus: 'LOW_KARMA', profileReaskCount: 3 });
    mockLookup.mockResolvedValue({ kind: 'ok', profile: { username: 'some_worker', linkKarma: 90, commentKarma: 90 } });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'PASSED', username: 'some_worker', linkKarma: 90, commentKarma: 90 },
    );
    expect(mockMarkGuideSent).toHaveBeenCalled();
  });

  it('does not call a worker banned when the checker itself is broken', async () => {
    mockLookup.mockResolvedValue({ kind: 'no_session' });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(dmSent.some((d) => d.id === WORKER)).toBe(false);
    expect(sent.join('\n')).toContain('reason:no_session');
    // Our missing session is our problem, so the approver is told.
    expect(dmSent.some((d) => d.id === REDDIT_PROFILE_APPROVAL_ADMIN_ID)).toBe(true);
  });

  it('does not spam the approver for a plain rate limit', async () => {
    mockLookup.mockResolvedValue({ kind: 'rate_limited' });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(sent.join('\n')).toContain('reason:rate_limited');
    expect(dmSent).toHaveLength(0);
    // Retryable: the worker can send the link again once Reddit lets us.
    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'UNVERIFIABLE', username: 'some_worker', linkKarma: null, commentKarma: null },
    );
  });

  it('does not call a nonexistent profile banned', async () => {
    mockLookup.mockResolvedValue({ kind: 'not_found', username: 'some_worker' });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(dmSent.some((d) => d.id === WORKER)).toBe(false);
  });
});

describe('resilience', () => {
  it('survives a closed worker DM by repeating the verdict in the ticket', async () => {
    mockLookup.mockResolvedValue({ kind: 'suspended', username: 'some_worker' });
    fetchUser.mockImplementation(async (id: string) => {
      if (id === WORKER) throw new Error('Cannot send messages to this user');
      return { send: approverSend };
    });

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    // The banned worker with DMs closed must still learn why this stopped.
    expect(sent.join('\n')).toContain('banned');
  });

  it('persists the verdict even when the approver DM fails', async () => {
    approverSend.mockRejectedValueOnce(new Error('approver has DMs closed'));

    await handleTicketProfileFlow({
      client,
      channel: makeChannel(),
      authorId: WORKER,
      content: 'https://www.reddit.com/user/some_worker',
    });

    expect(mockMarkProfileChecked).toHaveBeenCalledWith(
      'chan-1',
      { status: 'PASSED', username: 'some_worker', linkKarma: 30, commentKarma: 40 },
    );
  });

  it('does not throw when the onboarding lookup fails', async () => {
    mockFindByChannelId.mockRejectedValue(new Error('db down'));

    await expect(
      handleTicketProfileFlow({ client, channel: makeChannel(), authorId: WORKER, content: 'hi' }),
    ).resolves.toBe(false);
  });
});
