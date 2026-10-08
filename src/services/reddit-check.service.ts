import { logger } from '../utils/logger';
import { compareRedditFormat, FormatCheckStatus } from '../utils/reddit-format';
import { summarizeRawPost, classifyRemoval, RemovalState } from '../utils/reddit-post-signals';
import { redditSessionService } from './reddit-session.service';
import { TaskType } from '../types';

export interface RedditPostSnapshot {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  deleted: boolean;
  /**
   * Precise removal state (Phase 1). `deleted` stays the single backward-
   * compatible flag (`state !== 'LIVE'`) so every existing consumer keeps its
   * exact current behavior; new consumers read `removalState`.
   */
  removalState: RemovalState;
  /** Raw `removed_by_category` token (null when the post stands). */
  removedByCategory: string | null;
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

/**
 * Resolves a per-host base URL to its .json endpoint.
 * (Share links are resolved separately via resolveShareUrl.)
 */
function toJsonUrl(canonical: string): string {
  return `${canonical}/.json?raw_json=1`;
}

/**
 * Mobile share links look like /r/<sub>/s/<id> and only resolve
 * client-side — appending /.json returns the HTML app shell instead of
 * post JSON. Detect them so we can follow the redirect first.
 */
export function isShareUrl(normalized: string): boolean {
  return /\/s\/[^/?#]+\/?$/i.test(normalized);
}

/**
 * Follows a share link to its canonical permalink (server follows the 302
 * chain; response.url is the final post URL). Auth statuses propagate as
 * session errors; anything else becomes a plain Error for the host loop.
 *
 * NOTE: the redirect chain is the source of truth, not the landing status
 * — Reddit answers some share landings with 404 HTML while the resolved
 * permalink's .json works fine. So: if the final URL is a post permalink,
 * return it regardless of status; only otherwise interpret the status.
 */
export async function resolveShareUrl(
  shareUrl: string,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch(shareUrl, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new RedditSessionExpiredError();
  await res.text().catch(() => '');
  const canonical = res.url.split(/[?#]/)[0].replace(/\/+$/, '');
  if (/^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\/r\//i.test(canonical)) {
    return canonical;
  }
  if (res.status === 404) {
    throw new Error('Share link did not resolve (404 — ask the worker for the full post link).');
  }
  throw new Error(`Share link did not resolve (Reddit returned ${res.status} — ask the worker for the full post link).`);
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
  const headers: Record<string, string> = {
    'User-Agent': SESSION_USER_AGENT,
    Accept: 'application/json',
    // Secret: full spare-account Cookie header, never logged.
    Cookie: cookie,
  };
  for (const host of HOSTS) {
    try {
      const hostBase = normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`);
      // Share links (/s/<id>) serve HTML even with auth — resolve to the
      // canonical permalink first, per host.
      const target = isShareUrl(hostBase) ? await resolveShareUrl(hostBase, headers) : hostBase;
      const response = await fetch(toJsonUrl(target), {
        headers,
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
      // Precise state from the probed signal set (docs/REMOVAL_SIGNALS.md):
      // exact `[deleted]`/`[removed]` markers, the `[ Removed by moderator ]`
      // title form, and the `removed_by_category` token. `deleted` keeps its
      // historical meaning (anything not LIVE) for existing consumers.
      // Three deliberate verdict fixes vs the old exact-match block:
      // `[deleted]` author with fully standing content → LIVE (account gone,
      // post visible); mod-title variant with empty selftext → removed;
      // mod-approved (`approved:true`) with stale markers → LIVE.
      const signals = summarizeRawPost(post);
      let removalState: RemovalState;
      if (signals) {
        removalState = classifyRemoval(signals);
      } else {
        // Malformed shape (no name/subreddit): keep the legacy exact check
        // so behavior here cannot change under us.
        const legacyDeleted =
          title.trim() === '[deleted]' ||
          title.trim() === '[removed]' ||
          selftext.trim() === '[deleted]' ||
          selftext.trim() === '[removed]' ||
          author.trim() === '[deleted]';
        removalState = legacyDeleted ? 'DELETED_BY_USER' : 'LIVE';
      }
      const removedByCategory = signals?.removedByCategory ?? null;
      const deleted = removalState !== 'LIVE';
      return { title, selftext, author, subreddit, deleted, removalState, removedByCategory };
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
