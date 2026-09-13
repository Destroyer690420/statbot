import { logger } from '../utils/logger';
import { compareRedditFormat, FormatCheckStatus } from '../utils/reddit-format';
import { redditSessionService } from './reddit-session.service';
import { TaskType } from '../types';

export interface RedditPostSnapshot {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  deleted: boolean;
}

export interface FormatCheckOutcome {
  status: FormatCheckStatus;
  expectedParas: number;
  actualParas: number;
  titleMatch: boolean;
  error?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const HOSTS = ['www.reddit.com', 'old.reddit.com'];
/**
 * Browser UA for the authed fetch. Reddit gates anonymous clients by UA/IP;
 * an authenticated request must look like the browser the session came from.
 */
const SESSION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function normalizeRedditUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\/.+/i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\/\/(www|old|new|sh)\./, '//www.');
  return normalized.split(/[?#]/)[0].replace(/\/+$/, '');
}

function toJsonUrl(normalized: string, host: string): string {
  const viaHost = normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`);
  return `${viaHost}/.json?raw_json=1`;
}

/** No Reddit session cookie stored — manager setup pending. */
export class RedditSessionRequiredError extends Error {
  constructor() {
    super('No Reddit session configured. Paste the spare-account cookie in dashboard Settings.');
    this.name = 'RedditSessionRequiredError';
  }
}

/** Cookie was sent but Reddit rejected it (401/403) — repaste needed. */
export class RedditSessionExpiredError extends Error {
  constructor() {
    super('Reddit rejected the stored session (expired or flagged). Repaste the spare-account cookie in dashboard Settings.');
    this.name = 'RedditSessionExpiredError';
  }
}

/**
 * Server-side fetch of a Reddit post's raw title/selftext via public .json,
 * authenticated with the spare account's login cookie.
 *
 * Background: Reddit killed anonymous .json access (www -> 403 for any
 * client, old -> login gate; datacenter IPs are hard-blocked). Every fetch
 * therefore requires the vault session; without it we fail fast with
 * NO_SESSION instead of a misleading FETCH_ERROR.
 */
export async function fetchRedditPost(redditUrl: string): Promise<RedditPostSnapshot> {
  const normalized = normalizeRedditUrl(redditUrl);
  if (!normalized) throw new Error('Not a Reddit URL.');

  const cookie = await redditSessionService.loadCookie();
  if (!cookie) throw new RedditSessionRequiredError();

  let lastError = 'Unknown fetch error.';
  for (const host of HOSTS) {
    try {
      const response = await fetch(toJsonUrl(normalized, host), {
        headers: {
          'User-Agent': SESSION_USER_AGENT,
          Accept: 'application/json',
          // Secret: full spare-account Cookie header, never logged.
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 404) {
        lastError = 'Post not found (404 — it may be too new, deleted, or private).';
        continue;
      }
      if (response.status === 429) {
        lastError = 'Reddit rate-limited the check (429). Use Recheck in a minute.';
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        // Same cookie on both hosts — retrying the other host is pointless.
        throw new RedditSessionExpiredError();
      }
      if (!response.ok) {
        lastError = `Reddit returned ${response.status}.`;
        continue;
      }
      const data = (await response.json()) as unknown[];
      const post = (data as any[])?.[0]?.data?.children?.[0]?.data;
      if (!post) {
        lastError = 'Could not parse the Reddit post (may be removed or private).';
        continue;
      }
      const title = String(post.title ?? '');
      const selftext = String(post.selftext ?? '');
      const author = String(post.author ?? '');
      const subreddit = String(post.subreddit ?? '');
      const deleted =
        title.trim() === '[deleted]' ||
        title.trim() === '[removed]' ||
        selftext.trim() === '[deleted]' ||
        selftext.trim() === '[removed]' ||
        author.trim() === '[deleted]';
      return { title, selftext, author, subreddit, deleted };
    } catch (error) {
        // Session verdicts are final — never downgrade to a retried host.
        if (error instanceof RedditSessionExpiredError) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn('Reddit format-check fetch failed', { url: redditUrl, host, error: lastError });
      }
  }
  throw new Error(lastError);
}

/**
 * Live snapshot for the dashboard diff modal (server-side, authed).
 * Throws RedditSessionRequiredError / RedditSessionExpiredError / Error
 * — the route maps each to the matching response.
 */
export async function fetchLiveSnapshot(redditUrl: string): Promise<RedditPostSnapshot> {
  return fetchRedditPost(redditUrl);
}

export async function checkPostFormat(args: {
  taskType: TaskType | string;
  expectedTitle: string | null;
  expectedContent: string | null;
  redditUrl: string;
}): Promise<FormatCheckOutcome> {
  if (args.taskType !== TaskType.POST) {
    return { status: 'SKIPPED', expectedParas: 0, actualParas: 0, titleMatch: true };
  }
  let snapshot: RedditPostSnapshot;
  try {
    snapshot = await fetchRedditPost(args.redditUrl);
  } catch (error) {
    if (error instanceof RedditSessionRequiredError) {
      return { status: 'NO_SESSION', expectedParas: 0, actualParas: 0, titleMatch: false, error: error.message };
    }
    if (error instanceof RedditSessionExpiredError) {
      return { status: 'SESSION_EXPIRED', expectedParas: 0, actualParas: 0, titleMatch: false, error: error.message };
    }
    return {
      status: 'FETCH_ERROR',
      expectedParas: 0,
      actualParas: 0,
      titleMatch: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (snapshot.deleted) {
    return { status: 'DELETED', expectedParas: 0, actualParas: 0, titleMatch: false };
  }
  const compared = compareRedditFormat({
    expectedTitle: args.expectedTitle,
    expectedContent: args.expectedContent,
    actualTitle: snapshot.title,
    actualContent: snapshot.selftext,
  });
  return {
    status: compared.status,
    expectedParas: compared.expectedParas,
    actualParas: compared.actualParas,
    titleMatch: compared.titleMatch,
  };
}
