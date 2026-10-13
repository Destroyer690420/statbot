import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { onboardingRepository, outreachRepository } from '../src/database/repositories';
import { auditLogService } from '../src/services/audit.service';
import { lookupRedditProfile } from '../src/services/reddit-profile-check.service';
import { redditSessionService } from '../src/services/reddit-session.service';
import {
  evaluateProfileEligibility,
  formatTicketApprovalNotice,
} from '../src/utils/reddit-profile-link';
import { buildOutreachAddButton } from '../src/utils/outreach-add-button';
import { getAllAdminIds } from '../src/utils/permissions';
import { REDDIT_PROFILE_APPROVAL_ADMIN_ID } from '../src/config/constants';
import { env } from '../src/config/env';
import { AuditAction } from '../src/types';
import { logger } from '../src/utils/logger';

/**
 * One-off backfill (2026-10-14): DM the approver about every worker whose
 * stored Reddit profile is freshly eligible (50+ karma AND 14+ days old) but
 * whose ticket is NOT on the daily outreach list — the same DM + add button
 * a fresh pass gets, which older passes never received.
 *
 * Read-only on verdicts: statuses and karma columns are never rewritten, so
 * this cannot double-send ticket messages or flip a LOW_KARMA row behind the
 * live flow's back. Suspended accounts are skipped (the daily 7am scan owns
 * removals); lookup failures never DM.
 *
 * Usage:
 *   npx tsx scripts/dm-eligible-unadded.ts --dry-run
 *   npx tsx scripts/dm-eligible-unadded.ts
 *   npx tsx scripts/dm-eligible-unadded.ts --only <channelId,channelId>
 *
 * Run from the HOST repo with the rewritten DATABASE_URL (same as
 * `scripts/ask-reddit-profile-links.ts`):
 *
 *   DBURL="$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')"
 *   DATABASE_URL="$DBURL" npx tsx scripts/dm-eligible-unadded.ts --dry-run
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
    } else if (arg === '--only' && args[i + 1]) {
      options.only = args[++i]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      logger.info('Usage: npx tsx scripts/dm-eligible-unadded.ts [--dry-run] [--only <channelIds>]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const options = parseArgs();
  logger.info('Eligible-unadded backfill starting', { dryRun: options.dryRun, only: options.only });

  initializeDatabase();

  // Preflight: without the vaulted session every lookup fails, so exit before
  // reading anything — a run with no session DMs nobody by design.
  try {
    const cookie = await redditSessionService.loadCookie();
    if (!cookie) {
      logger.error('Reddit checker vault has no session — nothing can be re-checked, DMing nobody. Exiting.');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Could not read the Reddit session vault. Nothing was DMd.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  await client.login(env.DISCORD_TOKEN);
  await waitForReady(client);

  try {
    const guild = await client.guilds.fetch(env.GUILD_ID);
    await guild.members.fetch();
    await guild.channels.fetch();

    const rows = await onboardingRepository.findAllWithUsernames();
    const outreachRows = await outreachRepository.findAll();
    const selected = new Set(outreachRows.filter((r) => r && r.selected).map((r) => r.channelId));
    const only = new Set(options.only);

    const staff = new Set(getAllAdminIds());
    let checked = 0;
    let dmd = 0;
    let dmFailed = 0;
    let alreadyAdded = 0;
    let ineligible = 0;
    let bannedSkipped = 0;
    let unverifiable = 0;
    let noWorker = 0;
    let sessionIssue = false;

    for (const row of rows) {
      const channelId = row.channelId;
      const username = (row.profileUsername ?? '').trim().toLowerCase();
      if (!username) continue;
      if (only.size > 0 && !only.has(channelId)) continue;
      if (selected.has(channelId)) {
        alreadyAdded++;
        continue;
      }

      const lookup = await lookupRedditProfile(username).catch(() => null);
      if (!lookup) {
        unverifiable++;
        continue;
      }
      if (lookup.kind === 'suspended') {
        // The daily 7am scan owns removals + worker messaging — never DM here.
        bannedSkipped++;
        checked++;
        continue;
      }
      if (lookup.kind !== 'ok') {
        if (lookup.kind === 'no_session' || lookup.kind === 'session_expired' || lookup.kind === 'rate_limited') {
          sessionIssue = true;
        }
        unverifiable++;
        checked++;
        continue;
      }

      const eligibility = evaluateProfileEligibility(lookup.profile);
      checked++;
      if (!eligibility.passes) {
        ineligible++;
        continue;
      }

      // Freshly eligible and not on outreach: resolve the worker for the DM mention.
      let workerId: string | null = null;
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel instanceof TextChannel) {
          const worker = channel.members.filter((m) => !m.user.bot && !staff.has(m.id)).first();
          workerId = worker ? worker.id : null;
        }
      } catch {
        workerId = null;
      }
      if (!workerId) {
        noWorker++;
        logger.info('Eligible but no resolvable worker — DM skipped (cannot tag)', { channelId, username });
        continue;
      }

      const content =
        `eligible worker not on the daily outreach yet (fresh re-check just now):\n\n` +
        formatTicketApprovalNotice({ channelId, workerId, username, karma: eligibility.karma });

      if (options.dryRun) {
        logger.info(`  would DM approver for ${username} in ${channelId} (${eligibility.karma} karma)`);
        dmd++;
        continue;
      }

      try {
        const admin = await client.users.fetch(REDDIT_PROFILE_APPROVAL_ADMIN_ID);
        await admin.send({ content, components: buildOutreachAddButton(channelId) });
        dmd++;
        logger.info('Eligible-unadded DM sent', { channelId, username, karma: eligibility.karma });
      } catch (error) {
        dmFailed++;
        logger.warn('Eligible-unadded DM failed', {
          channelId,
          username,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(500);
    }

    logger.info('Eligible-unadded backfill done', {
      candidates: rows.length,
      checked,
      dmd,
      dmFailed,
      alreadyAdded,
      ineligible,
      bannedSkipped,
      unverifiable,
      noWorker,
      sessionIssue,
    });

    if (!options.dryRun) {
      await auditLogService
        .log(
          AuditAction.OUTREACH_MESSAGE_SENT,
          null,
          'eligible-backfill',
          `Eligible-unadded backfill: ${dmd} approver DM(s), ${dmFailed} failed, ${alreadyAdded} already on outreach, ${ineligible} ineligible, ${bannedSkipped} banned-skipped, ${unverifiable} unverifiable, ${noWorker} no-worker`,
        )
        .catch(() => undefined);
    } else {
      logger.info('DRY RUN — nothing was DMd and nothing was written');
    }
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  logger.error('Eligible-unadded backfill failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
