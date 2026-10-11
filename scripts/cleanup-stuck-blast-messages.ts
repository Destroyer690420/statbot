import { Client, GatewayIntentBits } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { outreachRepository } from '../src/database/repositories';
import { outreachService } from '../src/services/outreach.service';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

/**
 * One-off sweep (2026-10-11): deletes blast outreach messages stranded by
 * the supersede-without-cleanup bug — every `/burst` report carrying a known
 * scanRequestId opened its own competing blast, and beginBlast closed the
 * previous one WITHOUT deleting its loser messages (~50 per blast, ~320
 * total on 2026-10-10). The live code now cleans on supersede, so this sweep
 * only has to run once; re-running is safe (already-gone messages 404-skip,
 * open blasts are refused, filled blasts were cleaned at fill time).
 *
 * Candidates: CLOSED blasts with slotsFilled < slotsTotal that still have
 * recorded messages. Winners (repliers) always keep theirs.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stuck-blast-messages.ts --dry-run
 *   npx tsx scripts/cleanup-stuck-blast-messages.ts
 *   npx tsx scripts/cleanup-stuck-blast-messages.ts --only <blastId>,<blastId>
 *
 * Run it from the HOST repo. Same DATABASE_URL gotcha as the other one-off
 * scripts (`host.docker.internal` only resolves inside the compose network):
 *
 *   DBURL="$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')"
 *   DATABASE_URL="$DBURL" npx tsx scripts/cleanup-stuck-blast-messages.ts --dry-run
 *
 * Flags:
 *   --dry-run               Report the plan, delete nothing.
 *   --only <a,b>            Restrict to these blast ids.
 */

interface Options {
  dryRun: boolean;
  only: string[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { dryRun: false, only: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--only') {
      const value = args[i + 1];
      if (!value) {
        logger.error('--only needs a comma-separated blast id list.');
        process.exit(1);
      }
      options.only = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      i++;
    } else {
      logger.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function waitForReady(client: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.isReady()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('Discord login timed out.')), 60000);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs();
  logger.info('Stuck blast-message sweep starting', { dryRun: options.dryRun, only: options.only });

  initializeDatabase();

  let blasts;
  try {
    blasts = await outreachRepository.listBlasts();
  } catch (error) {
    logger.error('Could not list blasts. Is DATABASE_URL reachable? Nothing was deleted.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const open = blasts.filter((b) => b.status === 'OPEN');
  for (const b of open) {
    logger.warn(`  live OPEN blast left alone: ${b.id} (${b.slotsFilled}/${b.slotsTotal} filled)`);
  }

  let candidates = blasts.filter((b) => b.status !== 'OPEN' && b.slotsFilled < b.slotsTotal);
  if (options.only.length > 0) {
    const wanted = new Set(options.only);
    candidates = blasts.filter((b) => wanted.has(b.id));
  }
  logger.info(`Candidate closed blasts: ${candidates.length} (open left alone: ${open.length})`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.DISCORD_TOKEN);
  await waitForReady(client);

  try {
    let totalDeleted = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    for (const blast of candidates) {
      const messages = await outreachRepository.listBlastMessages(blast.id).catch(() => []);
      const winners = new Set(await outreachRepository.listReplyChannelIds(blast.id).catch(() => []));
      const losers = messages.filter((m) => !winners.has(m.channelId));
      if (messages.length === 0) {
        totalSkipped++;
        logger.info(`  ${blast.id}: no recorded messages — already clean`);
        continue;
      }
      logger.info(
        `  ${blast.id}: ${messages.length} recorded message(s), ${winners.size} winner(s), ` +
          `${losers.length} loser message(s)${options.dryRun ? ' WOULD DELETE' : ''}`,
      );
      if (options.dryRun) continue;
      const out = await outreachService.cleanupClosedBlastMessages(client, blast.id);
      totalDeleted += out.deleted;
      totalFailed += out.failed;
      if (out.skipped) totalSkipped++;
    }
    logger.info(
      options.dryRun
        ? 'DRY RUN — nothing was deleted'
        : `Sweep complete: deleted=${totalDeleted} failed=${totalFailed} already-clean=${totalSkipped}`,
    );
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  logger.error('Stuck blast-message sweep failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
