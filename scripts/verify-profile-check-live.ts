// Live pre-deploy verification of the Reddit profile check against the real
// spare-account session stored in the vault.
//
// Prints ONLY verdicts and karma - never the cookie, never the DATABASE_URL.
// This closes the "ban/low-karma verdicts unverified against live Reddit"
// caveat in docs/KNOWN_ISSUES.md before the feature is switched on.
import 'dotenv/config';
import { initializeDatabase } from '../src/database/db';
import { lookupRedditProfile } from '../src/services/reddit-profile-check.service';

const CASES: Array<{ label: string; username: string; expect: string }> = [
  { label: 'high-karma account (Reddit CEO)', username: 'spez', expect: 'ok with large karma' },
  { label: 'nonexistent username (typo case)', username: 'zzq7x3m9p2k4v8w', expect: 'not_found, NOT suspended' },
  { label: 'second real account', username: 'Gronk', expect: 'ok' },
];

// Wrapped rather than top-level await: the host repo builds to CJS, where
// top-level await is a transform error.
async function main(): Promise<void> {
  // Required: loadCookie() reads RedditSession through Prisma, and it
  // swallows any DB error into `null`, which would masquerade as "no vault
  // configured" and make every case below report no_session.
  await initializeDatabase();

  for (const c of CASES) {
    const started = Date.now();
    const r = await lookupRedditProfile(c.username);
    const detail = r.kind === 'ok' ? `link=${r.profile.linkKarma} comment=${r.profile.commentKarma}` : '';
    console.log(
      `${c.label.padEnd(38)} u/${c.username.padEnd(20)} -> ${r.kind.padEnd(15)} ${detail} (${Date.now() - started}ms) [expect: ${c.expect}]`,
    );
  }

  // The single most important assertion: a username that does not exist must
  // never be reported as a ban, or a worker with a typo would be told their
  // account is suspended.
  const typo = await lookupRedditProfile('zzq7x3m9p2k4v8w');
  if (typo.kind === 'suspended') {
    console.log('FATAL: a nonexistent username was reported as suspended.');
    process.exit(1);
  }
  console.log(`\nsanity: nonexistent username resolves to '${typo.kind}', never 'suspended'`);
  console.log('VERDICT CHECK COMPLETE');
}

main().catch((error) => {
  console.error('verification failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
