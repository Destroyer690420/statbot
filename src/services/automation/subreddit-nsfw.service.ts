/**
 * Server-side NSFW screen: Reddit's own subreddit-level `over18` flag.
 *
 * Unlike sex/vape content — which only exists once a drawer is open
 * mid-accept — a subreddit's `over18` status comes from Reddit directly and
 * is knowable the moment the subreddit name is known: at scan time, before
 * any accept attempt. This whole feature lives server-side; no
 * browser/userscript change.
 *
 * Different endpoint, different payload, don't conflate: this reads the
 * SUBREDDIT-level `over18` boolean from `/r/<sub>/about.json`
 * (`{ data: { over18 } }`). `utils/reddit-post-signals.ts` reads the
 * POST-level `over_18` field off individual post listings — unrelated.
 *
 * Reachability: reddit.com is fetched directly from the server (unlike
 * GoPartTime, which Vercel hard-blocks from datacenter IPs — Decision 15).
 * The fetch mirrors `reddit-check.service.ts` (`HOSTS`, `FETCH_TIMEOUT_MS`,
 * browser UA) but stays anonymous (no vault cookie): about.json for public
 * subs needs none, and the screen must work with no spare-account session.
 * That module is deliberately NOT imported here — it pulls the logger (→
 * env.ts, which exits without a full environment). Like
 * `content-block.service` and `validator.service`, this module stays
 * logger-free so unit tests never touch env.
 *
 * Fail-open: ANY inconclusive fetch (404, timeout, private/quarantined/
 * banned subreddit, malformed payload, non-boolean flag) returns null and
 * never blocks. Only a strict `over18 === true` blocks.
 *
 * Caching: a subreddit's status is fetched ONCE per process, ever — `over18`
 * essentially never changes for an existing subreddit, so unlike the
 * blocked-list cache this needs no TTL. In-flight promises are cached too,
 * so two near-simultaneous lookups for the same brand-new subreddit share
 * one fetch instead of firing two.
 *
 * THE ACCEPTED TRADE-OFF (stated plainly, not hidden): the fetch takes on
 * the order of ~100–400ms and the auto-block only lands once it resolves,
 * so there is a narrow window where the very first post from a genuinely
 * brand-new NSFW subreddit could be accepted before the block is in place —
 * the exact same narrow race `content-block.service.ts` already documents
 * and accepts for the sex/vape path. This is strictly better than today
 * (no NSFW check at all: every such post gets through), and every
 * subsequent post from that subreddit is covered immediately afterward by
 * the ordinary blocked-list check. Closing the race would mean a
 * browser-side inline gate (like the sex/vape Tier-1): real additional work
 * for a narrow, rarely-hit, already-improved-over-baseline case. If it
 * turns out to matter in practice, that's a clearly separate follow-up.
 */
import { normalizeSubreddit } from './subreddit';
import { handleAutoBlockReport, AutoBlockOutcome } from './content-block.service';

// Same values/shape as `reddit-check.service.ts` (HOSTS, FETCH_TIMEOUT_MS,
// browser UA) — duplicated, not imported, to keep this module env-free.
const FETCH_TIMEOUT_MS = 12_000;
const HOSTS = ['www.reddit.com', 'old.reddit.com'];
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Resolved statuses, keyed by normalized subreddit. Permanent, no TTL. */
const resolvedCache = new Map<string, boolean | null>();
/** In-flight fetches, keyed by normalized subreddit (shared, not re-fired). */
const inflightCache = new Map<string, Promise<boolean | null>>();

async function fetchOver18Uncached(normalized: string): Promise<boolean | null> {
  for (const host of HOSTS) {
    try {
      const response = await fetch(`https://${host}/r/${normalized}/about.json?raw_json=1`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as unknown;
      const over18 = (payload as { data?: { over18?: unknown } } | null)?.data?.over18;
      if (typeof over18 !== 'boolean') continue;
      return over18;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The subreddit's own `over18` flag, or null when inconclusive (fail open —
 * never throws, never returns anything but `boolean | null`). Unreadable
 * subreddit names return null without fetching. Results (including nulls)
 * are cached permanently per process.
 */
export async function fetchSubredditOver18(subreddit: string): Promise<boolean | null> {
  const normalized = normalizeSubreddit(subreddit);
  if (!normalized) return null;
  const hit = resolvedCache.get(normalized);
  if (hit !== undefined) return hit;
  const inflight = inflightCache.get(normalized);
  if (inflight) return inflight;
  const pending = fetchOver18Uncached(normalized).then(
    (value) => {
      resolvedCache.set(normalized, value);
      inflightCache.delete(normalized);
      return value;
    },
    () => {
      resolvedCache.set(normalized, null);
      inflightCache.delete(normalized);
      return null;
    },
  );
  inflightCache.set(normalized, pending);
  return pending;
}

/**
 * Fire-and-forget NSFW auto-block for one newly-seen subreddit. Fetches
 * `over18` through the permanent cache; on strict `true` calls the exact
 * same `handleAutoBlockReport` the sex/vape Tier-1 path uses (blocking, the
 * audit row, the dry-run check, the already-blocked/seen-skipped guards all
 * come for free, unchanged — actor `system:nsfw-screen`). On `false`/`null`:
 * nothing — not blocked, not an error.
 *
 * Never throws, never rejects (callers fire it without awaiting). Returns
 * the block outcome when a block was attempted, null otherwise — primarily
 * for tests; hot-path callers ignore the return.
 */
export async function checkAndAutoBlockNsfw(
  subreddit: string,
  seenSubs?: ReadonlySet<string>,
  opts: { dryRun?: boolean } = {},
): Promise<AutoBlockOutcome | null> {
  try {
    const normalized = normalizeSubreddit(subreddit);
    if (!normalized) return null;
    const over18 = await fetchSubredditOver18(normalized);
    if (over18 !== true) return null;
    return await handleAutoBlockReport(
      { subreddit: normalized, signal: 'nsfw' },
      {
        dryRun: opts.dryRun,
        seenSubs,
        actorId: 'system:nsfw-screen',
        source: 'subreddit over18 screen at scan time',
      },
    );
  } catch {
    return null;
  }
}

/** Test hook (also a manual reset). Clears resolved + in-flight entries. */
export function clearSubredditNsfwCache(): void {
  resolvedCache.clear();
  inflightCache.clear();
}
