/**
 * Post-link nudge — BullMQ schedule/store + fire-time handling.
 *
 * One stable job per task (`nudge-<id>`, latest-wins on re-delivery). Every
 * fire re-reads the task: submitted/cancelled/reassigned tasks self-cancel,
 * re-delivered tasks reschedule from the fresh delivery. Never throws into
 * callers — a missed nudge is recoverable (rehydration), a broken delivery
 * is not.
 *
 * The worker lives in scheduler/nudge-worker.ts (it needs the Discord
 * client); the escalation re-blast lives in escalation.service.ts.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Client, TextChannel } from 'discord.js';
import { env } from '../config/env';
import { LINK_ESCALATE_DELAY_MS, NUDGE_QUEUE_NAME } from '../config/constants';
import { NudgeJobData, AuditAction } from '../types';
import {
  buildNudgeMessage,
  escalateFireDecision,
  isNudgeCandidate,
  msUntilNudge,
  nudgeFireDecision,
  nudgeJobIdFor,
} from '../utils/link-nudge';
import { taskRepository } from '../database/repositories';
import { toTask } from '../database/converters';
import { taskService } from './task.service';
import { auditLogService } from './audit.service';
import { logger } from '../utils/logger';

let queue: Queue<NudgeJobData> | null = null;
let connection: IORedis | null = null;

export function initializeNudgeQueue(): Queue<NudgeJobData> {
  if (queue) return queue;
  connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on('error', (err) => logger.error('Nudge Redis error', { error: err.message }));
  queue = new Queue<NudgeJobData>(NUDGE_QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 50 }, attempts: 1 },
  });
  logger.info('Nudge queue initialized', { name: NUDGE_QUEUE_NAME });
  return queue;
}

export function getNudgeQueue(): Queue<NudgeJobData> {
  if (!queue) throw new Error('Nudge queue not initialized. Call initializeNudgeQueue() first.');
  return queue;
}

export async function closeNudgeQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  queue = null;
  connection = null;
}

export { nudgeJobIdFor };

function escalateJobIdFor(taskId: string): string {
  return `${nudgeJobIdFor(taskId)}-escalate`;
}

async function removePending(taskId: string): Promise<void> {
  try {
    const q = getNudgeQueue();
    for (const id of [nudgeJobIdFor(taskId), escalateJobIdFor(taskId)]) {
      await q.getJob(id).then((job) => job?.remove().catch(() => undefined)).catch(() => undefined);
    }
  } catch {
    // best-effort
  }
}

/**
 * (Re)starts the 10-min clock. Called after every delivery (assign, retry,
 * reassign): latest delivery wins, so the new worker always gets the full
 * window. Never throws.
 */
export async function scheduleNudgeForTask(taskId: string): Promise<void> {
  try {
    const task = await taskService.findById(taskId);
    await removePending(taskId);
    if (!task || !isNudgeCandidate(task)) return;
    const delay = msUntilNudge(task, Date.now());
    await getNudgeQueue().add(
      'link-nudge',
      { taskId, stage: 'nudge' } satisfies NudgeJobData,
      { delay, jobId: nudgeJobIdFor(taskId), removeOnComplete: true },
    );
    logger.info('Link nudge scheduled', { taskId, delayMs: delay });
  } catch (error) {
    logger.warn('Link nudge scheduling failed (non-fatal)', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Re-hydrates nudge jobs after restarts. Returns count scheduled. */
export async function rehydrateNudgeJobs(maxAgeMs: number): Promise<number> {
  let scheduled = 0;
  const rows = await taskRepository.findUnsubmittedSentPosts().catch(() => []);
  const now = Date.now();
  for (const row of rows) {
    try {
      const task = toTask(row as any);
      if (!isNudgeCandidate(task)) continue;
      const { deliverySentAt } = await import('../utils/link-nudge');
      if (now - deliverySentAt(task).getTime() > maxAgeMs) continue;
      const q = getNudgeQueue();
      const nudge = await q.getJob(nudgeJobIdFor(task.id)).catch(() => null);
      const esc = await q.getJob(escalateJobIdFor(task.id)).catch(() => null);
      if (nudge || esc) continue;
      const delay = msUntilNudge(task, now);
      await q.add(
        'link-nudge',
        { taskId: task.id, stage: 'nudge' } satisfies NudgeJobData,
        { delay, jobId: nudgeJobIdFor(task.id), removeOnComplete: true },
      );
      scheduled++;
    } catch (error) {
      logger.warn('Nudge re-hydration failed for task (continuing)', { error });
    }
  }
  logger.info('Nudge re-hydration complete', { scheduled });
  return scheduled;
}

/** +10 min fire: remind, or self-correct when the clock restarted. */
export async function processNudge(taskId: string, discordClient: Client): Promise<void> {
  const task = await taskService.findById(taskId).catch(() => null);
  if (!task) return;
  const decision = nudgeFireDecision(task, Date.now());
  if (decision.action === 'drop') return;
  if (decision.action === 'reschedule') {
    // Re-delivered since scheduling (retry/reassign restarted the clock):
    // reschedule the remainder instead of nagging early.
    try {
      await getNudgeQueue().add(
        'link-nudge',
        { taskId, stage: 'nudge' } satisfies NudgeJobData,
        { delay: decision.delayMs, jobId: nudgeJobIdFor(taskId), removeOnComplete: true },
      );
    } catch (error) {
      logger.warn('Nudge reschedule failed (non-fatal)', { taskId, error });
    }
    return;
  }
  const channel = await discordClient.channels.fetch(task.channelId).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    logger.warn('Nudge skipped: ticket channel unresolvable', { taskId, channelId: task.channelId });
    return;
  }
  await channel.send(buildNudgeMessage(task.assignedUserId)).catch((error) => {
    logger.warn('Nudge send failed (non-fatal)', { taskId, error });
  });
  await auditLogService
    .log(AuditAction.LINK_NUDGE_SENT, task.id, null, `10-min link reminder sent to <@${task.assignedUserId}>`)
    .catch(() => undefined);
  logger.info('Link nudge sent', { taskId, channelId: task.channelId });
  try {
    await getNudgeQueue().add(
      'link-escalate',
      { taskId, stage: 'escalate' } satisfies NudgeJobData,
      { delay: LINK_ESCALATE_DELAY_MS, jobId: escalateJobIdFor(taskId), removeOnComplete: true },
    );
  } catch (error) {
    logger.warn('Escalation scheduling failed (non-fatal)', { taskId, error });
  }
}

/**
 * +15 min fire: the trigger task plus every other currently-overdue post
 * form one escalation pool (immediate per-task trigger, combined blast —
 * the round is opened by escalation.service).
 */
export async function processEscalation(taskId: string, discordClient: Client): Promise<void> {
  const task = await taskService.findById(taskId).catch(() => null);
  if (!task) return;
  const decision = escalateFireDecision(task, Date.now());
  if (decision.action === 'drop') return;
  if (decision.action === 'reschedule') {
    try {
      await getNudgeQueue().add(
        'link-escalate',
        { taskId, stage: 'escalate' } satisfies NudgeJobData,
        { delay: decision.delayMs, jobId: escalateJobIdFor(taskId), removeOnComplete: true },
      );
    } catch (error) {
      logger.warn('Escalation reschedule failed (non-fatal)', { taskId, error });
    }
    return;
  }
  const { escalateDueTasks } = await import('./escalation.service');
  await escalateDueTasks(discordClient);
}
