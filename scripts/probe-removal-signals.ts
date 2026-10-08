// Phase 0 probe: what does the vaulted spare-account session actually see for
// each real-world post state? Read-only authed GETs against Reddit's `.json`
// (the same path `fetchRedditPost` uses), plus share-link resolution.
//
// Prints ONLY http statuses, resolved URLs and post-signal summaries — never
// the cookie, never the DATABASE_URL. Run from the host repo:
//
//   DBURL="$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')"
//   DATABASE_URL="$DBURL" npx tsx scripts/probe-removal-signals.ts
//
// ~6 cases x up to 2 hosts, serial with gaps: ~15 authed requests total.
import 'dotenv/config';
import { initializeDatabase } from '../src/database/db';
import { redditSessionService } from '../src/services/reddit-session.service';
import { resolveShareUrl, isShareUrl } from '../src/services/reddit-check.service';
import { summarizeRawPost, describeSignals } from '../src/utils/reddit-post-signals';

const FETCH_TIMEOUT_MS = 12_000;
const HOSTS = ['www.reddit.com', 'old.reddit.com'];
const SESSION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface Case {
  label: string;
  url: string;
}

const CASES: Case[] = [
  { label: 'live-share', url: 'https://www.reddit.com/r/NewParents/s/gDbHPHrGSO' },
  { label: 'live-share-2', url: 'https://www.reddit.com/r/GiftIdeasHub/s/Y82jxebgzT' },
  { label: 'admin-deleted', url: 'https://www.reddit.com/r/BudgetMoms/s/7YaEexhHyn' },
  { label: 'admin-deleted-2', url: 'https://www.reddit.com/r/hometheatersetups/s/D8oMew0k0y' },
  { label: 'admin-deleted-3', url: 'https://www.reddit.com/r/ProductivityApps/s/IZgZ91mIO1' },
  { label: 'fabricated-404', url: 'https://www.reddit.com/r/test/comments/zzzzzzz9/nonexistent_probe_post_abcdef/' },
];

/** CLI URLs override the built-in cases (used for the second sweep). */
function casesFromArgv(): Case[] {
  const args = process.argv.slice(2).filter((a) => /^https?:\/\//i.test(a));
  if (args.length === 0) return CASES;
  return args.map((url, i) => ({ label: `cli-${i + 1}`, url }));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function oneLine(s: string, max = 90): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

async function probe(c: Case, headers: Record<string, string>): Promise<void> {
  console.log(`\n=== ${c.label} ===`);
  console.log(`input: ${c.url}`);
  const normalized = c.url.trim().split(/[?#]/)[0].replace(/\/+$/, '');
  for (const host of HOSTS) {
    try {
      const hostBase = normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`);
      const target = isShareUrl(hostBase) ? await resolveShareUrl(hostBase, headers) : hostBase;
      if (target !== hostBase) console.log(`[${host}] share resolved -> ${target}`);
      const res = await fetch(`${target}/.json?raw_json=1`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = await res.text().catch(() => '');
      const ct = res.headers.get('content-type') || '';
      let summary = `status=${res.status} content-type=${ct.split(';')[0] || '?'}`;
      if (res.ok && ct.includes('json')) {
        try {
          const data = JSON.parse(body) as unknown[];
          const kids = (data as any[])?.[0]?.data?.children;
          if (!Array.isArray(kids) || kids.length === 0) {
            summary += ' | listing EMPTY (no children)';
          } else {
            const signals = summarizeRawPost(kids[0]?.data);
            summary += signals
              ? ` | title=${oneLine(signals.title, 60)} | author=${signals.author} | ${describeSignals(signals)}`
              : ' | child is NOT a post object';
          }
        } catch {
          summary += ` | unparseable body (${body.length} chars)`;
        }
      } else if (!res.ok) {
        summary += ` | body-head=${oneLine(body, 120)}`;
      }
      console.log(`[${host}] ${summary}`);
    } catch (error) {
      console.log(`[${host}] threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(2000);
  }
}

// Wrapped rather than top-level await: the host repo builds to CJS, where
// top-level await is a transform error.
async function main(): Promise<void> {
  // Required: loadCookie() reads RedditSession through Prisma, and it
  // swallows any DB error into `null`, which would masquerade as "no vault
  // configured" and make every case below report no_session.
  await initializeDatabase();

  const cookie = await redditSessionService.loadCookie();
  if (!cookie) {
    console.log('NO_SESSION: no Reddit session cookie in the vault. Paste it in dashboard Settings first.');
    process.exit(2);
  }
  console.log(`session: vault cookie present (${cookie.length} chars, not shown)`);

  const headers: Record<string, string> = {
    'User-Agent': SESSION_USER_AGENT,
    Accept: 'application/json',
    Cookie: cookie,
  };

  for (const c of casesFromArgv()) {
    await probe(c, headers);
  }
  console.log('\nPROBE COMPLETE');
}

main().catch((error) => {
  console.error('probe failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
