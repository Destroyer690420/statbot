import { redditSessionService } from './reddit-session.service';
import { createSerialQueue } from '../utils/serial-queue';
import { REDDIT_PROFILE_MIN_INTERVAL_MS } from '../config/constants';
import { logger } from '../utils/logger';
import type { RedditProfileSummary } from '../utils/reddit-profile-link';

/**
 * Reads a Reddit account's live state (suspended? how much karma?) for the
 * ticket profile check.
 *
 * Anonymous access is not an option. Reddit killed logged-out `.json` access
 * and hard-blocks datacenter IPs — verified 2026-09-28: an unauthenticated
 * `www.reddit.com/user/<name>/about.json` returns 403 with "You've been blocked
 * by network security." The same wall is why `reddit-check.service.ts` cannot
 * work without the vaulted spare-account session, and this service reuses that
 * same session rather than inventing a second credential.
 *
 * The hard part is not fetching — it is not lying about *why* a request
 * failed. A suspended account and a dead session cookie can both come back
 * 403, and a Cloudflare block comes back as HTML. Reporting "banned" for any
 * of those would tell a perfectly good worker to go make a new account, so
 * every verdict is anchored to an explicit marker in Reddit's own response.
 */

const FETCH_TIMEOUT_MS = 12_000;
const HOSTS = ['www.reddit.com', 'old.reddit.com'];

/**
 * Same browser UA the format check uses: Reddit gates anonymous clients by
 * UA/IP, and an authenticated request must look like the browser its session
 * came from.
 */
const SESSION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export type ProfileLookup =
  /** Live account. Not suspended. */
  | { kind: 'ok'; profile: RedditProfileSummary }
  /** Reddit explicitly says the account is suspended. */
  | { kind: 'suspended'; username: string }
  /** No such account (or shadowbanned — the two are indistinguishable). */
  | { kind: 'not_found'; username: string }
  /** No session cookie stored; the manager has not set the vault up. */
  | { kind: 'no_session' }
  /** We sent the cookie and Reddit refused it (expired/flagged). */
  | { kind: 'session_expired' }
  /** Reddit throttled us; safe to retry shortly. */
  | { kind: 'rate_limited' }
  /** Network error or an unparseable response. */
  | { kind: 'error'; message: string };

/**
 * Exact signals that mean "this account is banned", as opposed to "we could
 * not ask". `USER_BANNED` is Reddit's own reason token; the sentence form is
 * what the profile page says. Deliberately narrow: a bare /banned/ match would
 * also catch unrelated prose in a block page.
 */
function hasBanMarker(body: string): boolean {
  if (/user[_ ]?banned/i.test(body)) return true;
  if (/this account has been (suspended|banned)/i.test(body)) return true;
  if (/"(?:is_)?suspended"\s*:\s*true/i.test(body)) return true;
  return false;
}

/** The block page / generic HTML that must never be read as a verdict. */
function looksLikeHtml(body: string): boolean {
  return /^\s*<(?:!doctype|html)/i.test(body);
}

function parseSummary(username: string, data: Record<string, unknown>): RedditProfileSummary | null {
  if (!data || typeof data !== 'object') return null;
  const linkKarma = data.link_karma;
  const commentKarma = data.comment_karma;
  if (typeof linkKarma !== 'number' && typeof commentKarma !== 'number') return null;
  return {
    username: typeof data.name === 'string' && data.name ? data.name : username,
    linkKarma: typeof linkKarma === 'number' ? linkKarma : 0,
    commentKarma: typeof commentKarma === 'number' ? commentKarma : 0,
    createdUtc: typeof data.created_utc === 'number' ? data.created_utc : null,
  };
}

async function lookupOnce(username: string): Promise<ProfileLookup> {
  const cookie = await redditSessionService.loadCookie();
  if (!cookie) return { kind: 'no_session' };

  const headers: Record<string, string> = {
    'User-Agent': SESSION_USER_AGENT,
    Accept: 'application/json',
    // Secret: full spare-account Cookie header, never logged.
    Cookie: cookie,
  };

  let lastError = 'Unknown fetch error.';
  let sawSessionRejection = false;

  for (const host of HOSTS) {
    const url = `https://${host}/user/${encodeURIComponent(username)}/about.json?raw_json=1`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const body = await response.text().catch(() => '');

      if (response.ok) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          lastError = `Reddit returned an unreadable response (${response.status}).`;
          continue;
        }
        const data = (parsed as { data?: Record<string, unknown> })?.data;
        // A 200 can still describe a suspended account.
        if (data && (data.is_suspended === true || data.suspended === true)) {
          return { kind: 'suspended', username };
        }
        const summary = parseSummary(username, (data ?? {}) as Record<string, unknown>);
        if (!summary) {
          lastError = 'Could not read the Reddit profile (unexpected payload).';
          continue;
        }
        return { kind: 'ok', profile: summary };
      }

      // Non-2xx: the ban marker is checked FIRST, because a suspended account
      // and a rejected session can share a status code and the ban verdict is
      // the one that must not be downgraded to "session expired".
      if (hasBanMarker(body)) {
        return { kind: 'suspended', username };
      }
      if (looksLikeHtml(body)) {
        // Reddit's network-security wall. Not a verdict about the account.
        lastError = 'Reddit blocked the request (network security) — the spare-account session may be unusable.';
        sawSessionRejection = true;
        continue;
      }
      if (response.status === 404) {
        // No such account, or shadowbanned — the two look identical.
        return { kind: 'not_found', username };
      }
      if (response.status === 429) {
        return { kind: 'rate_limited' };
      }
      if (response.status === 401 || response.status === 403) {
        sawSessionRejection = true;
        lastError = 'Reddit rejected the stored session (expired or flagged).';
        continue;
      }
      lastError = `Reddit returned ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn('Reddit profile lookup failed', { username, host, error: lastError });
    }
  }

  if (sawSessionRejection) return { kind: 'session_expired' };
  return { kind: 'error', message: lastError };
}

/**
 * Lookups run one at a time with a minimum gap between them. Several tickets
 * can open at once, and they would otherwise hit the same spare account
 * simultaneously and earn a 429 (or, worse, a flag).
 */
const enqueueLookup = createSerialQueue();
let lastLookupAt = 0;

function waitForGap(): Promise<void> {
  const now = Date.now();
  const waitMs = lastLookupAt + REDDIT_PROFILE_MIN_INTERVAL_MS - now;
  if (waitMs <= 0) {
    lastLookupAt = now;
    return Promise.resolve();
  }
  lastLookupAt += waitMs;
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

/** Test seam: resets the inter-lookup pacing state. */
export function __resetProfileLookupPacing(): void {
  lastLookupAt = 0;
}

export async function lookupRedditProfile(username: string): Promise<ProfileLookup> {
  return enqueueLookup(async () => {
    await waitForGap();
    const result = await lookupOnce(username);
    logger.info('Reddit profile lookup', { username, kind: result.kind });
    return result;
  });
}

/** Short, worker-safe explanation for the in-ticket "could not verify" nudge. */
export function describeLookupFailure(result: Extract<ProfileLookup, { kind: 'no_session' | 'session_expired' | 'rate_limited' | 'error' | 'not_found' }>): string {
  switch (result.kind) {
    case 'no_session':
      return 'the reddit checker is not set up yet';
    case 'session_expired':
      return 'the reddit checker session expired — an admin has been notified';
    case 'rate_limited':
      return 'reddit is rate limiting me';
    case 'not_found':
      return 'that reddit profile does not exist';
    case 'error':
      return 'reddit did not answer';
  }
}
