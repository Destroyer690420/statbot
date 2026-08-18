import { Client, TextChannel } from 'discord.js';
import { outreachRepository, taskRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { getIstDayBoundaries, isStaleDailyCycle } from '../utils/ist-time';
import { buildOutreachRows, OutreachRowInput, OutreachRow, TicketTaskStatus } from '../utils/outreach-rows';
import { DEFAULT_OUTREACH_MESSAGE } from '../config/constants';
import { AuditAction } from '../types';
import { getAllAdminIds } from '../utils/permissions';
import { logger } from '../utils/logger';

export { buildOutreachRows, OutreachRowInput, OutreachRow, TicketTaskStatus };

export interface OutreachStatus {
  istDate: string;
  message: string;
  tickets: OutreachRow[];
}

export interface SendResult {
  channelId: string;
  channelName: string | null;
  ok: boolean;
  error?: string;
}

class OutreachService {
  /**
   * Full page state: every ticket channel + its daily outreach state.
   * Stale cycles (messageSentAt from a previous IST day) are lazily reset so
   * the page starts fresh at 00:00 IST.
   */
  async getStatus(discordClient: Client): Promise<OutreachStatus> {
    const { dayStart, dayEnd, dayKey } = getIstDayBoundaries();

    const channels: TextChannel[] = [];
    for (const guild of discordClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel instanceof TextChannel) channels.push(channel);
      }
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));

    const rows = await outreachRepository.findAll();
    const rowsByChannel = new Map(rows.map((r) => [r.channelId, r]));

    for (const row of rows) {
      if (isStaleDailyCycle(row.messageSentAt, dayStart)) {
        await outreachRepository.resetCycle(row.channelId);
        row.messageSentAt = null;
        row.availableAt = null;
      }
    }

    const tasksToday = (await taskRepository.findByCreatedAt(dayStart, dayEnd)) as {
      channelId: string;
      type: string;
    }[];

    const workerNames = await this.resolveWorkerNames(discordClient, channels);

    const inputs: OutreachRowInput[] = [];
    for (const channel of channels) {
      const row = rowsByChannel.get(channel.id);

      const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channel.id);
      const any = awaiting || (await taskRepository.findAnyGoparttimeInChannel(channel.id));

      inputs.push({
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guildId,
        taskStatus: awaiting ? 'awaiting-submission' : any ? 'active' : 'idle',
        workerName: workerNames.get(channel.id) ?? null,
        selected: row?.selected ?? false,
        messageSentAt: row?.messageSentAt ? row.messageSentAt.toISOString() : null,
        availableAt: row?.availableAt ? row.availableAt.toISOString() : null,
        tasksToday,
      });
    }

    return {
      istDate: dayKey,
      message: await this.getMessage(),
      tickets: buildOutreachRows(inputs),
    };
  }

  /**
   * Persists the checkbox selection. `selected` is remembered across days;
   * only checked tickets receive the daily message.
   */
  async saveSelection(selections: { channelId: string; selected: boolean }[]): Promise<number> {
    await outreachRepository.upsertSelection(selections);
    logger.info('Outreach selection saved', { count: selections.length });
    return selections.length;
  }

  /**
   * Sends the daily availability message to every currently selected ticket.
   * Per-channel failures are non-fatal and surfaced in the response. Sending
   * starts (or restarts) today's cycle: messageSentAt is set so subsequent
   * worker replies mark the ticket available.
   */
  async sendMessage(discordClient: Client): Promise<{ sent: SendResult[] }> {
    const { dayStart } = getIstDayBoundaries();
    const message = await this.getMessage();

    const rows = await outreachRepository.findAll();
    for (const row of rows) {
      if (isStaleDailyCycle(row.messageSentAt, dayStart)) {
        await outreachRepository.resetCycle(row.channelId);
      }
    }

    const freshRows = await outreachRepository.findAll();
    const selected = freshRows.filter((r) => r.selected);

    const sent: SendResult[] = [];
    for (const row of selected) {
      try {
        const channel = await discordClient.channels.fetch(row.channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          throw new Error('Channel not found or not a text channel.');
        }
        await channel.send(message);
        await outreachRepository.setMessageSent(row.channelId, new Date());
        sent.push({ channelId: row.channelId, channelName: channel.name, ok: true });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error('Outreach send failed', { channelId: row.channelId, error: messageText });
        sent.push({ channelId: row.channelId, channelName: null, ok: false, error: messageText });
      }
    }

    const okChannels = sent.filter((s) => s.ok).map((s) => s.channelName ?? s.channelId);
    const failedChannels = sent.filter((s) => !s.ok).map((s) => s.channelName ?? s.channelId);
    await auditLogService.log(
      AuditAction.OUTREACH_MESSAGE_SENT,
      null,
      null,
      `Daily outreach message sent to ${okChannels.length} ticket(s)${okChannels.length ? `: ${okChannels.join(', ')}` : ''}${failedChannels.length ? ` — failed: ${failedChannels.join(', ')}` : ''}`,
    );

    return { sent };
  }

  /**
   * Bot hook: a worker messaged their ticket. Marks the ticket Available when
   * the daily message was sent today, the ticket is selected, and the author
   * is a worker (non-bot, non-admin/manager). Manager and bot messages never
   * count. Best-effort — never throws into message handling.
   */
  async onWorkerMessage(channelId: string, userId: string): Promise<void> {
    try {
      if (getAllAdminIds().includes(userId)) return;

      const { dayStart } = getIstDayBoundaries();
      const row = await outreachRepository.findByChannelId(channelId);
      if (!row || !row.selected) return;

      if (isStaleDailyCycle(row.messageSentAt, dayStart)) {
        await outreachRepository.resetCycle(channelId);
        return;
      }
      if (!row.messageSentAt) return;
      if (row.availableAt) return;

      await outreachRepository.markAvailable(channelId, new Date());
      logger.info('Worker marked available for daily outreach', { channelId, userId });
    } catch (error) {
      logger.error('Outreach onWorkerMessage failed', { channelId, userId, error });
    }
  }

  async getMessage(): Promise<string> {
    try {
      const doc = await outreachRepository.getMessage();
      return doc?.message ?? DEFAULT_OUTREACH_MESSAGE;
    } catch (error) {
      logger.error('Failed to read outreach message, using default', { error });
      return DEFAULT_OUTREACH_MESSAGE;
    }
  }

  async updateMessage(message: string, userId: string): Promise<string> {
    await outreachRepository.setMessage({ message, updatedAt: new Date(), updatedBy: userId });
    logger.info('Outreach message updated', { userId });
    return message;
  }

  /**
   * Resolves each ticket's worker (the single non-bot, non-admin member).
   * Members are fetched once per guild; channels without a matching member
   * yield null.
   */
  private async resolveWorkerNames(discordClient: Client, channels: TextChannel[]): Promise<Map<string, string | null>> {
    const names = new Map<string, string | null>();

    for (const guild of discordClient.guilds.cache.values()) {
      await guild.members.fetch().catch(() => undefined);
    }

    for (const channel of channels) {
      const member = channel.members
        .filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id))
        .first();
      names.set(channel.id, member ? member.displayName || member.user.username : null);
    }

    return names;
  }
}

export const outreachService = new OutreachService();