import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, Collection, Message, TextChannel } from 'discord.js';
import { getDb } from '../database/db';
import { ticketInactivityRepository } from '../database/repositories';
import { getAllAdminIds } from '../utils/permissions';
import { mapWithConcurrency } from '../utils/bounded-concurrency';
import { payoutService } from '../services/payout.service';
import { commissionService } from '../services/commission.service';
import { auditLogService } from '../services/audit.service';
import { env } from '../config/env';
import {
  OWNER_USER_ID,
  TICKET_INACTIVITY_WARNING_1_DAYS,
  TICKET_INACTIVITY_FINAL_WARNING_DAYS,
  TICKET_INACTIVITY_DELETE_DAYS,
} from '../config/constants';
import { AuditAction } from '../types';
import { logger } from '../utils/logger';

export interface TicketInactivityAudit {
  channelId: string;
  channelName: string;
  workerId: string | null;
  workerUsername: string | null;
  lastActivityAt: Date;
  hasWorkerMessages: boolean;
  inactivityDays: number;
  isFirstWarningDue: boolean;
  isFinalWarningDue: boolean;
  isDeletionDue: boolean;
  isProtected: boolean;
  protectionReasons: string[];
  tasksCount: number;
  eligibleForDeletion: boolean;
}

export interface InactivitySweepResult {
  scanned: number;
  active: number;
  firstWarningDue: number;
  finalWarningDue: number;
  deletionDue: number;
  deleted: number;
  protectedCount: number;
  skippedBackupFailed: number;
  firstWarningsSent: number;
  finalWarningsSent: number;
  deletedTickets: Array<{
    channelId: string;
    channelName: string;
    workerId: string | null;
    workerUsername: string | null;
    lastActivityAt: Date;
    deletedAt: Date;
    backupPath?: string | null;
  }>;
  protectedTickets: Array<{
    channelId: string;
    channelName: string;
    workerId: string | null;
    reasons: string[];
  }>;
}

export class InactiveTicketService {
  /**
   * Evaluates a single ticket channel for worker identity, activity timestamps,
   * and payment/task protection rules.
   */
  async auditChannel(
    channel: TextChannel,
    staffSet: ReadonlySet<string>,
    paidTaskIds: ReadonlySet<string>,
    now: Date = new Date(),
  ): Promise<TicketInactivityAudit> {
    const db = getDb();

    // 1. Resolve worker identity
    let workerId: string | null = null;
    let workerUsername: string | null = null;

    // Check channel members cache
    const nonStaffMembers = [...channel.members.values()].filter(
      (m) => !m.user.bot && !staffSet.has(m.id),
    );
    if (nonStaffMembers.length === 1) {
      workerId = nonStaffMembers[0].id;
      workerUsername = nonStaffMembers[0].user.tag || nonStaffMembers[0].displayName;
    }

    // Check Task table
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

    // Check WorkerPortalAccess
    if (!workerId) {
      const portal = await db.workerPortalAccess.findUnique({
        where: { channelId: channel.id },
      }).catch(() => null);
      if (portal) {
        workerId = portal.workerId;
      }
    }

    // Check InviteDetection
    if (!workerId) {
      const invite = await db.inviteDetection.findFirst({
        where: { ticketChannelId: channel.id },
      }).catch(() => null);
      if (invite) {
        workerId = invite.inviteeId;
        workerUsername = invite.inviteeName || null;
      }
    }

    // 2. Fetch messages to determine last worker activity
    let lastActivityAt: Date | null = null;
    let hasWorkerMessages = false;
    let lastMessageId: string | undefined = undefined;
    let fetchedCount = 0;
    const MAX_SCAN_MESSAGES = 500;

    while (fetchedCount < MAX_SCAN_MESSAGES) {
      const batch: Collection<string, Message> | null = await channel.messages.fetch({
        limit: 100,
        ...(lastMessageId ? { before: lastMessageId } : {}),
      }).catch((err) => {
        logger.warn('Failed fetching messages in ticket', { channelId: channel.id, error: err });
        return null;
      });

      if (!batch || batch.size === 0) break;
      fetchedCount += batch.size;

      for (const msg of batch.values()) {
        // If workerId is still unknown, check for welcome mention from bot / Ticket Tool
        if (!workerId && (msg.author.bot || staffSet.has(msg.author.id))) {
          const mentionMatch = msg.content.match(/<@!?(\d+)>/);
          if (mentionMatch && !staffSet.has(mentionMatch[1])) {
            workerId = mentionMatch[1];
          }
        }

        const isWorkerMsg = workerId
          ? msg.author.id === workerId
          : !msg.author.bot && !staffSet.has(msg.author.id);

        if (isWorkerMsg) {
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

      // If we found a worker message inside the deletion window, we know it's active
      if (lastActivityAt && (now.getTime() - lastActivityAt.getTime()) < TICKET_INACTIVITY_DELETE_DAYS * 24 * 60 * 60 * 1000) {
        break;
      }

      const batchValues: Message[] = Array.from(batch.values());
      lastMessageId = batchValues[batchValues.length - 1]?.id;
      if (batch.size < 100) break;
    }

    // If no worker messages ever, use ticket creation date
    if (!lastActivityAt) {
      lastActivityAt = channel.createdAt;
      hasWorkerMessages = false;
    }

    const inactivityMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
    const inactivityDays = inactivityMs / (1000 * 60 * 60 * 24);
    const isFirstWarningDue = inactivityDays >= TICKET_INACTIVITY_WARNING_1_DAYS;
    const isFinalWarningDue = inactivityDays >= TICKET_INACTIVITY_FINAL_WARNING_DAYS;
    const isDeletionDue = inactivityDays >= TICKET_INACTIVITY_DELETE_DAYS;

    // 3. Critical Data Protection Rules: ONLY pending payments protect a ticket.
    // In-progress tasks older than the deletion window do NOT protect; stale tasks will be cancelled upon deletion.
    const protectionReasons: string[] = [];
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
        if (taskAgeDays < TICKET_INACTIVITY_DELETE_DAYS) {
          hasRecentInProgressTask = true;
        }
        // Tasks pending >= TICKET_INACTIVITY_DELETE_DAYS do NOT protect the ticket
      }

      // Unpaid completed or archived tasks (Pending Payment)
      if ((t.status === 'COMPLETED' || t.status === 'ARCHIVED') && !paidTaskIds.has(t.id)) {
        if (t.cancelledReason === null || t.cancelledReason === undefined) {
          protectionReasons.push(`Pending payment on task ${t.id} (${t.status})`);
        }
      }
    }

    // Check worker's pending referral commissions (Pending Payment)
    if (workerId) {
      try {
        const rates = await commissionService.getCommissionRates();
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
            protectionReasons.push(`Pending commission on referral ${ref.id} (${payable.length} items)`);
          }
        }
      } catch (err) {
        logger.warn('Failed checking referral commissions during audit', { workerId, error: err });
      }
    }

    const isProtected = protectionReasons.length > 0;
    const eligibleForDeletion = isDeletionDue && !isProtected && !hasRecentInProgressTask;

    return {
      channelId: channel.id,
      channelName: channel.name,
      workerId,
      workerUsername,
      lastActivityAt,
      hasWorkerMessages,
      inactivityDays: Math.floor(inactivityDays * 10) / 10,
      isFirstWarningDue,
      isFinalWarningDue,
      isDeletionDue,
      isProtected,
      protectionReasons,
      tasksCount: tasks.length,
      eligibleForDeletion,
    };
  }

  /**
   * Hook for real-time activity: resets inactivity timer whenever the worker messages in the ticket.
   */
  async onWorkerMessage(
    channelId: string,
    userId: string,
    username: string | null,
    messageCreatedAt: Date,
  ): Promise<void> {
    try {
      await ticketInactivityRepository.recordWorkerMessage(
        channelId,
        userId,
        username,
        messageCreatedAt,
      );
      logger.info('Reset ticket inactivity timer on worker message', { channelId, userId });
    } catch (err) {
      logger.warn('Failed to record worker message for ticket inactivity', { channelId, userId, error: err });
    }
  }

  /**
   * Hook for channelCreate: registers a new ticket channel in the inactivity table.
   */
  async onChannelCreate(channel: TextChannel): Promise<void> {
    if (!channel.name.startsWith('ticket-')) return;
    try {
      await ticketInactivityRepository.upsertActivity(channel.id, {
        channelName: channel.name,
        lastActivityAt: channel.createdAt,
        hasWorkerMessages: false,
        status: 'ACTIVE',
      });
      logger.info('Registered new ticket for inactivity tracking', { channelId: channel.id, name: channel.name });
    } catch (err) {
      logger.warn('Failed to register new ticket on create', { channelId: channel.id, error: err });
    }
  }

  /**
   * Main lifecycle sweep: audits all ticket channels, sends warnings at Day 7/10,
   * and deletes channels at Day 15+ (notifying admin mac).
   */
  async runLifecycleSweep(
    client: Client,
    options: {
      dryRun?: boolean;
      sendWarnings?: boolean;
      deleteEligible?: boolean;
      concurrency?: number;
      notifyAdminOnDeletion?: boolean;
    } = {},
  ): Promise<InactivitySweepResult> {
    const {
      dryRun = false,
      sendWarnings = true,
      deleteEligible = true,
      concurrency = 6,
      notifyAdminOnDeletion = true,
    } = options;

    const guild = await client.guilds.fetch(env.GUILD_ID);
    await guild.channels.fetch();
    await guild.members.fetch().catch(() => undefined);

    const staffSet = new Set(getAllAdminIds());
    const paidTaskIds = await payoutService.getPaidTaskIds();
    const now = new Date();
    const db = getDb();

    const ticketChannels = [...guild.channels.cache.values()]
      .filter((c: any): c is TextChannel => (c instanceof TextChannel || Boolean(c.messages)) && c.name?.startsWith('ticket-'))
      .sort((a, b) => a.name.localeCompare(b.name));

    logger.info(`Starting inactive ticket sweep (${ticketChannels.length} tickets, dryRun=${dryRun})...`);

    const deletedTickets: InactivitySweepResult['deletedTickets'] = [];
    const protectedTickets: InactivitySweepResult['protectedTickets'] = [];
    let firstWarningsSent = 0;
    let finalWarningsSent = 0;
    let skippedBackupFailed = 0;

    const audits = await mapWithConcurrency(
      ticketChannels,
      concurrency,
      async (channel, idx) => {
        const audit = await this.auditChannel(channel, staffSet, paidTaskIds, now);

        if ((idx + 1) % 50 === 0 || idx + 1 === ticketChannels.length) {
          logger.info(`Audited ${idx + 1}/${ticketChannels.length} tickets in sweep...`);
        }

        // Persist activity baseline in DB
        const computedStatus = (audit.isDeletionDue && audit.isProtected)
          ? 'PROTECTED'
          : (audit.isDeletionDue
            ? 'WARNED_25'
            : (audit.isFinalWarningDue
              ? 'WARNED_25'
              : (audit.isFirstWarningDue ? 'WARNED_15' : 'ACTIVE')));

        await ticketInactivityRepository.upsertActivity(channel.id, {
          channelName: channel.name,
          workerId: audit.workerId,
          workerUsername: audit.workerUsername,
          lastActivityAt: audit.lastActivityAt,
          hasWorkerMessages: audit.hasWorkerMessages,
          status: computedStatus,
          protectionReason: (audit.isDeletionDue && audit.isProtected) ? audit.protectionReasons.join('; ') : null,
        }).catch((err) => logger.warn('DB upsertActivity error', { channelId: channel.id, error: err }));

        return { channel, audit };
      },
    );

    // Process actions sequentially to strictly respect Discord rate limits
    for (const { channel, audit } of audits) {
      if (audit.isDeletionDue && audit.isProtected) {
        protectedTickets.push({
          channelId: channel.id,
          channelName: channel.name,
          workerId: audit.workerId,
          reasons: audit.protectionReasons,
        });

        if (!dryRun) {
          await ticketInactivityRepository.recordProtected(channel.id, audit.protectionReasons.join('; ')).catch(() => undefined);
          await auditLogService.log(
            AuditAction.TICKET_PROTECTED,
            null,
            audit.workerId,
            `Ticket #${channel.name} (${channel.id}) protected from deletion: ${audit.protectionReasons.join('; ')}`,
          ).catch(() => undefined);
        }
        continue;
      }

      // ─── Day 15+ Deletion Flow ──────────────────────────────────────────
      if (audit.isDeletionDue) {
        if (!deleteEligible || dryRun) {
          deletedTickets.push({
            channelId: channel.id,
            channelName: channel.name,
            workerId: audit.workerId,
            workerUsername: audit.workerUsername,
            lastActivityAt: audit.lastActivityAt,
            deletedAt: now,
            backupPath: null,
          });
          continue;
        }

        // Cancel any stale in-progress tasks in PostgreSQL so they do not hang
        await db.task.updateMany({
          where: {
            channelId: channel.id,
            status: { in: ['ACCEPTED', 'PENDING', 'REMINDER_20_SENT', 'INSIGHT_20_RECEIVED', 'REMINDER_70_SENT', 'INSIGHT_70_RECEIVED'] },
          },
          data: {
            status: 'CANCELLED',
            cancelledReason: 'ticket_inactivity_15d',
          },
        }).catch((err: unknown) => {
          logger.warn('Failed to cancel stale tasks for deleted ticket', { channelId: channel.id, error: err });
        });

        // Delete Discord ticket channel directly (payment & task history safely preserved in PostgreSQL)
        try {
          await channel.delete(`Inactive for ${audit.inactivityDays} days (${TICKET_INACTIVITY_DELETE_DAYS}+ days inactive).`);
          logger.info(`Deleted inactive ticket channel #${channel.name}`, { channelId: channel.id });
        } catch (delErr) {
          logger.error(`Failed to delete Discord channel #${channel.name}`, { channelId: channel.id, error: delErr });
          continue;
        }

        // Record deletion in database
        await ticketInactivityRepository.recordDeleted(channel.id, null, now).catch(() => undefined);

        // Audit log
        await auditLogService.log(
          AuditAction.TICKET_DELETED,
          null,
          audit.workerId,
          `Ticket #${channel.name} (${channel.id}) deleted after ${audit.inactivityDays} days of inactivity. Worker: ${audit.workerId || 'none'}.`,
        ).catch(() => undefined);

        deletedTickets.push({
          channelId: channel.id,
          channelName: channel.name,
          workerId: audit.workerId,
          workerUsername: audit.workerUsername,
          lastActivityAt: audit.lastActivityAt,
          deletedAt: now,
          backupPath: null,
        });

        // Send DM to admin (mac) on deletion
        if (notifyAdminOnDeletion) {
          await this.notifyAdminOfDeletion(client, {
            channelId: channel.id,
            channelName: channel.name,
            workerId: audit.workerId,
            workerUsername: audit.workerUsername,
            lastActivityAt: audit.lastActivityAt,
            deletedAt: now,
          }).catch((dmErr) => {
            logger.warn('Failed to send deletion DM to admin mac', { error: dmErr });
          });
        }

        // Small pacing delay to avoid tight bursts on Discord REST
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }

      // ─── Day 10 Final Warning Flow ───────────────────────────────────────
      if (audit.isFinalWarningDue) {
        if (!sendWarnings || dryRun) continue;

        const record = await ticketInactivityRepository.findByChannelId(channel.id);
        if (!record?.finalWarningSentAt) {
          await this.sendFinalWarning(client, channel, audit.workerId);
          await ticketInactivityRepository.recordFinalWarning(channel.id, now).catch(() => undefined);
          await auditLogService.log(
            AuditAction.TICKET_WARNED,
            null,
            audit.workerId,
            `Final ${TICKET_INACTIVITY_FINAL_WARNING_DAYS}-day inactivity warning sent for ticket #${channel.name} (${channel.id})`,
          ).catch(() => undefined);
          finalWarningsSent += 1;
          await new Promise((r) => setTimeout(r, 400));
        }
        continue;
      }

      // ─── Day 7 First Warning Flow ────────────────────────────────────────
      if (audit.isFirstWarningDue) {
        if (!sendWarnings || dryRun) continue;

        const record = await ticketInactivityRepository.findByChannelId(channel.id);
        if (!record?.firstWarningSentAt) {
          await this.sendFirstWarning(client, channel, audit.workerId);
          await ticketInactivityRepository.recordFirstWarning(channel.id, now).catch(() => undefined);
          await auditLogService.log(
            AuditAction.TICKET_WARNED,
            null,
            audit.workerId,
            `First ${TICKET_INACTIVITY_WARNING_1_DAYS}-day inactivity warning sent for ticket #${channel.name} (${channel.id})`,
          ).catch(() => undefined);
          firstWarningsSent += 1;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    const deletionDue = audits.filter(({ audit }) => audit.isDeletionDue).length;
    const finalWarningDue = audits.filter(({ audit }) => audit.isFinalWarningDue && !audit.isDeletionDue).length;
    const firstWarningDue = audits.filter(({ audit }) => audit.isFirstWarningDue && !audit.isFinalWarningDue).length;
    const active = audits.filter(({ audit }) => !audit.isDeletionDue).length;

    return {
      scanned: audits.length,
      active,
      firstWarningDue,
      finalWarningDue,
      deletionDue,
      deleted: deletedTickets.length,
      protectedCount: protectedTickets.length,
      skippedBackupFailed,
      firstWarningsSent,
      finalWarningsSent,
      deletedTickets,
      protectedTickets,
    };
  }

  /**
   * Day 7 Warning: sends DM to worker and in-ticket notification.
   */
  private async sendFirstWarning(client: Client, channel: TextChannel, workerId: string | null): Promise<void> {
    const ticketMention = `<#${channel.id}>`;
    const inTicketMessage = workerId
      ? `Hey <@${workerId}>, this is a courtesy notice that this ticket has been inactive for ${TICKET_INACTIVITY_WARNING_1_DAYS} days. Tickets with no activity may eventually be deleted. Please reply here if you're still working or wish to keep your ticket active!`
      : `This is a courtesy notice that this ticket has been inactive for ${TICKET_INACTIVITY_WARNING_1_DAYS} days. Tickets with no activity may eventually be deleted. Please reply here if you wish to keep this ticket active!`;

    // 1. Post in ticket
    await channel.send(inTicketMessage).catch((err) => {
      logger.warn('Failed sending Day 7 warning in ticket', { channelId: channel.id, error: err });
    });

    // 2. DM worker if known
    if (workerId) {
      try {
        const user = await client.users.fetch(workerId);
        await user.send(
          `⚠️ **Inactivity Notice**: Your ticket in **Reddit Tasks** (${ticketMention}) has had no activity for ${TICKET_INACTIVITY_WARNING_1_DAYS} days. If you remain inactive, your ticket may be deleted. If you wish to keep your ticket open, please send a message in your ticket channel: ${ticketMention}`,
        );
      } catch (dmErr) {
        logger.info('Could not DM worker for Day 7 warning (DMs likely closed)', { workerId, error: dmErr });
      }
    }
  }

  /**
   * Day 10 Final Warning: sends final DM and prominent ticket notification.
   */
  private async sendFinalWarning(client: Client, channel: TextChannel, workerId: string | null): Promise<void> {
    const ticketMention = `<#${channel.id}>`;
    const daysLeft = TICKET_INACTIVITY_DELETE_DAYS - TICKET_INACTIVITY_FINAL_WARNING_DAYS;
    const inTicketMessage = workerId
      ? `🚨 **Final Inactivity Warning**: Hey <@${workerId}>, this ticket has been inactive for ${TICKET_INACTIVITY_FINAL_WARNING_DAYS} consecutive days. It will be **permanently deleted in ${daysLeft} days** if there is no response. Reply to this message to keep this ticket open!`
      : `🚨 **Final Inactivity Warning**: This ticket has been inactive for ${TICKET_INACTIVITY_FINAL_WARNING_DAYS} consecutive days. It will be **permanently deleted in ${daysLeft} days** if there is no response. Reply here to keep this ticket open!`;

    // 1. Post in ticket
    await channel.send(inTicketMessage).catch((err) => {
      logger.warn('Failed sending Day 10 final warning in ticket', { channelId: channel.id, error: err });
    });

    // 2. DM worker if known
    if (workerId) {
      try {
        const user = await client.users.fetch(workerId);
        await user.send(
          `🚨 **Final Warning**: Your ticket in **Reddit Tasks** (${ticketMention}) has been inactive for ${TICKET_INACTIVITY_FINAL_WARNING_DAYS} consecutive days. Your ticket will be **deleted in ${daysLeft} days** if you do not respond. Please send a message in your ticket ${ticketMention} to keep it active.`,
        );
      } catch (dmErr) {
        logger.info('Could not DM worker for Day 10 final warning (DMs likely closed)', { workerId, error: dmErr });
      }
    }
  }

  /**
   * Sends deletion DM to admin (mac) for each deleted ticket channel.
   */
  private async notifyAdminOfDeletion(
    client: Client,
    info: {
      channelId: string;
      channelName: string;
      workerId: string | null;
      workerUsername: string | null;
      lastActivityAt: Date;
      deletedAt: Date;
    },
  ): Promise<void> {
    const adminUser = await client.users.fetch(OWNER_USER_ID).catch(() => null);
    if (!adminUser) return;

    const lastAct = info.lastActivityAt.toISOString().slice(0, 10);
    const delDate = info.deletedAt.toISOString().slice(0, 10);
    const workerTag = info.workerId ? `<@${info.workerId}> (${info.workerId})` : 'unknown';

    const msg = [
      `🗑️ **Inactive Ticket Deleted**`,
      `• **Ticket ID:** \`${info.channelId}\` (#${info.channelName})`,
      `• **Worker Discord ID:** ${workerTag}`,
      `• **Last Activity Date:** ${lastAct}`,
      `• **Deletion Date:** ${delDate}`,
    ].join('\n');

    await adminUser.send(msg);
  }

  /**
   * Sends the list of protected tickets to admin (mac) via DM with a button.
   */
  async sendProtectedTicketsReport(client: Client): Promise<void> {
    const adminUser = await client.users.fetch(OWNER_USER_ID).catch(() => null);
    if (!adminUser) {
      logger.error('Could not resolve admin mac to send protected tickets report');
      return;
    }

    const protectedRecords = await ticketInactivityRepository.findByStatus('PROTECTED');
    const totalProtected = protectedRecords.length;

    let pendingPaymentCount = 0;
    let inProgressCount = 0;
    let referralCommissionCount = 0;
    let otherCount = 0;

    for (const p of protectedRecords) {
      const reason = p.protectionReason || '';
      if (reason.includes('Pending payment')) pendingPaymentCount++;
      else if (reason.includes('in-progress') || reason.includes('Active')) inProgressCount++;
      else if (reason.includes('commission') || reason.includes('referral')) referralCommissionCount++;
      else otherCount++;
    }

    const lines: string[] = [
      `🔒 **Protected Tickets Report**`,
      `═══════════════════════════════════════`,
      `**Total Protected Tickets:** \`${totalProtected}\``,
      `These tickets are inactive (${TICKET_INACTIVITY_DELETE_DAYS}+ days) but protected from deletion to safeguard data:`,
      `• **Pending Payments:** ${pendingPaymentCount}`,
      `• **Active / In-Progress Tasks:** ${inProgressCount}`,
      `• **Pending Referral Commissions:** ${referralCommissionCount}`,
      ...(otherCount > 0 ? [`• **Other Reasons:** ${otherCount}`] : []),
      `═══════════════════════════════════════`,
    ];

    if (totalProtected > 0) {
      lines.push(`\n📋 **Sample Protected Tickets (first 5):**`);
      for (const p of protectedRecords.slice(0, 5)) {
        const worker = p.workerId ? `<@${p.workerId}>` : (p.workerUsername || 'unknown');
        let shortReason = p.protectionReason || 'Protected';
        if (shortReason.length > 70) {
          shortReason = shortReason.slice(0, 67) + '...';
        }
        lines.push(`• **#${p.channelName || p.channelId}** (${worker}): ${shortReason}`);
      }
      if (totalProtected > 5) {
        lines.push(`\n_...and ${totalProtected - 5} more in attached file._`);
      }
    } else {
      lines.push(`No tickets are currently protected.`);
    }

    // Interactive button row
    const outreachBtn = new ButtonBuilder()
      .setLabel('Open Daily Outreach')
      .setStyle(ButtonStyle.Link)
      .setURL('https://statbot.duckdns.org/outreach')
      .setEmoji('📋');

    const refreshBtn = new ButtonBuilder()
      .setCustomId('refresh_protected_tickets')
      .setLabel('Refresh Protected List')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄');

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(outreachBtn, refreshBtn);

    // Build complete file attachment
    const fileLines = [
      `PROTECTED TICKETS REPORT`,
      `Generated: ${new Date().toISOString()}`,
      `Total Protected Tickets: ${totalProtected}`,
      `Pending Payments: ${pendingPaymentCount} | Active Tasks: ${inProgressCount} | Commissions: ${referralCommissionCount}`,
      `================================================================================\n`,
    ];

    for (const p of protectedRecords) {
      fileLines.push(
        `Channel: #${p.channelName || 'unknown'} (ID: ${p.channelId})\n` +
        `Worker: ${p.workerUsername || 'unknown'} (ID: ${p.workerId || 'none'})\n` +
        `Last Activity: ${p.lastActivityAt ? p.lastActivityAt.toISOString().slice(0, 10) : 'none'}\n` +
        `Reason: ${p.protectionReason || 'Protected'}\n` +
        `--------------------------------------------------------------------------------`,
      );
    }

    const fileBuffer = Buffer.from(fileLines.join('\n'), 'utf8');
    const attachment = new AttachmentBuilder(fileBuffer, { name: 'protected-tickets.txt' });

    await adminUser.send({
      content: lines.join('\n'),
      components: [actionRow],
      files: [attachment],
    });

    logger.info('Protected tickets report sent to admin mac successfully', {
      adminId: OWNER_USER_ID,
      totalProtected,
    });
  }

  /**
   * Generates and sends the complete Initial Cleanup Report to admin (mac) via DM.
   */
  async sendInitialCleanupReport(client: Client, summary: InactivitySweepResult): Promise<void> {
    const adminUser = await client.users.fetch(OWNER_USER_ID).catch(() => null);
    if (!adminUser) {
      logger.error('Could not resolve admin mac to send initial cleanup report');
      return;
    }

    const reportLines = [
      `📊 **Initial Ticket Cleanup Report**`,
      `═══════════════════════════════════════`,
      `• **Total tickets scanned:** ${summary.scanned}`,
      `• **Tickets inactive for ${TICKET_INACTIVITY_DELETE_DAYS}+ days:** ${summary.deletionDue}`,
      `• **Tickets deleted successfully:** ${summary.deleted}`,
      `• **Tickets protected (pending payments/tasks/disputes):** ${summary.protectedCount}`,
      `• **Tickets skipped due to backup failures:** ${summary.skippedBackupFailed}`,
      `• **Tickets that remain active:** ${summary.active}`,
      `═══════════════════════════════════════`,
    ];

    if (summary.protectedTickets.length > 0) {
      reportLines.push(`\n🔒 **Protected Tickets Sample (first 5):**`);
      for (const p of summary.protectedTickets.slice(0, 5)) {
        reportLines.push(`• #${p.channelName} (${p.channelId}): ${p.reasons[0]}`);
      }
    }

    const reportText = reportLines.join('\n');

    // If there were deleted tickets, attach a detailed log file to the DM
    if (summary.deletedTickets.length > 0) {
      const logContent = [
        `INITIAL INACTIVE TICKET CLEANUP - DELETED TICKETS LOG`,
        `Generated: ${new Date().toISOString()}`,
        `Total Deleted: ${summary.deletedTickets.length}`,
        `========================================================================\n`,
      ];

      for (const d of summary.deletedTickets) {
        logContent.push(
          `Ticket: #${d.channelName} (${d.channelId}) | Worker: ${d.workerUsername || 'unknown'} (${d.workerId || 'none'}) | Last Activity: ${d.lastActivityAt.toISOString().slice(0, 10)} | Deleted: ${d.deletedAt.toISOString().slice(0, 10)} | Backup: ${d.backupPath}`,
        );
      }

      const fileBuffer = Buffer.from(logContent.join('\n'), 'utf8');
      const attachment = new AttachmentBuilder(fileBuffer, { name: 'deleted-tickets-log.txt' });

      await adminUser.send({
        content: reportText,
        files: [attachment],
      });
    } else {
      await adminUser.send(reportText);
    }

    logger.info('Initial cleanup report sent to admin mac successfully', { adminId: OWNER_USER_ID });
  }
}

export const inactiveTicketService = new InactiveTicketService();
