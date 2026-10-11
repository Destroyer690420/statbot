/**
 * Link escalation: posts still link-less 15 min after delivery get
 * re-blasted and reassigned to new winners.
 *
 * Trigger (immediate per task): a task's +15 min fire collects EVERY
 * currently-overdue post into one pool and opens a single combined blast
 * (`createdBy = 'link-escalation'`). First-N repliers each take one post
 * (most overdue first); the GoPartTime accept is NOT repeated (already
 * claimed) — winners just get the content re-delivered via reassignTask.
 * Slackers (the pooled tasks' previous workers) cannot win the round that
 * replaces them. Tasks still unassigned when the round closes stay pooled
 * for the next trigger, and the owner is tagged in their tickets.
 *
 * In-memory rounds only: a restart loses the pairing map, but overdue
 * tasks re-pool naturally (reassigned tasks run a fresh 10-min clock), so
 * recovery is a delayed re-blast, never a lost post.
 */
import { Client, TextChannel } from 'discord.js';
import { AuditAction } from '../types';
import { OWNER_USER_ID } from '../config/constants';
import { deliverySentAt, isEscalateDue, isNudgeCandidate } from '../utils/link-nudge';
import { outreachService } from './outreach.service';
import { outreachRepository, taskRepository } from '../database/repositories';
import { toTask } from '../database/converters';
import { taskService } from './task.service';
import { auditLogService } from './audit.service';
import { logger } from '../utils/logger';

/** Blast marker: distinguishes escalation rounds from hour bursts. */
export const ESCALATION_SENDER = 'link-escalation';

interface EscalationRound {
  blastId: string;
  /** Pool order: most overdue first. */
  taskIds: string[];
  /** taskId -> winner channelId (paired, reassigned). */
  assigned: Map<string, string>;
  /** Previous workers of pooled tasks: excluded from this round. */
  slackers: Set<string>;
  createdAt: number;
}

let openRound: EscalationRound | null = null;

/** Currently-overdue posts, most overdue first (fresh state, no cache). */
export async function collectOverduePool(): Promise<{ id: string; sentAt: number }[]> {
  const rows = await taskRepository.findUnsubmittedSentPosts().catch(() => []);
  const now = Date.now();
  const pool: { id: string; sentAt: number }[] = [];
  for (const row of rows) {
    try {
      const task = toTask(row as any);
      if (!isNudgeCandidate(task)) continue;
      const sentAt = deliverySentAt(task).getTime();
      if (isEscalateDue(task, now)) pool.push({ id: task.id, sentAt });
    } catch {
      // skip unreadable rows
    }
  }
  pool.sort((a, b) => a.sentAt - b.sentAt);
  return pool;
}

/**
 * Escalation trigger: pool everything overdue now and blast it — unless an
 * escalation round is already open (join it) or a foreign round is open
 * (defer; the next trigger retries — never supersede a live hour burst).
 */
export async function escalateDueTasks(
  discordClient: Client,
): Promise<{ blasted: boolean; blastId: string | null; pooled: number; deferred: boolean }> {
  const empty = { blasted: false, blastId: null as string | null, pooled: 0, deferred: false };
  const pool = await collectOverduePool();
  const fresh = pool.filter(
    (p) => !(openRound && (openRound.taskIds.includes(p.id) || [...openRound.assigned.keys()].includes(p.id))),
  );
  if (pool.length === 0) return empty;

  const openBlast = await outreachRepository.getOpenBlast().catch(() => null);
  if (openBlast && openBlast.createdBy !== ESCALATION_SENDER) {
    logger.info('Escalation deferred: a live round is open (retry on next trigger)', {
      openBlastId: openBlast.id,
      pooled: pool.length,
    });
    return { ...empty, pooled: pool.length, deferred: true };
  }

  if (openBlast && openRound && openBlast.id === openRound.blastId && fresh.length > 0) {
    // Join the live round: grow its slots, zero new messages (burst-merge
    // semantics — replies are still flowing into it).
    for (const p of fresh) {
      if (!openRound.taskIds.includes(p.id)) openRound.taskIds.push(p.id);
    }
    const slackers = await slackerSet(openRound.taskIds);
    openRound.slackers = slackers;
    await outreachRepository.bumpBlastSlots(openBlast.id, fresh.length).catch(() => undefined);
    logger.info('Escalation joined the live round', {
      blastId: openBlast.id,
      joined: fresh.length,
      pooled: openRound.taskIds.length,
    });
    return { blasted: false, blastId: openBlast.id, pooled: openRound.taskIds.length, deferred: false };
  }

  if (openBlast && (!openRound || openBlast.id !== openRound.blastId)) {
    // An escalation blast is open but this process lost its round map
    // (restart): adopt it rather than opening a competing blast.
    openRound = {
      blastId: openBlast.id,
      taskIds: pool.map((p) => p.id),
      assigned: new Map(),
      slackers: await slackerSet(pool.map((p) => p.id)),
      createdAt: Date.now(),
    };
    outreachService.setBlastHooksFor(openBlast.id, {
      onReply: (blastId, channelId, workerId, client) => handleEscalationReply(blastId, channelId, workerId, client),
      onClosed: (blastId) => closeEscalationForBlast(blastId, discordClient),
    });
    logger.info('Escalation adopted the open round after restart', { blastId: openBlast.id, pooled: pool.length });
    return { blasted: false, blastId: openBlast.id, pooled: pool.length, deferred: false };
  }

  // Fresh round for everything overdue.
  const taskIds = pool.map((p) => p.id);
  const slackers = await slackerSet(taskIds);
  const blast = await outreachService.beginBlast(discordClient, taskIds.length, ESCALATION_SENDER);
  openRound = { blastId: blast.id, taskIds, assigned: new Map(), slackers, createdAt: Date.now() };
  outreachService.setBlastHooksFor(blast.id, {
    onReply: (b, channelId, workerId, client) => handleEscalationReply(b, channelId, workerId, client),
    onClosed: (b) => closeEscalationForBlast(b, discordClient),
  });
  const { sent } = await outreachService.sendBlastMessages(discordClient, blast, ESCALATION_SENDER, {
    excludeWorkerIds: slackers,
  });
  for (const taskId of taskIds) {
    await auditLogService
      .log(AuditAction.LINK_ESCALATED, taskId, null, `No link 15 min after delivery — pooled into escalation re-blast ${blast.id}`)
      .catch(() => undefined);
  }
  logger.info('Escalation re-blast opened', {
    blastId: blast.id,
    pooled: taskIds.length,
    sent: sent.filter((s) => s.ok).length,
  });
  return { blasted: true, blastId: blast.id, pooled: taskIds.length, deferred: false };
}

async function slackerSet(taskIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const id of taskIds) {
    const task = await taskService.findById(id).catch(() => null);
    if (task?.assignedUserId) set.add(task.assignedUserId);
  }
  return set;
}

/**
 * Escalation pairing: the generic blast layer already enforced reply order,
 * daily cap, busy-ticket and one-win-per-blast before the hook fires. Here:
 * slackers cannot win, the link-race is re-checked, and the winner gets the
 * most-overdue unassigned post via reassignTask.
 */
export async function handleEscalationReply(
  blastId: string,
  channelId: string,
  workerId: string,
  discordClient?: Client,
): Promise<string | null> {
  const round = openRound;
  if (!round || round.blastId !== blastId || !discordClient) return null;
  if (round.slackers.has(workerId)) {
    logger.info('Escalation reply ignored: slacker cannot win the replacement round', { blastId, channelId, workerId });
    return null;
  }
  const next = round.taskIds.find((id) => !round.assigned.has(id));
  if (!next) {
    logger.info('Escalation reply: all pooled posts already assigned', { blastId, channelId });
    return null;
  }
  const current = await taskService.findById(next).catch(() => null);
  if (!current || current.submittedRedditUrl) {
    // The slacker submitted between the pool snapshot and this reply: the
    // link won the race — nothing to reassign, slot stays burned.
    logger.info('Escalation reply skipped: link arrived first', { blastId, taskId: next, channelId });
    return null;
  }
  const oldChannelId = current.channelId;
  const oldWorkerId = current.assignedUserId;
  try {
    // Dynamic import: goparttime.service static-imports nudge.service, which
    // static-imports this module — a static import back would cycle.
    const { goparttimeService } = await import('./goparttime.service');
    await goparttimeService.reassignTask(next, channelId, discordClient);
  } catch (error) {
    // Target went bad between reply and reassign (second member joined,
    // channel lost). The post stays pooled for the next winner; the burned
    // slot self-heals via the next trigger.
    logger.warn('Escalation reassign failed (post stays pooled)', {
      blastId,
      taskId: next,
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  round.assigned.set(next, channelId);
  const { scheduleNudgeForTask } = await import('./nudge.service');
  void scheduleNudgeForTask(next).catch(() => undefined);
  await auditLogService
    .log(AuditAction.LINK_ESCALATED, next, null, `Reassigned to <@${workerId}> in <#${channelId}> after 15 min without a link`)
    .catch(() => undefined);
  if (oldChannelId) {
    const oldChannel = await discordClient.channels.fetch(oldChannelId).catch(() => null);
    if (oldChannel instanceof TextChannel) {
      await oldChannel
        .send(
          `${oldWorkerId ? `<@${oldWorkerId}> ` : ''}⚠️ This post was reassigned — no link arrived within 15 minutes.`,
        )
        .catch(() => undefined);
    }
  }
  logger.info('Escalation post reassigned to blast winner', { blastId, taskId: next, channelId, workerId });
  return next;
}

/**
 * Round close (filled, superseded, or restarted): drop the hook override,
 * forget the round, tag the owner in every still-unassigned post's ticket.
 * Assigned posts run their own fresh nudge clock; unassigned ones re-pool
 * on the next trigger.
 */
export async function closeEscalationForBlast(blastId: string, discordClient?: Client): Promise<void> {
  try {
    outreachService.clearBlastHooksFor(blastId);
    if (!openRound || openRound.blastId !== blastId) return;
    const unassigned = openRound.taskIds.filter((id) => !openRound!.assigned.has(id));
    openRound = null;
    if (unassigned.length === 0) {
      logger.info('Escalation round closed, all posts assigned', { blastId });
      return;
    }
    logger.info('Escalation round closed with unassigned posts (staying pooled)', {
      blastId,
      unassigned: unassigned.length,
    });
    if (!discordClient) return;
    for (const taskId of unassigned) {
      const task = await taskService.findById(taskId).catch(() => null);
      if (!task) continue;
      const channel = await discordClient.channels.fetch(task.channelId).catch(() => null);
      if (!(channel instanceof TextChannel)) continue;
      await channel
        .send(
          `<@${OWNER_USER_ID}> ⚠️ No winner for this post in the re-blast — it stays queued for the next round.`,
        )
        .catch(() => undefined);
    }
  } catch (error) {
    logger.warn('closeEscalationForBlast failed', { blastId, error });
  }
}

/** Test hook: forgets the in-memory round. */
export function clearEscalationRound(): void {
  openRound = null;
}
