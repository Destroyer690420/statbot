/**
 * Server-side NSFW screen (`over18` from `/r/<sub>/about.json`):
 * fetch fail-open, permanent cache, auto-block wiring, and the
 * fire-and-forget trigger from the burst-validation hot path.
 *
 * Mock note: same as automation-name-quarantine.test.ts — burst.service
 * pulls logger (→ env.ts, which exits without a full environment), so the
 * env-touching modules are mocked and only the real orchestration runs.
 * `global.fetch` is stubbed per test (no real Reddit calls, ever).
 */
import { validateInputs } from '../services/automation/burst.service';
import {
  fetchSubredditOver18,
  checkAndAutoBlockNsfw,
  clearSubredditNsfwCache,
} from '../services/automation/subreddit-nsfw.service';
import { automationRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';
import type { BurstTaskInput } from '../services/automation/burst.service';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../utils/permissions', () => ({
  getAdminOrManagerIds: jest.fn(() => []),
  getAllAdminIds: jest.fn(() => []),
  isAdminOrManager: jest.fn(() => false),
}));
jest.mock('../database/repositories', () => ({
  automationRepository: {
    listBlocked: jest.fn(),
    listSeenSubreddits: jest.fn(),
    listCycleLogs: jest.fn(),
    listAllowed: jest.fn(),
    logTask: jest.fn(),
    addBlocked: jest.fn(),
    isBlocked: jest.fn(),
  },
  outreachRepository: {},
  taskRepository: {},
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));

const repo = automationRepository as unknown as Record<string, jest.Mock>;
const auditMock = auditLogService.log as jest.Mock;

const realFetch = global.fetch;

function aboutResponse(over18: unknown) {
  return { ok: true, status: 200, json: async () => ({ data: { over18 } }) };
}

function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

function mockFetch(impl: (...args: unknown[]) => unknown) {
  global.fetch = impl as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearSubredditNsfwCache();
  global.fetch = realFetch;
  repo.listBlocked.mockResolvedValue([]);
  repo.listSeenSubreddits.mockResolvedValue([]);
  repo.listCycleLogs.mockResolvedValue([]);
  repo.listAllowed.mockResolvedValue([]);
  repo.logTask.mockResolvedValue({});
  repo.addBlocked.mockResolvedValue({});
  repo.isBlocked.mockResolvedValue(false);
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('fetchSubredditOver18', () => {
  it('returns true for an over18 sub (www host, about.json shape)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(aboutResponse(true));
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('SomeNsfw')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://www.reddit.com/r/somensfw/about.json?raw_json=1',
    );
  });

  it('requests the normalized subreddit path', async () => {
    const fetchMock = jest.fn().mockResolvedValue(aboutResponse(false));
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('r/Quiet_Meadow')).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://www.reddit.com/r/quiet_meadow/about.json?raw_json=1',
    );
  });

  it('returns false for a safe sub (no block downstream)', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(false)));
    expect(await fetchSubredditOver18('cats')).toBe(false);
  });

  it('fails open (null) on 404 from both hosts', async () => {
    const fetchMock = jest.fn().mockResolvedValue(notFoundResponse());
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('nosuchsubhere')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('www.reddit.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('old.reddit.com');
  });

  it('retries the old host when www throws, and honors its verdict', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(aboutResponse(true));
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('retrycase')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails open (null) on malformed payloads and non-boolean flags', async () => {
    const payloads = [{}, { data: {} }, { data: { over18: 'yes' } }, [], null, { data: null }];
    for (const payload of payloads) {
      clearSubredditNsfwCache();
      mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload }));
      expect(await fetchSubredditOver18('weirdshapesub')).toBeNull();
    }
    clearSubredditNsfwCache();
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
    expect(await fetchSubredditOver18('weirdshapesub')).toBeNull();
  });

  it('returns null without fetching for unreadable subreddit names', async () => {
    const fetchMock = jest.fn();
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('   ')).toBeNull();
    expect(await fetchSubredditOver18('two words!!')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws, even when fetch itself blows up synchronously', async () => {
    mockFetch(() => { throw new Error('sync boom'); });
    expect(await fetchSubredditOver18('syncboom')).toBeNull();
  });
});

describe('fetchSubredditOver18 cache', () => {
  it('fetches once: a second lookup serves the cached value', async () => {
    const fetchMock = jest.fn().mockResolvedValue(aboutResponse(true));
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('cachedsub')).toBe(true);
    expect(await fetchSubredditOver18('CachedSub')).toBe(true);
    expect(await fetchSubredditOver18('r/cachedsub')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches fail-open nulls too (no re-fetch)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(notFoundResponse());
    mockFetch(fetchMock);
    expect(await fetchSubredditOver18('gonersub')).toBeNull();
    expect(await fetchSubredditOver18('gonersub')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // www + old, once
  });

  it('shares one in-flight fetch between concurrent lookups', async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = jest.fn().mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    mockFetch(fetchMock);
    const pending = Promise.all([
      fetchSubredditOver18('racingsub'),
      fetchSubredditOver18('RacingSub'),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    // Both lookups attached to the same in-flight fetch: still one call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(aboutResponse(true));
    const [a, b] = await pending;
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});

describe('checkAndAutoBlockNsfw', () => {
  it('blocks with auto-content:nsfw + audit when over18 is true', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(true)));
    const out = await checkAndAutoBlockNsfw('brandnewnsfwsub', new Set());
    expect(out).not.toBeNull();
    expect(out!.disposition).toBe('blocked');
    expect(out!.blocked).toBe(true);
    expect(repo.addBlocked).toHaveBeenCalledTimes(1);
    expect(repo.addBlocked).toHaveBeenCalledWith('brandnewnsfwsub', 'auto-content:nsfw', 'system:nsfw-screen');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(out!.notice).toContain('r/brandnewnsfwsub');
  });

  it('does nothing when over18 is false', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(false)));
    expect(await checkAndAutoBlockNsfw('safesubhere', new Set())).toBeNull();
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('does nothing (fail open) when the fetch is inconclusive', async () => {
    mockFetch(jest.fn().mockResolvedValue(notFoundResponse()));
    expect(await checkAndAutoBlockNsfw('privatesubhere', new Set())).toBeNull();
    expect(repo.addBlocked).not.toHaveBeenCalled();
  });

  it('respects the already-blocked guard (two-tab race: loser stays quiet)', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(true)));
    repo.isBlocked.mockResolvedValue(true);
    const out = await checkAndAutoBlockNsfw('racedsub', new Set());
    expect(out!.disposition).toBe('already-blocked');
    expect(repo.addBlocked).not.toHaveBeenCalled();
  });

  it('respects the seen-sub guard (never overrides digest review)', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(true)));
    const out = await checkAndAutoBlockNsfw('oldreviewedsub', new Set(['oldreviewedsub']));
    expect(out!.disposition).toBe('seen-skipped');
    expect(repo.addBlocked).not.toHaveBeenCalled();
  });

  it('respects dry-run (shadow mode logs WOULD_BLOCK, blocks nothing)', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(true)));
    const out = await checkAndAutoBlockNsfw('shadowsub', new Set(), { dryRun: true });
    expect(out!.disposition).toBe('dry-run');
    expect(out!.outcome).toContain('WOULD_BLOCK');
    expect(out!.outcome).toContain('auto-content:nsfw');
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('returns null without fetching for unreadable names', async () => {
    const fetchMock = jest.fn();
    mockFetch(fetchMock);
    expect(await checkAndAutoBlockNsfw('   ', new Set())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.addBlocked).not.toHaveBeenCalled();
  });

  it('never rejects, even when the block write fails', async () => {
    mockFetch(jest.fn().mockResolvedValue(aboutResponse(true)));
    repo.addBlocked.mockRejectedValueOnce(new Error('db down'));
    await expect(checkAndAutoBlockNsfw('dbdownsub', new Set())).resolves.toBeNull();
  });
});

describe('burst trigger is genuinely fire-and-forget', () => {
  function burstInput(subTaskId: string, subreddit: string | null, title: string | null = 'a normal title here'): BurstTaskInput {
    return { subTaskId, type: 'post', subreddit, title };
  }

  it('validateInputs returns before a slow over18 fetch settles; the block lands after', async () => {
    let settleFetch!: (value: unknown) => void;
    let fetchSettled = false;
    const fetchMock = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          settleFetch = (value: unknown) => {
            fetchSettled = true;
            resolve(value);
          };
        }),
    );
    mockFetch(fetchMock);

    const out = await validateInputs([burstInput('9001', 'quietmeadowfield')], 'c-nsfw-timing');
    // The hot path never waited: eligible result in hand, fetch still pending.
    expect(fetchSettled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://www.reddit.com/r/quietmeadowfield/about.json?raw_json=1',
    );
    expect(out.eligible).toHaveLength(1);

    // The background check completes after the fetch resolves: block lands.
    settleFetch(aboutResponse(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.addBlocked).toHaveBeenCalledWith(
      'quietmeadowfield',
      'auto-content:nsfw',
      'system:nsfw-screen',
    );
  });

  it('does not fire for blocked, seen, comment, or unreadable-sub tasks', async () => {
    const fetchMock = jest.fn().mockResolvedValue(aboutResponse(true));
    mockFetch(fetchMock);
    repo.listBlocked.mockResolvedValue([{ subreddit: 'blockedsub' }]);
    repo.listSeenSubreddits.mockResolvedValue(['seensub']);
    const out = await validateInputs(
      [
        burstInput('9101', 'blockedsub'),
        burstInput('9102', 'seensub'),
        { subTaskId: '9103', type: 'comment', subreddit: 'freshcomment', title: 'x' },
        burstInput('9104', null),
      ],
      'c-nsfw-gates',
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.addBlocked).not.toHaveBeenCalled();
    // Seen subs stay eligible (seen only gates screening, never eligibility).
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0].subreddit).toBe('seensub');
  });
});
