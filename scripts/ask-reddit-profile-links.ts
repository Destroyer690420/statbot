import { Client, GatewayIntentBits, Guild, TextChannel } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { onboardingRepository } from '../src/database/repositories';
import { auditLogService } from '../src/services/audit.service';
import { getAllAdminIds } from '../src/utils/permissions';
import { mapWithConcurrency } from '../src/utils/bounded-concurrency';
import {
  buildProfileRequestPlan,
  countSkippedByReason,
  formatProfileRequestMessage,
  ProfileRequestOutcome,
  summarizeProfileRequest,
  TicketWorkerCandidate,
} from '../src/utils/reddit-profile-request';
import { env } from '../src/config/env';
import { AuditAction } from '../src/types';
import { logger } from '../src/utils/logger';

/**
 * One-off sweep (2026-09-27): asks every EXISTING ticket's worker, once, for the
 * Reddit profile link they will post from.
 *
 *   "Hey @worker, please share the reddit profile link you will be posting from.
 *    if you are posting or wanna start posting, sharing your reddit profile link
 *    is mandatory."
 *
 * Why a script and not a bot event: the existing welcome message only fires when
 * a ticket is CREATED, so the ~244 tickets that already exist were never asked
 * this specific way. A new ticket keeps the existing behaviour (channelCreate
 * welcome + first-message guide) — this sweep does not add any live hook, so it
 * cannot start messaging tickets created after it runs.
 *
 * Exactly-once: every successful send stamps `TicketOnboarding.redditProfileRequestedAt`
 * BEFORE the run reports, and the run starts by reading every stamped channel.
 * Re-running is therefore safe and resumes a partial run — a worker is asked
 * once, ever. `--force` overrides the guard when that is deliberately wanted.
 *
 * Safety: `--dry-run` is the default posture for a first look, the ticket-name
 * prefix keeps the sweep off staff channels, and a ticket whose worker cannot be
 * resolved unambiguously is skipped with a reason instead of guessing who to tag.
 *
 * Usage:
 *   npx tsx scripts/ask-reddit-profile-links.ts --dry-run
 *   npx tsx scripts/ask-reddit-profile-links.ts
 *   npx tsx scripts/ask-reddit-profile-links.ts --only ticket-0053,ticket-0154
 *   npx tsx scripts/ask-reddit-profile-links.ts --all-text-channels --force
 *
 * Run it from the HOST repo, where `DATABASE_URL` points at
 * `host.docker.internal` — a name that only resolves inside the compose
 * network. A host-side process therefore needs it rewritten, or the preflight
 * below exits with "Can't reach database server at host.docker.internal"
 * (which is a safe failure: nothing is sent):
 *
 *   DBURL="$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')"
 *   DATABASE_URL="$DBURL" npx tsx scripts/ask-reddit-profile-links.ts
 *
 * Flags:
 *   --dry-run               Report the plan, send nothing, write nothing.
 *   --force                 Re-ask tickets that were already asked.
 *   --all-text-channels     Drop the `ticket-` name requirement.
 *   --only <a,b>            Restrict to these channel ids or exact names.
 *   --concurrency <n>       Sends in flight (default 8).
 */

/**
 * Sends in flight. Discord's documented global REST ceiling is 50 req/s per bot
 * and the production host measures ~0.33-0.38s per call, so 8 in flight is
 * ~21-24 req/s. Lower than the live blast path (12) on purpose: this script logs
 * in with the SAME bot token as the running app, so reminders, insight uploads
 * and any concurrent blast are sharing that budget and must not be starved.
 */
const DEFAULT_CONCURRENCY = 8;

/** Keeps the audit `details` string inside the column's practical width. */
const AUDIT_DETAILS_MAX_CHARS = 1800;

interface Options {
  dryRun: boolean;
  force: boolean;
  allTextChannels: boolean;
  only: string[];
  concurrency: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    dryRun: false,
    force: false,
    allTextChannels: false,
    only: [],
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--all-text-channels') {
      options.allTextChannels = true;
    } else if (arg === '--only' && args[i + 1]) {
      options.only = args[++i]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (arg === '--concurrency' && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.error('Invalid --concurrency, expected a positive integer.');
        process.exit(1);
      }
      options.concurrency = parsed;
    } else if (arg === '--help' || arg === '-h') {
      logger.info(
        'Usage: npx tsx scripts/ask-reddit-profile-links.ts [--dry-run] [--force] [--all-text-channels] [--only <ids|names>] [--concurrency <n>]',
      );
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

/** Every text channel plus the non-bot, non-admin members that can see it. */
function collectCandidates(guild: Guild): TicketWorkerCandidate[] {
  const staff = new Set(getAllAdminIds());
  const candidates: TicketWorkerCandidate[] = [];

  for (const channel of guild.channels.cache.values()) {
    if (!(channel instanceof TextChannel)) continue;
    const workerIds = [...channel.members.values()]
      .filter((member) => !member.user.bot && !staff.has(member.id))
      .map((member) => member.id);
    candidates.push({ channelId: channel.id, channelName: channel.name, workerIds });
  }

  return candidates;
}

async function main(): Promise<void> {
  const options = parseArgs();
  logger.info('Reddit profile request sweep starting', {
    dryRun: options.dryRun,
    force: options.force,
    allTextChannels: options.allTextChannels,
    only: options.only,
    concurrency: options.concurrency,
  });

  initializeDatabase();

  // The one-time guard lives in a new column. If the migration has not been
  // applied, say so instead of failing later with an opaque Prisma error — and
  // exit before anything is sent.
  let alreadyAsked: string[];
  try {
    alreadyAsked = await onboardingRepository.findRedditProfileRequestedChannelIds();
  } catch (error) {
    logger.error(
      'Could not read TicketOnboarding.redditProfileRequestedAt. Apply prisma/migrations/migration.sql (ADD COLUMN IF NOT EXISTS "redditProfileRequestedAt") and re-run. Nothing was sent.',
      { error: error instanceof Error ? error.message : String(error) },
    );
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  await client.login(env.DISCORD_TOKEN);
  await waitForReady(client);

  try {
    const guild = await client.guilds.fetch(env.GUILD_ID);
    // Both fetches matter: a ticket's members are what identify its worker, and
    // a partial cache would look like "no worker in ticket" and silently skip a
    // real worker.
    await guild.members.fetch();
    await guild.channels.fetch();

    const candidates = collectCandidates(guild);
    const plan = buildProfileRequestPlan(candidates, alreadyAsked, {
      requireTicketName: !options.allTextChannels,
      force: options.force,
      only: options.only,
    });
    const skippedByReason = countSkippedByReason(plan.skipped);

    logger.info('Reddit profile request plan', {
      textChannels: candidates.length,
      alreadyAskedOnRecord: alreadyAsked.length,
      willAsk: plan.targets.length,
      skipped: plan.skipped.length,
      skippedByReason,
    });
    for (const target of plan.targets) {
      logger.info(`  will ask ${target.channelName} (${target.channelId}) -> ${target.workerId}`);
    }
    for (const entry of plan.skipped) {
      logger.info(`  skip ${entry.channelName} (${entry.channelId}): ${entry.reason}`);
    }

    if (options.dryRun) {
      logger.info('DRY RUN — nothing was sent and nothing was written');
      return;
    }
    if (plan.targets.length === 0) {
      logger.info('Nothing to send');
      return;
    }

    const outcomes: ProfileRequestOutcome[] = await mapWithConcurrency(plan.targets, options.concurrency, async (target) => {
      try {
        const channel = await client.channels.fetch(target.channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          throw new Error('Channel not found or not a text channel.');
        }
        await channel.send(formatProfileRequestMessage(target.workerId));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Reddit profile request send failed', {
          channelId: target.channelId,
          channelName: target.channelName,
          error: message,
        });
        return {
          channelId: target.channelId,
          channelName: target.channelName,
          workerId: target.workerId,
          ok: false,
          error: message,
        };
      }

      // Stamped only after Discord accepted the message, so a failed SEND is
      // retried by the next run instead of being marked as asked.
      //
      // The reverse failure — delivered but not stamped — is the one state that
      // makes a plain re-run message this worker twice, so it is reported
      // separately (never folded into `failed`) and named in the run report.
      try {
        await onboardingRepository.markRedditProfileRequested(target.channelId);
        return {
          channelId: target.channelId,
          channelName: target.channelName,
          workerId: target.workerId,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Reddit profile request delivered but NOT stamped — a re-run would ask this worker twice', {
          channelId: target.channelId,
          channelName: target.channelName,
          error: message,
        });
        return {
          channelId: target.channelId,
          channelName: target.channelName,
          workerId: target.workerId,
          ok: true,
          unstamped: true,
          error: message,
        };
      }
    });

    const { sent, failed, unstamped } = summarizeProfileRequest(outcomes);
    const failedNames = outcomes
      .filter((outcome) => !outcome.ok)
      .map((outcome) => outcome.channelName ?? outcome.channelId);
    const unstampedNames = outcomes
      .filter((outcome) => outcome.unstamped)
      .map((outcome) => outcome.channelName ?? outcome.channelId);
    logger.info('Reddit profile request sweep done', {
      asked: plan.targets.length,
      sent,
      failed,
      unstamped,
      skipped: plan.skipped.length,
      skippedByReason,
      failedChannels: failedNames,
      unstampedChannels: unstampedNames,
    });
    if (unstamped > 0) {
      logger.warn(
        'These tickets WERE asked but are not recorded: re-run with --only for anything else, never the full sweep, or they get asked twice',
        { unstampedChannels: unstampedNames },
      );
    }

    // Audit row so the broadcast is discoverable later. Kept inside the width
    // the details column comfortably holds.
    const detail = `Reddit profile request sent to ${sent}/${plan.targets.length} ticket(s)`;
    const suffix = failedNames.length > 0 ? ` — failed: ${failedNames.join(', ')}` : '';
    const unstampedSuffix = unstamped > 0 ? ` — delivered but unrecorded: ${unstampedNames.join(', ')}` : '';
    await auditLogService.log(
      AuditAction.OUTREACH_MESSAGE_SENT,
      null,
      'reddit-profile-request',
      `${detail}${suffix}${unstampedSuffix}`.slice(0, AUDIT_DETAILS_MAX_CHARS),
    );
  } finally {
    client.destroy();
  }
}

main().catch((err) => {
  logger.error('Reddit profile request sweep failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
