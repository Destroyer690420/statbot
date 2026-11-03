import { Client, GatewayIntentBits, TextChannel, Message } from 'discord.js';
import { initializeDatabase, getDb } from '../src/database/db';
import { getAllAdminIds } from '../src/utils/permissions';
import { mapWithConcurrency } from '../src/utils/bounded-concurrency';
import { payoutService } from '../src/services/payout.service';
import { commissionService } from '../src/services/commission.service';
import { settingsService } from '../src/services/settings.service';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

export interface TicketAuditResult {
  channelId: string;
  channelName: string;
  channelCreatedAt: Date;
  workerId: string | null;
  workerUsername: string | null;
  lastActivityAt: Date;
  hasWorkerMessages: boolean;
  inactivityDays: number;
  isInactive30Plus: boolean;
  isInactive25Plus: boolean;
  isInactive15Plus: boolean;
  isProtected: boolean;
  protectionReasons: string[];
  tasksCount: number;
  eligibleForDeletion: boolean;
}

export async function auditSingleTicket(
  channel: TextChannel,
  staffSet: ReadonlySet<string>,
  paidTaskIds: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<TicketAuditResult> {
  const db = getDb();

  // 1. Resolve worker
  let workerId: string | null = null;
  let workerUsername: string | null = null;

  // Check channel members
  const nonStaffMembers = [...channel.members.values()].filter(
    (m) => !m.user.bot && !staffSet.has(m.id),
  );
  if (nonStaffMembers.length === 1) {
    workerId = nonStaffMembers[0].id;
    workerUsername = nonStaffMembers[0].user.tag || nonStaffMembers[0].displayName;
  }

  // Fallback to Task table
  const tasks = await db.task.findMany({
    where: { channelId: channel.id },
    orderBy: { createdAt: 'desc' },
  });

  if (!workerId && tasks.length > 0) {
    const latestWithUser = tasks.find((t) => t.assignedUserId);
    if (latestWithUser) {
      workerId = latestWithUser.assignedUserId;
      workerUsername = latestWithUser.assignedUserName || null;
    }
  }

  // Fallback to WorkerPortalAccess
  if (!workerId) {
    const portal = await db.workerPortalAccess.findUnique({
      where: { channelId: channel.id },
    }).catch(() => null);
    if (portal) {
      workerId = portal.workerId;
    }
  }

  // Fallback to InviteDetection
  if (!workerId) {
    const invite = await db.inviteDetection.findFirst({
      where: { ticketChannelId: channel.id },
    }).catch(() => null);
    if (invite) {
      workerId = invite.inviteeId;
      workerUsername = invite.inviteeName || null;
    }
  }

  // 2. Scan message history to find last worker message
  let lastActivityAt: Date | null = null;
  let hasWorkerMessages = false;
  let lastMessageId: string | undefined = undefined;
  let fetchedCount = 0;
  const MAX_MESSAGES_TO_SCAN = 500; // Cap to prevent infinite scan on huge channels

  while (fetchedCount < MAX_MESSAGES_TO_SCAN) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastMessageId ? { before: lastMessageId } : {}),
    }).catch(() => null);

    if (!batch || batch.size === 0) break;
    fetchedCount += batch.size;

    for (const msg of batch.values()) {
      // If we don't know the worker yet, try extracting from Ticket Tool / bot welcome mention
      if (!workerId && (msg.author.bot || staffSet.has(msg.author.id))) {
        const mentionMatch = msg.content.match(/<@!?(\d+)>/);
        if (mentionMatch && !staffSet.has(mentionMatch[1])) {
          workerId = mentionMatch[1];
        }
      }

      // Check if message is from the worker
      const isFromWorker = workerId
        ? msg.author.id === workerId
        : !msg.author.bot && !staffSet.has(msg.author.id);

      if (isFromWorker) {
        if (!workerId) {
          workerId = msg.author.id;
          workerUsername = msg.author.tag || msg.author.username;
        }
        if (!lastActivityAt || msg.createdAt > lastActivityAt) {
          lastActivityAt = msg.createdAt;
          hasWorkerMessages = true;
        }
      }
    }

    // If we found a worker message within the last 30 days, we can stop early!
    if (lastActivityAt && (now.getTime() - lastActivityAt.getTime()) < 30 * 24 * 60 * 60 * 1000) {
      break;
    }

    lastMessageId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  // If no worker messages ever, use ticket creation date
  if (!lastActivityAt) {
    lastActivityAt = channel.createdAt;
    hasWorkerMessages = false;
  }

  const inactivityMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const inactivityDays = inactivityMs / (1000 * 60 * 60 * 24);
  const isInactive30Plus = inactivityDays >= 30;
  const isInactive25Plus = inactivityDays >= 25;
  const isInactive15Plus = inactivityDays >= 15;

  // 3. Check data protections
  const protectionReasons: string[] = [];

  // Check tasks in this channel
  let hasRecentInProgressTask = false;
  for (const t of tasks) {
    // In-progress tasks
    if ([
      'ACCEPTED',
      'PENDING',
      'REMINDER_20_SENT',
      'INSIGHT_20_RECEIVED',
      'REMINDER_70_SENT',
      'INSIGHT_70_RECEIVED',
    ].includes(t.status)) {
      const taskCreatedAt = (t as any).createdAt ? new Date((t as any).createdAt) : channel.createdAt;
      const taskAgeDays = (now.getTime() - taskCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (taskAgeDays < 30) {
        hasRecentInProgressTask = true;
      }
      // Tasks pending >= 30 days do NOT protect the ticket
    }

    // Completed or archived but not yet paid (Pending Payment)
    if ((t.status === 'COMPLETED' || t.status === 'ARCHIVED') && !paidTaskIds.has(t.id)) {
      if (t.cancelledReason === null || t.cancelledReason === undefined) {
        protectionReasons.push(`Unpaid task ${t.id} (${t.status})`);
      }
    }
  }

  // Check worker payable commissions if workerId is known
  if (workerId) {
    try {
      const rates = await settingsService.getCommissionRates();
      const referrals = await db.referral.findMany({
        where: {
          OR: [
            { inviteeId: workerId },
            { inviterId: workerId },
            { ticketId: channel.name },
          ],
        },
      });

      for (const ref of referrals) {
        const payable = await commissionService.getPayableItems(ref as any, rates);
        if (payable.length > 0) {
          protectionReasons.push(`Payable commission on referral ${ref.id} (${payable.length} items)`);
        }
      }
    } catch (err) {
      logger.warn('Failed checking referral commissions for worker', { workerId, error: err });
    }
  }

  const isProtected = protectionReasons.length > 0;
  const eligibleForDeletion = isInactive30Plus && !isProtected && !hasRecentInProgressTask;

  return {
    channelId: channel.id,
    channelName: channel.name,
    channelCreatedAt: channel.createdAt,
    workerId,
    workerUsername,
    lastActivityAt,
    hasWorkerMessages,
    inactivityDays: Math.floor(inactivityDays * 10) / 10,
    isInactive30Plus,
    isInactive25Plus,
    isInactive15Plus,
    isProtected,
    protectionReasons,
    tasksCount: tasks.length,
    eligibleForDeletion,
  };
}

export async function runInactivityAudit(client: Client, concurrency = 8): Promise<{
  scanned: number;
  inactive30Plus: number;
  inactive25Plus: number;
  inactive15Plus: number;
  active: number;
  protectedCount: number;
  eligibleForDeletion: number;
  results: TicketAuditResult[];
}> {
  initializeDatabase();
  const guild = await client.guilds.fetch(env.GUILD_ID);
  await guild.channels.fetch();
  await guild.members.fetch().catch(() => undefined);

  const staffSet = new Set(getAllAdminIds());
  const paidTaskIds = await payoutService.getPaidTaskIds();

  const ticketChannels = [...guild.channels.cache.values()]
    .filter((c): c is TextChannel => c instanceof TextChannel && c.name.startsWith('ticket-'))
    .sort((a, b) => a.name.localeCompare(b.name));

  logger.info(`Starting audit of ${ticketChannels.length} ticket channels with concurrency ${concurrency}...`);

  const results = await mapWithConcurrency(
    ticketChannels,
    concurrency,
    async (channel, idx) => {
      const res = await auditSingleTicket(channel, staffSet, paidTaskIds);
      if ((idx + 1) % 50 === 0 || idx + 1 === ticketChannels.length) {
        logger.info(`Audited ${idx + 1}/${ticketChannels.length} tickets...`);
      }
      return res;
    },
  );

  const inactive30Plus = results.filter((r) => r.isInactive30Plus).length;
  const inactive25Plus = results.filter((r) => r.isInactive25Plus && !r.isInactive30Plus).length;
  const inactive15Plus = results.filter((r) => r.isInactive15Plus && !r.isInactive25Plus).length;
  const active = results.filter((r) => !r.isInactive30Plus && !r.isProtected).length;
  const protectedCount = results.filter((r) => r.isProtected).length;
  const eligibleForDeletion = results.filter((r) => r.eligibleForDeletion).length;

  return {
    scanned: results.length,
    inactive30Plus,
    inactive25Plus,
    inactive15Plus,
    active,
    protectedCount,
    eligibleForDeletion,
    results,
  };
}

async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  await client.login(env.DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));

  try {
    const report = await runInactivityAudit(client, 10);

    console.log('\n======================================================');
    console.log('              TICKET INACTIVITY AUDIT REPORT          ');
    console.log('======================================================');
    console.log(`Total tickets scanned:                   ${report.scanned}`);
    console.log(`Active tickets (<15 days):              ${report.scanned - report.inactive30Plus - report.inactive25Plus - report.inactive15Plus}`);
    console.log(`Day 15-24 Warning eligible:             ${report.inactive15Plus}`);
    console.log(`Day 25-29 Final Warning eligible:       ${report.inactive25Plus}`);
    console.log(`Tickets inactive 30+ days:               ${report.inactive30Plus}`);
    console.log(`  - Protected (pending payments/tasks):  ${report.results.filter((r) => r.isInactive30Plus && r.isProtected).length}`);
    console.log(`  - Eligible for deletion:               ${report.eligibleForDeletion}`);
    console.log('======================================================\n');

    const sampleDeletable = report.results.filter((r) => r.eligibleForDeletion).slice(0, 10);
    console.log('Sample eligible for deletion:');
    for (const s of sampleDeletable) {
      console.log(`  - ${s.channelName} (${s.channelId}): worker ${s.workerUsername || s.workerId || 'unknown'} inactive ${s.inactivityDays}d (hasMsgs: ${s.hasWorkerMessages}, tasks: ${s.tasksCount})`);
    }

    const sampleProtected = report.results.filter((r) => r.isInactive30Plus && r.isProtected);
    if (sampleProtected.length > 0) {
      console.log('\nProtected 30+ days tickets:');
      for (const p of sampleProtected) {
        console.log(`  - ${p.channelName} (${p.channelId}): ${p.protectionReasons.join('; ')}`);
      }
    }
  } catch (error) {
    console.error('Audit failed:', error);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  void main();
}

