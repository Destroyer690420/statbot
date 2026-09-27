import { Client, TextChannel } from 'discord.js';
import { outreachRepository, taskRepository, workerPortalAccessRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { getIstDayBoundaries, isStaleDailyCycle } from '../utils/ist-time';
import { buildOutreachRows, formatOutreachMessage, OutreachRowInput, OutreachRow, TicketTaskStatus } from '../utils/outreach-rows';
import { isBlastFull, isAtDailyCap } from '../utils/outreach-blast';
import { createSerialQueue } from '../utils/serial-queue';
import { mapWithConcurrency } from '../utils/bounded-concurrency';
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

/** A selected ticket after its channel has been resolved (or failed to be). */
interface ResolvedTicket {
  channelId: string;
  channel: TextChannel | null;
  name: string | null;
  error: string | null;
}

/**
 * Discord message sends in flight during a blast.
 *
 * Discord's documented global REST ceiling is 50 requests/second per bot, and
 * its own support guidance for a 200-message fan-out is to pace at 40 rps.
 * Measured REST latency from the production host is ~0.33-0.38s, so by Little's
 * Law 12 in flight sustains ~32-36 rps. That leaves roughly a third of the
 * budget for reminders, ticket replies and insight uploads, which must not be
 * starved by a blast. Raising this to ~19 would saturate the cap and remove
 * that headroom.
 */
const BLAST_SEND_CONCURRENCY = 12;

/**
 * Loser-message deletions in flight. Same reasoning and same width as the send
 * pool: after this change a deletion is ONE round-trip, not two.
 */
const BLAST_DELETE_CONCURRENCY = 12;

/**
 * `channels.fetch` in flight. Almost every ticket is already in the client
 * cache (served locally, no I/O), so this only needs to be wide enough to
 * overlap the genuine cache misses without opening a socket per ticket.
 */
const CHANNEL_RESOLVE_CONCURRENCY = 12;

/** Independent database writes (stale-cycle resets) in flight. */
const DB_WRITE_CONCURRENCY = 8;

/**
 * How long a blast open/closed read is reused before re-reading the row. The
 * original code read it once per send (~78 reads for 78 tickets); this keeps
 * the same fail-closed semantics — a failed read counts as "not open" — while
 * collapsing the reads to a handful.
 */
const BLAST_LIVENESS_TTL_MS = 250;

/** Discord's 404 "Unknown Message" — the message is already gone. */
function isUnknownMessage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; status?: unknown };
  return e.code === 10007 || e.status === 404;
}

/**
 * Bounded, fail-closed view of whether a blast is still OPEN.
 *
 * `isOpen()` re-reads at most once per TTL and shares a single in-flight read
 * between concurrent callers, so a fan-out of sends performs a handful of point
 * reads instead of one per send. A failed read is reported as NOT open, exactly
 * as the previous `getBlast(...).catch(() => null)` check did — a blast whose
 * state cannot be read must not keep messaging.
 */
class BlastLiveness {
  private cachedAt = 0;
  private cachedOpen = true;
  private inflight: Promise<boolean> | null = null;

  constructor(
    private readonly blastId: string,
    private readonly ttlMs: number = BLAST_LIVENESS_TTL_MS,
  ) {}

  async isOpen(): Promise<boolean> {
    if (Date.now() - this.cachedAt < this.ttlMs) return this.cachedOpen;
    if (this.inflight === null) {
      this.inflight = (async () => {
        const live = await outreachRepository.getBlast(this.blastId).catch(() => null);
        this.cachedOpen = !!live && live.status === 'OPEN';
        this.cachedAt = Date.now();
        return this.cachedOpen;
      })().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }
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
  private portalAccessUnavailableLogged = false;
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

    const portalRows = await workerPortalAccessRepository.findAll().catch((error) => {
      if (!this.portalAccessUnavailableLogged) {
        logger.warn('Worker portal access rows unavailable', { error });
        this.portalAccessUnavailableLogged = true;
      }
      return [];
    });
    const portalByChannel = new Map(portalRows.map((entry) => [entry.channelId, entry]));

    const workerNames = await this.resolveWorkerNames(discordClient, channels);

    // Per-ticket GoPartTime task state in 2 queries instead of 2 per channel.
    // Pure read path (this is `getStatus`, the Daily Outreach page) — the blast
    // send path (beginBlast/sendBlastMessages/sendBlast) is not involved.
    const { awaiting: awaitingChannels, active: activeChannels } =
      await taskRepository.findChannelTaskStatusSets();

    const inputs: OutreachRowInput[] = [];
    for (const channel of channels) {
      const row = rowsByChannel.get(channel.id);
      const portal = portalByChannel.get(channel.id);

      const taskStatus: TicketTaskStatus = awaitingChannels.has(channel.id)
        ? 'awaiting-submission'
        : activeChannels.has(channel.id)
          ? 'active'
          : 'idle';

      inputs.push({
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guildId,
        taskStatus,
        workerName: workerNames.get(channel.id) ?? null,
        selected: row?.selected ?? false,
        messageSentAt: row?.messageSentAt ? row.messageSentAt.toISOString() : null,
        availableAt: row?.availableAt ? row.availableAt.toISOString() : null,
        portalAccessed: portal !== undefined,
        portalLastSeenAt: portal ? portal.lastSeenAt.toISOString() : null,
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
   *
   * The per-ticket work is INDEPENDENT, so it runs on a bounded number of
   * workers instead of one `await` at a time. Measured Discord REST latency
   * from the production host is ~0.33-0.38s per call, so the serial form cost
   * ~0.35s x tickets for the sends alone. `BLAST_SEND_CONCURRENCY` is sized
   * from Little's Law against Discord's documented 50 req/s global cap:
   * 12 in flight x ~3 calls/s is ~36 req/s, deliberately leaving headroom for
   * reminders, ticket replies and insight uploads so a blast can never starve
   * them. Every message still goes to a distinct channel, and discord.js keeps
   * one request queue per channel, so no per-route limit applies.
   *
   * Ordering guarantees are preserved where they matter: results are collected
   * in input order, `recordBlastMessage` is awaited before its send counts as
   * done (the post-send sweep reads those rows), and a blast that closes
   * mid-flight still stops the remaining tickets.
   */
  async sendBlastMessages(
    discordClient: Client,
    blast: { id: string; slotsTotal: number },
    senderId: string | null,
  ): Promise<{ sent: SendResult[]; skipped: SkippedTicket[] }> {
    const { dayStart, dayEnd } = getIstDayBoundaries();
    const message = await this.getMessage();

    const rows = await outreachRepository.findAll();
    const staleRows = rows.filter((r) => isStaleDailyCycle(r.messageSentAt, dayStart));
    if (staleRows.length > 0) {
      // The daily reset used to run one `await` per stale row. They are
      // independent writes, so fan them out on a small width that cannot
      // monopolise the connection pool.
      await mapWithConcurrency(staleRows, DB_WRITE_CONCURRENCY, (row) =>
        outreachRepository.resetCycle(row.channelId).catch(() => undefined),
      );
    }

    const freshRows = await outreachRepository.findAll();
    const selected = freshRows.filter((r) => r.selected);

    const sent: SendResult[] = [];
    const skipped: SkippedTicket[] = [];

    // Resolve every selected ticket first. A cached channel costs nothing;
    // only a genuine cache miss costs a REST round-trip. Doing this
    // concurrently is what removes the serial latency — the previous code
    // awaited one `channels.fetch` per ticket inside the send loop.
    const targets = await mapWithConcurrency(
      selected,
      CHANNEL_RESOLVE_CONCURRENCY,
      async (row): Promise<ResolvedTicket> => {
        try {
          const channel = await discordClient.channels.fetch(row.channelId);
          if (!channel || !(channel instanceof TextChannel)) {
            throw new Error('Channel not found or not a text channel.');
          }
          return { channelId: row.channelId, channel, name: channel.name, error: null };
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          logger.error('Outreach blast channel resolve failed', { channelId: row.channelId, error: errorText });
          return { channelId: row.channelId, channel: null, name: null, error: errorText };
        }
      },
    );

    // Member safety net, paid for only when it is actually needed.
    //
    // The old code always ran `guild.members.fetch()` here, which measured
    // 1.2s per blast for 375 members. `channel.members` is normally already
    // populated by GUILD_CREATE plus the enabled GuildMembers intent, so that
    // call is normally pure waste. But it IS the recovery path when the member
    // cache is cold (e.g. a blast fired seconds after a restart), and without
    // it every ticket would resolve as "no worker in ticket". So: only sweep
    // when at least one ticket actually has no cached members.
    const resolvedChannels = targets
      .map((t) => t.channel)
      .filter((c): c is TextChannel => c !== null);
    if (resolvedChannels.length > 0 && resolvedChannels.some((c) => c.members.size === 0)) {
      for (const guild of discordClient.guilds.cache.values()) {
        await guild.members.fetch().catch(() => undefined);
      }
      logger.info('Blast refreshed guild members: at least one ticket had none cached');
    }

    // Worker resolution is pure cache work — no I/O — so it happens inline.
    const staffIds = getAllAdminIds();
    const planned = targets.map((target) => {
      if (!target.channel) return { ...target, workerId: null };
      const worker = target.channel.members
        .filter((m) => !m.user.bot && !staffIds.includes(m.id))
        .first();
      return { ...target, workerId: worker ? worker.id : null };
    });

    // ONE daily-cap read for the whole blast instead of one per ticket.
    const workerIds = [
      ...new Set(planned.map((t) => t.workerId).filter((id): id is string => Boolean(id))),
    ];
    const assignedByWorker = await this.countPostsAssignedTodayForWorkers(workerIds, dayStart, dayEnd);

    const liveness = new BlastLiveness(blast.id);
    let stoppedEarly = false;

    await mapWithConcurrency(planned, BLAST_SEND_CONCURRENCY, async (target) => {
      // Stop-the-send check: Discord sends are slow and the blast can fill
      // while earlier sends are still in flight (a fast first reply closes it
      // mid-run). Anything sent after the fill-cleanup would never be deleted
      // — so stop as soon as the blast is no longer OPEN. `BlastLiveness`
      // re-reads the row at most every BLAST_LIVENESS_TTL_MS, which keeps the
      // same fail-closed behaviour (a failed read counts as "not open") while
      // collapsing ~78 point reads into a handful. Sends already in flight
      // when the blast closes are exactly what the post-send sweep exists for.
      if (stoppedEarly || !(await liveness.isOpen())) {
        stoppedEarly = true;
        skipped.push({
          channelId: target.channelId,
          channelName: target.name,
          reason: 'blast closed before send',
        });
        return;
      }
      if (!target.channel) {
        sent.push({
          channelId: target.channelId,
          channelName: target.name,
          ok: false,
          error: target.error ?? 'Channel not found or not a text channel.',
        });
        return;
      }
      if (!target.workerId) {
        skipped.push({
          channelId: target.channelId,
          channelName: target.name,
          reason: 'no worker in ticket',
        });
        return;
      }
      const assignedToday = assignedByWorker.get(target.workerId) ?? 0;
      if (isAtDailyCap(assignedToday, DAILY_POST_CAP)) {
        skipped.push({
          channelId: target.channelId,
          channelName: target.name,
          reason: `worker at daily cap (${assignedToday}/${DAILY_POST_CAP})`,
        });
        return;
      }
      try {
        const content = formatOutreachMessage(message, target.workerId);
        const msg = await target.channel.send(content);
        // MUST be awaited before this send is considered done: the post-send
        // sweep reads these rows to learn which messages exist.
        await outreachRepository.recordBlastMessage(blast.id, target.channel.id, msg.id);
        await outreachRepository.setMessageSent(target.channelId, new Date());
        sent.push({ channelId: target.channelId, channelName: target.name, ok: true });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error('Outreach blast send failed', { channelId: target.channelId, error: messageText });
        sent.push({ channelId: target.channelId, channelName: target.name, ok: false, error: messageText });
      }
    });

    if (stoppedEarly) {
      logger.info('Blast send stopped early: blast closed mid-send', {
        blastId: blast.id,
        sentOk: sent.filter((s) => s.ok).length,
        skipped: skipped.filter((s) => s.reason === 'blast closed before send').length,
      });
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
   *
   * Now a single covering GROUP BY instead of loading every task created in the
   * day (all columns, `contentHtml` included) and filtering in JavaScript. The
   * predicate is unchanged and was verified to return an identical count for
   * every worker against production data.
   */
  async countPostsAssignedToday(workerId: string, dayStart: Date, dayEnd: Date): Promise<number> {
    const counts = await taskRepository.countGoPartTimePostsByWorkerInRange(
      [workerId],
      dayStart,
      dayEnd,
    );
    return counts.get(workerId) ?? 0;
  }

  /**
   * Daily-cap counts for many workers in ONE query.
   *
   * `countPostsAssignedToday` used to be called once per ticket inside the
   * blast send loop, so a 78-ticket blast issued 78 full-day task reads. The
   * send loop only ever skips a worker whose count is at or above the cap, and
   * nothing in the loop creates tasks, so one snapshot for the whole loop is
   * both correct and more consistent than 78 independent reads.
   *
   * A worker missing from the map has a count of 0 (as the old per-worker
   * filter reported). A failed read yields the same all-zero view as "nobody
   * has been assigned anything yet", which is what the old code would have
   * returned on a day with no matching rows.
   */
  async countPostsAssignedTodayForWorkers(
    workerIds: readonly string[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Map<string, number>> {
    try {
      return await taskRepository.countGoPartTimePostsByWorkerInRange(workerIds, dayStart, dayEnd);
    } catch (error) {
      logger.warn('Bulk daily-cap count failed; treating every worker as 0', { error });
      return new Map<string, number>();
    }
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
    const messages = await outreachRepository.listBlastMessages(blastId).catch(() => []);
    if (messages.length === 0) {
      logger.info('Blast cleanup complete', { blastId, deleted, failed });
      return { deleted, failed };
    }
    // Independent deletions, so they run on a bounded worker pool. This loop
    // used to be strictly serial with TWO Discord round-trips per message
    // (fetch the message to assert authorship, then delete it), which made it
    // the longest phase of a blast: ~0.67s x (tickets - winners).
    //
    // The authorship assertion is dropped because the message ids come from
    // our own `channel.send()` in sendBlastMessages — we recorded the id of a
    // message we created, so it cannot belong to anyone else — and Discord
    // rejects deleting another author's message anyway (403 / Unknown Message),
    // which is why a genuinely wrong id still fails safe and is still counted
    // as a failure. A message that is already gone (404) is the outcome we
    // wanted, so it is not counted as a failure, exactly as before.
    await mapWithConcurrency(messages, BLAST_DELETE_CONCURRENCY, async (m) => {
      if (keepChannelIds.has(m.channelId)) return;
      try {
        const channel = await discordClient.channels.fetch(m.channelId).catch(() => null);
        if (!channel || !(channel instanceof TextChannel)) {
          failed++;
          return;
        }
        await channel.messages.delete(m.messageId);
        deleted++;
      } catch (error) {
        if (isUnknownMessage(error)) return; // already gone — not a failure
        failed++;
      }
    });
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