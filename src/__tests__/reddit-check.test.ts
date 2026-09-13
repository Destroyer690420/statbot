import {
  checkPostFormat,
  isShareUrl,
  resolveShareUrl,
} from '../services/reddit-check.service';
import { redditSessionService } from '../services/reddit-session.service';

jest.mock('../services/reddit-session.service', () => ({
  redditSessionService: { loadCookie: jest.fn() },
}));

// reddit-check.service pulls logger -> env (process.exit without full env),
// so stub the logger; the unit under test never needs real logging.
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedLoad = redditSessionService.loadCookie as jest.Mock;

function postJson(title: string, selftext: string) {
  return [
    {
      data: {
        children: [{ data: { title, selftext, author: 'someone', subreddit: 'Homesteading' } }],
      },
    },
  ];
}

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, url: '', json: async () => payload, text: async () => '' };
}

describe('isShareUrl', () => {
  it('detects mobile /s/ links', () => {
    expect(isShareUrl('https://www.reddit.com/r/Homesteading/s/zOepl3TQmZ')).toBe(true);
  });
  it('ignores canonical permalinks', () => {
    expect(isShareUrl('https://www.reddit.com/r/Eve/comments/1qw14x3/title/')).toBe(false);
  });
});

describe('checkPostFormat with mocked fetch', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    mockedLoad.mockResolvedValue('edgebucket=x; reddit_session=y');
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('resolves a share link then compares MATCH', async () => {
    const canonical = 'https://www.reddit.com/r/Homesteading/comments/1wfojy8/title/';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, url: canonical, text: async () => '<html>' })
      .mockResolvedValueOnce(jsonResponse(postJson('T', 'para one\n\npara two')));
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'para one\n\npara two',
      redditUrl: 'https://www.reddit.com/r/Homesteading/s/zOepl3TQmZ',
    });
    expect(r.status).toBe('MATCH');
    const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls[1]).toBe(canonical + '.json?raw_json=1');
  });

  it('fetches canonical links directly (single call)', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(postJson('T', 'only')));
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'only',
      redditUrl: 'https://www.reddit.com/r/Eve/comments/1qw14x3/title/',
    });
    expect(r.status).toBe('MATCH');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('maps an unresolvable share link to FETCH_ERROR', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, url: '', text: async () => '' });
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'x',
      redditUrl: 'https://www.reddit.com/r/Homesteading/s/deadlink1',
    });
    // www 404s the resolve, old host retries the same way -> FETCH_ERROR mentioning share links.
    expect(r.status).toBe('FETCH_ERROR');
    expect(r.error || '').toMatch(/Share link/i);
  });

  it('maps 403 during resolve to SESSION_EXPIRED', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 403, url: '', text: async () => '' });
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'x',
      redditUrl: 'https://www.reddit.com/r/Homesteading/s/zOepl3TQmZ',
    });
    expect(r.status).toBe('SESSION_EXPIRED');
  });

  it('returns NO_SESSION when no cookie is stored', async () => {
    mockedLoad.mockResolvedValue(null);
    global.fetch = jest.fn();
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'x',
      redditUrl: 'https://www.reddit.com/r/Eve/comments/1qw14x3/title/',
    });
    expect(r.status).toBe('NO_SESSION');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('resolveShareUrl rejects non-post landing pages', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, url: 'https://www.reddit.com/login/', text: async () => '' });
    await expect(
      resolveShareUrl('https://www.reddit.com/r/Homesteading/s/zOepl3TQmZ', { Cookie: 'x' }),
    ).rejects.toThrow(/full post link/i);
  });

  it('accepts a resolved permalink even when the landing status is 404', async () => {
    const canonical = 'https://www.reddit.com/r/Homesteading/comments/1wf0jy8/is_heating_a_greenhouse_with_a_mini_split_overkill/';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, url: canonical + '?share_id=x', text: async () => '<html>' })
      .mockResolvedValueOnce(jsonResponse(postJson('T', 'para one\n\npara two')));
    const r = await checkPostFormat({
      taskType: 'POST',
      expectedTitle: 'T',
      expectedContent: 'para one\n\npara two',
      redditUrl: 'https://www.reddit.com/r/Homesteading/s/zOepl3TQmZ',
    });
    expect(r.status).toBe('MATCH');
    const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls[1]).toBe(canonical + '.json?raw_json=1');
  });
});
