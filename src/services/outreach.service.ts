import { Client, TextChannel } from 'discord.js';
import { outreachRepository, taskRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { getIstDayBoundaries, isStaleDailyCycle } from '../utils/ist-time';
import { buildOutreachRows, formatOutreachMessage, OutreachRowInput, OutreachRow, TicketTaskStatus } from '../utils/outreach-rows';
import { isBlastFull, isAtDailyCap } from '../utils/outreach-blast';
import { createSerialQueue } from '../utils/serial-queue';
import { DEFAULT_OUTREACH_MESSAGE } from '../config/constants';
import { AuditAction } from '../types';
import { getAllAdminIds } from '../utils/permissions';
import { logger } from '../utils/logger';

export { buildOutreachRows, formatOutreachMessage, OutreachRowInput, OutreachRow, TicketTaskStatus };

export interface OutreachStatus {
  istDate: string;
  message: string;
  tickets: OutreachRow[];
  blast: { id: string; slotsTotal: number; slotsFilled: number; status: string } | null;
  /** Channels that replied in the current burst (open blast, else last closed). */
  blastReplied: string[];
}

export interface SendResult {
  channelId: string;
  channelName: string | null;
  ok: boolean;
  error?: string;
}

export interface SkippedTicket {
  channelId: string;
  channelName: string | null;
  reason: string;
}

/** Posts assigned per worker per IST day before outreach skips them. */
export const DAILY_POST_CAP = 2;

export interface BlastHooks {
  /** A blast reply won a slot (after dedupe + cap checks). */
  onReply?: (blastId: string, channelId: string, workerId: string) => Promise<unknown>;
  /** A blast just closed (filled or superseded). */
  onClosed?: (blastId: string) => Promise<unknown>;
}

class OutreachService {
  private blastHooks: BlastHooks = {};
  /**
   * Serializes worker-message handling in Discord-arrival order. The chain
   * link happens synchronously here (no awaits before it), so near-simultaneous
   * blast replies are recorded — and claimed — strictly first-reply-first,
   * never in DB-race order.
   */
  private workerMessageQueue = createSerialQueue();

  /**
   * Registers automation hooks for blast events. Set once at boot (see
   * src/index.ts). Kept as injection (not an import) so outreach never
   * depends on the automation layer — manual blasts simply have no hooks.
   */
  setBlastHooks(hooks: BlastHooks): void {
    this.blastHooks = hooks;
  }
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
      blast: await this.getOpenBlastState(),
      blastReplied: await this.getBlastRepliedChannelIds(),
    };
  }

  /**
   * Reply channel IDs for the current burst: the open blast's replies, or —
   * once closed — the most recently closed blast's winners, until a new burst
   * starts. Pure read; never mutates blast state.
   */
  async getBlastRepliedChannelIds(): Promise<string[]> {
    const blast =
      (await outreachRepository.getOpenBlast().catch(() => null)) ||
      (await outreachRepository.latestBlast().catch(() => null));
    if (!blast) return [];
    return outreachRepository.listReplyChannelIds(blast.id).catch(() => []);
  }

  /** Live open-blast state for the dashboard banner (null when none open). */
  async getOpenBlastState(): Promise<OutreachStatus['blast']> {
    const open = await outreachRepository.getOpenBlast().catch(() => null);
    if (!open) return null;
    const filled = await outreachRepository.countReplies(open.id).catch(() => open.slotsFilled);
    return { id: open.id, slotsTotal: open.slotsTotal, slotsFilled: filled, status: open.status };
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
   * Opens a blast row (superseding any still-open blast) WITHOUT messaging.
   * Split out so automation can register its burst pool BEFORE the first
   * message goes out — replies arriving mid-send must find a pool to claim
   * from, otherwise early winners burn slots with no claim.
   */
  async beginBlast(
    slotsTotal: number,
    senderId: string | null,
  ): Promise<{ id: string; slotsTotal: number }> {
    // A new blast supersedes any still-open one (its un-won messages stay —
    // those workers already saw them; only the new blast auto-cleans).
    const previous = await outreachRepository.getOpenBlast().catch(() => null);
    if (previous) {
      const filled = await outreachRepository.countReplies(previous.id).catch(() => 0);
      await outreachRepository.closeBlast(previous.id, filled).catch(() => undefined);
      try {
        await this.blastHooks.onClosed?.(previous.id);
      } catch (error) {
        logger.warn('Blast closed hook failed', { blastId: previous.id, error });
      }
    }

    const blast = await outreachRepository.createBlast(slotsTotal, senderId);
    return { id: blast.id, slotsTotal };
  }

  /**
   * Delivers one blast's message to every selected ticket (skipping capped
   * workers). Pair with beginBlast; sendBlast does both in one call.
   * Fill-safe: re-checks the blast before each send and stops once it is
   * closed (late tickets are logged as skipped), then sweeps any messages
   * that raced in after the fill-cleanup so no loser keeps the message.
   */
  async sendBlastMessages(
    discordClient: Client,
    blast: { id: string; slotsTotal: number },
    senderId: string | null,
  ): Promise<{ sent: SendResult[]; skipped: SkippedTicket[] }> {
    const { dayStart, dayEnd } = getIstDayBoundaries();
    const message = await this.getMessage();

    const rows = await outreachRepository.findAll();
    for (const row of rows) {
      if (isStaleDailyCycle(row.messageSentAt, dayStart)) {
        await outreachRepository.resetCycle(row.channelId);
      }
    }

    const freshRows = await outreachRepository.findAll();
    const selected = freshRows.filter((r) => r.selected);

    for (const guild of discordClient.guilds.cache.values()) {
      await guild.members.fetch().catch(() => undefined);
    }

    const sent: SendResult[] = [];
    const skipped: SkippedTicket[] = [];
    for (let i = 0; i < selected.length; i++) {
      const row = selected[i];
      // Stop-the-send check: Discord sends are slow and the blast can fill
      // while earlier sends are still in flight (a fast first reply closes
      // it mid-loop). Anything sent after the fill-cleanup would never be
      // deleted — so stop the moment this blast is no longer OPEN. This is
      // one cheap indexed row read per send (~ms vs ~s for the send itself).
      const live = await outreachRepository.getBlast(blast.id).catch(() => null);
      if (!live || live.status !== 'OPEN') {
        for (let j = i; j < selected.length; j++) {
          skipped.push({
            channelId: selected[j].channelId,
            channelName: null,
            reason: 'blast closed before send',
          });
        }
        logger.info('Blast send stopped early: blast closed mid-send', {
          blastId: blast.id,
          sentOk: sent.filter((s) => s.ok).length,
          skippedRest: selected.length - i,
        });
        break;
      }
      try {
        const channel = await discordClient.channels.fetch(row.channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          throw new Error('Channel not found or not a text channel.');
        }
        const worker = channel.members
          .filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id))
          .first();
        if (!worker) {
          skipped.push({ channelId: row.channelId, channelName: channel.name, reason: 'no worker in ticket' });
          continue;
        }
        const assignedToday = await this.countPostsAssignedToday(worker.id, dayStart, dayEnd);
        if (isAtDailyCap(assignedToday, DAILY_POST_CAP)) {
          skipped.push({
            channelId: row.channelId,
            channelName: channel.name,
            reason: `worker at daily cap (${assignedToday}/${DAILY_POST_CAP})`,
          });
          continue;
        }
        const content = formatOutreachMessage(message, worker.id);
        const msg = await channel.send(content);
        await outreachRepository.recordBlastMessage(blast.id, channel.id, msg.id);
        await outreachRepository.setMessageSent(row.channelId, new Date());
        sent.push({ channelId: row.channelId, channelName: channel.name, ok: true });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error('Outreach blast send failed', { channelId: row.channelId, error: messageText });
        sent.push({ channelId: row.channelId, channelName: null, ok: false, error: messageText });
      }
    }

    const okChannels = sent.filter((s) => s.ok).map((s) => s.channelName ?? s.channelId);
    const failedChannels = sent.filter((s) => !s.ok).map((s) => s.channelName ?? s.channelId);
    await auditLogService.log(
      AuditAction.OUTREACH_MESSAGE_SENT,
      null,
      senderId,
      `Outreach blast ${blast.id} (${blast.slotsTotal} slots) sent to ${okChannels.length} ticket(s)${okChannels.length ? `: ${okChannels.join(', ')}` : ''}${failedChannels.length ? ` — failed: ${failedChannels.join(', ')}` : ''}${skipped.length ? ` — skipped ${skipped.length} (daily cap / no worker / closed mid-send)` : ''}`,
    );

    // Post-send sweep: the fill-cleanup only deleted messages recorded
    // before its snapshot, so sends that raced in between fill and the
    // stop-the-send check above would otherwise stay forever. Sweep them
    // now (winners keep theirs). Only for actually-filled blasts — a blast
    // closed by supersede keeps its seen messages by design (beginBlast).
    const finalBlast = await outreachRepository.getBlast(blast.id).catch(() => null);
    if (finalBlast && isBlastFull(finalBlast.slotsFilled, finalBlast.slotsTotal)) {
      const winners = new Set(await outreachRepository.listReplyChannelIds(blast.id).catch(() => []));
      const swept = await this.deleteBlastMessages(discordClient, blast.id, winners);
      if (swept.deleted > 0 || swept.failed > 0) {
        logger.info('Blast post-send sweep complete', {
          blastId: blast.id,
          deleted: swept.deleted,
          failed: swept.failed,
        });
      }
    }

    return { sent, skipped };
  }

  /**
   * Sends a blast campaign: asks for worker availability in every selected
   * ticket except workers already at the daily post cap. The first
   * `slotsTotal` repliers win; on fill, the bot message is deleted from all
   * other contacted tickets (winners keep theirs). Supersedes any open blast.
   * Per-channel failures are non-fatal and surfaced in the response.
   */
  async sendBlast(
    discordClient: Client,
    slotsTotal: number,
    senderId: string | null,
  ): Promise<{ blast: { id: string; slotsTotal: number }; sent: SendResult[]; skipped: SkippedTicket[] }> {
    const blast = await this.beginBlast(slotsTotal, senderId);
    const { sent, skipped } = await this.sendBlastMessages(discordClient, blast, senderId);
    return { blast, sent, skipped };
  }

  /**
   * Posts assigned (created) today IST for a worker — the daily-cap basis.
   * Counts GoPartTime Post tasks in any non-terminal status.
   */
  async countPostsAssignedToday(workerId: string, dayStart: Date, dayEnd: Date): Promise<number> {
    const tasks = (await taskRepository.findByCreatedAt(dayStart, dayEnd)) as {
      source: string | null;
      type: string;
      status: string;
      assignedUserId: string;
    }[];
    return tasks.filter(
      (t) =>
        t.source === 'goparttime' &&
        t.type === 'POST' &&
        t.assignedUserId === workerId &&
        t.status !== 'CANCELLED' &&
        t.status !== 'ARCHIVED',
    ).length;
  }

  /**
   * Bot hook: a worker messaged their ticket. Always maintains the daily
   * Available flag; when a blast is open, replies are served strictly in
   * arrival order (one win per worker per blast) and the first `slotsTotal`
   * distinct repliers win, each taking exactly one claim. On fill the blast
   * closes with its message deleted from every other contacted ticket.
   * Manager and bot messages never count. Best-effort — never throws into
   * message handling.
   */
  async onWorkerMessage(channelId: string, userId: string, discordClient?: Client): Promise<void> {
    return this.workerMessageQueue(() => this.processWorkerMessage(channelId, userId, discordClient));
  }

  private async processWorkerMessage(channelId: string, userId: string, discordClient?: Client): Promise<void> {
    try {
      if (getAllAdminIds().includes(userId)) return;

      const { dayStart, dayEnd } = getIstDayBoundaries();
      const row = await outreachRepository.findByChannelId(channelId);
      if (!row || !row.selected) return;

      if (isStaleDailyCycle(row.messageSentAt, dayStart)) {
        await outreachRepository.resetCycle(channelId);
        return;
      }
      if (!row.messageSentAt) return;
      if (!row.availableAt) {
        await outreachRepository.markAvailable(channelId, new Date());
        logger.info('Worker marked available for daily outreach', { channelId, userId });
      }

      const blast = await outreachRepository.getOpenBlast().catch(() => null);
      if (!blast || !discordClient) return;

      // Daily cap re-checked at reply time: capped workers never consume slots.
      const assignedToday = await this.countPostsAssignedToday(userId, dayStart, dayEnd);
      if (isAtDailyCap(assignedToday, DAILY_POST_CAP)) {
        logger.info('Blast reply ignored: worker at daily cap', { channelId, userId, blastId: blast.id });
        return;
      }

      // Busy tickets never consume slots: recording first and skipping the
      // claim later burns a slot with no task (ghost win). Same for workers
      // that already won in this blast — one win each, so a worker with two
      // tickets can never take two tasks from one burst.
      const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channelId).catch(() => null);
      if (awaiting) {
        logger.info('Blast reply ignored: ticket busy', { channelId, userId, blastId: blast.id });
        return;
      }
      const alreadyWon = await outreachRepository.hasWorkerReplied(blast.id, userId).catch(() => false);
      if (alreadyWon) {
        logger.info('Blast reply ignored: worker already won this blast', { channelId, userId, blastId: blast.id });
        return;
      }

      const { duplicate } = await outreachRepository.recordReply(blast.id, channelId, userId);
      if (duplicate) return;

      const filled = await outreachRepository.countReplies(blast.id);
      logger.info('Blast reply recorded', { blastId: blast.id, channelId, userId, filled, slots: blast.slotsTotal });

      // Burst automation: convert the win into an accept claim (best-effort;
      // a missing hook means a manual blast — nothing happens).
      try {
        await this.blastHooks.onReply?.(blast.id, channelId, userId);
      } catch (error) {
        logger.warn('Blast reply hook failed', { blastId: blast.id, channelId, error });
      }

      if (!isBlastFull(filled, blast.slotsTotal)) return;

      // Slots full: close the blast and remove our message everywhere else.
      await outreachRepository.closeBlast(blast.id, filled);
      try {
        await this.blastHooks.onClosed?.(blast.id);
      } catch (error) {
        logger.warn('Blast closed hook failed', { blastId: blast.id, error });
      }
      const winners = new Set(await outreachRepository.listReplyChannelIds(blast.id));
      const cleaned = await this.deleteBlastMessages(discordClient, blast.id, winners);
      await auditLogService.log(
        AuditAction.OUTREACH_MESSAGE_SENT,
        null,
        null,
        `Outreach blast ${blast.id} closed (${filled}/${blast.slotsTotal} slots); message removed from ${cleaned.deleted} other ticket(s)${cleaned.failed ? `, ${cleaned.failed} removal(s) failed` : ''}`,
      );
    } catch (error) {
      logger.error('Outreach onWorkerMessage failed', { channelId, userId, error });
    }
  }

  /**
   * Deletes the blast's bot message from every contacted channel except the
   * winners. Best-effort per message (hand-deleted or missing messages are
   * skipped); only our own messages are ever touched.
   */
  private async deleteBlastMessages(
    discordClient: Client,
    blastId: string,
    keepChannelIds: Set<string>,
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    const selfId = discordClient.user?.id;
    const messages = await outreachRepository.listBlastMessages(blastId).catch(() => []);
    for (const m of messages) {
      if (keepChannelIds.has(m.channelId)) continue;
      try {
        const channel = await discordClient.channels.fetch(m.channelId).catch(() => null);
        if (!channel || !(channel instanceof TextChannel)) {
          failed++;
          continue;
        }
        const msg = await channel.messages.fetch(m.messageId).catch(() => null);
        if (!msg) continue; // already gone — not a failure
        if (selfId && msg.author.id !== selfId) {
          failed++;
          continue;
        }
        await msg.delete();
        deleted++;
      } catch {
        failed++;
      }
    }
    logger.info('Blast cleanup complete', { blastId, deleted, failed });
    return { deleted, failed };
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