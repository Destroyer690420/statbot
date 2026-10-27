import { Client, GatewayIntentBits } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { env } from '../src/config/env';
import { OWNER_USER_ID } from '../src/config/constants';
import { runOwnerDigestForWeekKey } from '../src/services/owner-digest.service';
import { digestWindowFromKey, lastCompletedDigestWeekKey } from '../src/services/owner-digest-plan';
import { logger } from '../src/utils/logger';

/**
 * One-off operator script: sends the weekly owner digest DM for a PAST
 * Thursday→Wednesday week with the REAL numbers from the database — the
 * one-time test of the digest feature. It exercises the exact production
 * path (owner-earnings math → message build → owner DM → DIGEST_SENT audit
 * marker) without waiting for the Thursday 00:10 IST scheduler.
 *
 * Usage (run from the HOST repo — same DATABASE_URL rewrite as the other
 * scripts, because `host.docker.internal` only resolves inside compose):
 *
 *   DBURL="$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')"
 *   DATABASE_URL="$DBURL" npx tsx scripts/send-owner-digest-test.ts --dry-run
 *   DATABASE_URL="$DBURL" npx tsx scripts/send-owner-digest-test.ts
 *   DATABASE_URL="$DBURL" npx tsx scripts/send-owner-digest-test.ts --week 2026-10-15
 *
 *   --dry-run          Compute + print the message, send nothing, audit nothing.
 *   --week YYYY-MM-DD  Digest week key (the THURSDAY the week starts on, IST).
 *                      Default: the most recently completed week.
 *
 * The script logs in with the SAME bot token as the running app (no guild
 * caches needed — it only opens the owner DM), so run it when no blast is in
 * flight. A real send writes the DIGEST_SENT audit marker for that week, so
 * re-running it is a no-op (the scheduler's exactly-once guard applies).
 */

interface Options {
  dryRun: boolean;
  week: string | null;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { dryRun: false, week: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--week') {
      const value = args[i + 1];
      if (!value) throw new Error('--week requires a YYYY-MM-DD value');
      options.week = value;
      i++;
    }
  }
  return options;
}

function waitForReady(client: Client): Promise<void> {
  if (client.isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (e) => reject(e));
  });
}

async function main(): Promise<void> {
  const options = parseArgs();
  const key = options.week ?? lastCompletedDigestWeekKey(Date.now());
  const window = digestWindowFromKey(key);
  logger.info('Owner digest test', {
    key,
    startUTC: window.startUTC.toISOString(),
    endUTC: window.endUTC.toISOString(),
    dryRun: options.dryRun,
  });

  initializeDatabase();

  if (options.dryRun) {
    const result = await runOwnerDigestForWeekKey(null, key);
    console.log('\n──────── DRY RUN (nothing sent, nothing audited) ────────\n');
    console.log(result.message);
    console.log('\n──────────────────────────────────────────────────────────\n');
    return;
  }

  // DM-only client: no guild intents or caches — the digest path only needs
  // client.users.fetch(OWNER_USER_ID).
  const client = new Client({ intents: [] });
  await client.login(env.DISCORD_TOKEN);
  await waitForReady(client);

  try {
    const result = await runOwnerDigestForWeekKey(client, key);
    if (result.sent) {
      logger.info('Owner digest test DM sent', {
        key,
        to: OWNER_USER_ID,
        auditMarker: `owner-digest:${key}`,
      });
      console.log(`\n✅ Digest DM for week ${key} sent to ${OWNER_USER_ID} (audit marker written).\n`);
    } else {
      logger.warn('Owner digest test did not send', { key, skipped: result.skipped, error: result.error });
      console.log(
        `\n⚠️ Nothing sent for week ${key} (reason: ${result.skipped ?? 'unknown'}${result.error ? `: ${result.error}` : ''}).\n`,
      );
      console.log('\n──────── MESSAGE THAT WOULD HAVE BEEN SENT ────────\n');
      console.log(result.message);
      process.exitCode = 1;
    }
  } finally {
    client.destroy();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    logger.error('Owner digest test failed', {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    process.exit(1);
  });
