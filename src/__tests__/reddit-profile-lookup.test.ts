/**
 * The verdict logic in the Reddit profile lookup.
 *
 * The point of these tests is the failure mode that would actually hurt
 * production: telling a healthy worker their account is banned. A suspended
 * account, a dead session cookie and Reddit's network-security block can all
 * come back as 403, so each of those has to land on a different verdict.
 */

const mockLoadCookie = jest.fn<Promise<string | null>, []>();
const mockFetch = jest.fn();

jest.mock('../services/reddit-session.service', () => ({
  redditSessionService: { loadCookie: () => mockLoadCookie() },
}));

// The lookup pulls logger -> env (process.exit without a full env), so stub
// the logger; the unit under test never needs real logging. Same approach as
// reddit-check.test.ts.
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  __resetProfileLookupPacing,
  describeLookupFailure,
  lookupRedditProfile,
} from '../services/reddit-profile-check.service';

type FetchInit = { headers: Record<string, string> };

function respond(status: number, body: string): void {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  });
}

const SUSPENDED_BODY = JSON.stringify({ reason: 'USER_BANNED', error: 404, message: 'USER_BANNED' });
const CLOUDFLARE_BODY =
  '<!doctype html><html><body><div>You&#39;ve been blocked by network security.</div></body></html>';

const OK_BODY = JSON.stringify({
  data: { name: 'some_worker', link_karma: 30, comment_karma: 40, created_utc: 1600000000 },
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetProfileLookupPacing();
  mockLoadCookie.mockResolvedValue('reddit_session=abc; token=def');
  // The service calls the global fetch; without this it reaches the real
  // Reddit and every "verdict" here would be the network-security block.
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
});

describe('lookupRedditProfile verdicts', () => {
  it('reads karma off a live account', async () => {
    respond(200, OK_BODY);

    const result = await lookupRedditProfile('some_worker');

    expect(result).toEqual({
      kind: 'ok',
      profile: { username: 'some_worker', linkKarma: 30, commentKarma: 40, createdUtc: 1600000000 },
    });
  });

  it('calls a suspended account BANNED on Reddit\'s own reason token', async () => {
    respond(404, SUSPENDED_BODY);

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'suspended', username: 'some_worker' });
  });

  it('calls a suspended account BANNED even when the status is 403', async () => {
    // 403 is also what a rejected session looks like, so the ban marker in
    // the body has to win. Getting this backwards would tell a healthy
    // worker to make a new account.
    respond(403, SUSPENDED_BODY);

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'suspended', username: 'some_worker' });
  });

  it('calls a suspended account BANNED from a 200 that flags it', async () => {
    respond(200, JSON.stringify({ data: { name: 'some_worker', is_suspended: true, link_karma: 0 } }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'suspended', username: 'some_worker' });
  });

  it('reads the "this account has been suspended" sentence form', async () => {
    respond(404, JSON.stringify({ message: 'This account has been suspended.' }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'suspended', username: 'some_worker' });
  });

  it('does NOT call a worker banned when the network-security block is returned', async () => {
    // This is the exact wall Reddit serves logged-out/datacenter clients. It
    // is a statement about US, not about the worker's account.
    respond(403, CLOUDFLARE_BODY);

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'session_expired' });
  });

  it('does not mistake unrelated prose mentioning bans for a verdict', async () => {
    respond(404, JSON.stringify({ message: 'no such profile', note: 'banned subreddits list unavailable' }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'not_found', username: 'some_worker' });
  });

  it('reports not_found for a 404 with no ban marker', async () => {
    respond(404, JSON.stringify({ error: 404, message: 'Not Found' }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'not_found', username: 'some_worker' });
  });

  it('reports a dead session without claiming the worker is banned', async () => {
    respond(401, JSON.stringify({ error: 401 }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'session_expired' });
  });

  it('reports no_session when the vault has nothing stored', async () => {
    mockLoadCookie.mockResolvedValue(null);

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'no_session' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a 429 as rate_limited so the worker is asked to retry', async () => {
    respond(429, JSON.stringify({ error: 429 }));

    expect(await lookupRedditProfile('some_worker')).toEqual({ kind: 'rate_limited' });
  });

  it('sends the vaulted cookie and a browser UA, and never leaks either into the URL', async () => {
    respond(200, OK_BODY);

    await lookupRedditProfile('some_worker');

    const [url, init] = mockFetch.mock.calls[0] as [string, FetchInit];
    expect(url).toContain('/user/some_worker/about.json');
    expect(url).not.toContain('reddit_session');
    expect(init.headers.Cookie).toBe('reddit_session=abc; token=def');
    expect(init.headers['User-Agent']).toMatch(/Mozilla/);
  });

  it('escapes the username so it cannot be used to redirect the lookup', async () => {
    respond(200, OK_BODY);

    await lookupRedditProfile('../../api/v1/admin');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('..%2F..%2Fapi%2Fv1%2Fadmin');
    expect(url).not.toContain('/api/v1/admin');
  });

  it('falls back to the second host when the first one fails', async () => {
    respond(403, CLOUDFLARE_BODY);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => CLOUDFLARE_BODY,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => OK_BODY,
    });

    const result = await lookupRedditProfile('some_worker');

    expect(result.kind).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns an error rather than throwing when the network is down', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    const result = await lookupRedditProfile('some_worker');

    expect(result.kind).toBe('error');
  });

  it('does not report ok on a 200 whose body is not a profile', async () => {
    respond(200, JSON.stringify({ data: { unrelated: true } }));

    const result = await lookupRedditProfile('some_worker');

    expect(result.kind).toBe('error');
  });
});

describe('pacing', () => {
  it('serialises concurrent lookups and spaces them out', async () => {
    respond(200, OK_BODY);
    const started: number[] = [];
    mockFetch.mockImplementation(async () => {
      started.push(Date.now());
      return { ok: true, status: 200, text: async () => OK_BODY };
    });

    await Promise.all([lookupRedditProfile('worker_one'), lookupRedditProfile('worker_two')]);

    // Both ran, and neither started at the same instant: firing simultaneous
    // lookups at the spare account is what earns a 429.
    expect(started).toHaveLength(2);
    expect(new Set(started).size).toBe(2);
  });
});

describe('describeLookupFailure', () => {
  it('blames the setup, not the worker, when our own session is the problem', () => {
    expect(describeLookupFailure({ kind: 'no_session' })).toMatch(/not set up/i);
    expect(describeLookupFailure({ kind: 'session_expired' })).toMatch(/session expired/i);
  });

  it('tells the worker to retry when we were throttled', () => {
    expect(describeLookupFailure({ kind: 'rate_limited' })).toMatch(/rate limiting/i);
  });

  it('names a nonexistent profile rather than calling it banned', () => {
    expect(describeLookupFailure({ kind: 'not_found', username: 'some_worker' })).toMatch(/does not exist/i);
  });
});
