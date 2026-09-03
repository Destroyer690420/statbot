import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { inviteDetectionRepository, referralRepository } from '../src/database/repositories';
import { auditLogService } from '../src/services/audit.service';
import { generateInviteDetectionId } from '../src/utils/id-generator';
import { getAllAdminIds } from '../src/utils/permissions';
import { env } from '../src/config/env';
import { AuditAction } from '../src/types';
import { logger } from '../src/utils/logger';

/**
 * One-off backfill (2026-09-03): stages InviteDetection rows for members who
 * joined on/after --since (default 2026-08-29, start of day IST) and have no
 * pending detection and no Referral yet.
 *
 * Historical inviters CANNOT be reconstructed (Discord only exposes current
 * invite uses, and audit logs don't record joins), so backfilled rows are
 * created with inviter = null. Set the inviter from the dashboard Pending
 * Invites queue (pencil → edit) and then Approve.
 *
 * Tickets are resolved by scanning text channels for the invitee's first
 * solo-worker ticket created after they joined (same single-member rule as
 * the live channelCreate hook). Members who already left cannot be
 * enumerated and are skipped.
 *
 * Safe to re-run (keep-first: existing pending rows and referrals win).
 *
 * Usage:
 *   npx tsx scripts/backfill-invite-detections.ts [--since 2026-08-29] [--dry-run]
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function parseArgs(): { sinceMs: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let since = '2026-08-29';
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) {
      since = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
  if (!m) {
    console.error('Invalid --since date, expected YYYY-MM-DD.');
    process.exit(1);
  }
  // Start of the IST day, expressed as a UTC instant.
  const sinceMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) - IST_OFFSET_MS;
  return { sinceMs, dryRun };
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
  const { sinceMs, dryRun } = parseArgs();
  logger.info(`Backfill invite detections since ${new Date(sinceMs).toISOString()} (dryRun=${dryRun})`);

  initializeDatabase();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  await client.login(env.DISCORD_TOKEN);
  await waitForReady(client);

  try {
    const guild = await client.guilds.fetch(env.GUILD_ID);
    await guild.members.fetch();
    await guild.channels.fetch();

    const adminIds = new Set(getAllAdminIds());
    const members = [...guild.members.cache.values()].filter(
      (m) =>
        !m.user.bot &&
        (m.joinedTimestamp ?? 0) >= sinceMs &&
        !adminIds.has(m.id),
    );
    logger.info(`Found ${members.length} member(s) joined since cutoff (non-bot, non-admin)`);

    const textChannels = [...guild.channels.cache.values()].filter(
      (c): c is TextChannel => c instanceof TextChannel,
    );

    let created = 0;
    let skippedPending = 0;
    let skippedReferral = 0;
    let ticketsLinked = 0;

    for (const member of members) {
      const pending = await inviteDetectionRepository.findPendingByInviteeId(member.id);
      if (pending.length > 0) {
        skippedPending++;
        continue;
      }
      const refs = await referralRepository.findByInviteeId(member.id);
      if (refs.length > 0) {
        skippedReferral++;
        continue;
      }

      // First solo-worker ticket created after the join.
      const joinedAt = member.joinedTimestamp ?? sinceMs;
      let ticket: TextChannel | null = null;
      for (const channel of textChannels) {
        if (channel.createdTimestamp < joinedAt - 5 * 60 * 1000) continue;
        const workers = channel.members.filter((m) => !m.user.bot && !adminIds.has(m.id));
        if (workers.size === 1 && workers.first()?.id === member.id) {
          if (!ticket || channel.createdTimestamp < ticket.createdTimestamp) {
            ticket = channel;
          }
        }
      }

      const joinedDate = new Date(joinedAt);
      logger.info(
        `Staging ${member.user.username} (${member.id}) joined ${joinedDate.toISOString()}` +
          (ticket ? ` ticket #${ticket.name}` : ' no ticket yet'),
      );
      if (dryRun) continue;

      await inviteDetectionRepository.create({
        id: generateInviteDetectionId(),
        inviterId: null,
        inviterName: null,
        inviteeId: member.id,
        inviteeName: member.user.username,
        inviteCode: null,
        ticketChannelId: ticket?.id ?? null,
        ticketName: ticket?.name ?? null,
        status: 'pending',
        createdAt: joinedDate,
        updatedAt: new Date(),
      });
      await auditLogService.log(
        AuditAction.INVITE_DETECTED,
        null,
        'backfill',
        `Backfilled invite detection — unknown → ${member.user.username} (${member.id})` +
          (ticket ? ` ticket #${ticket.name}` : ' no ticket yet'),
      );
      created++;
      if (ticket) ticketsLinked++;
    }

    logger.info(
      `Done: ${members.length} joined, ${created} staged (${ticketsLinked} with ticket), ` +
        `${skippedPending} already pending, ${skippedReferral} already referred${dryRun ? ' [DRY RUN — nothing written]' : ''}`,
    );
  } finally {
    client.destroy();
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error('Backfill failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
