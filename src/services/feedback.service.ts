/**
 * Deadline feedback ("submitting in a bit") — BullMQ schedule/lease store +
 * result handling.
 *
 * Mirrors the submission-queue wiring (own queue, stable job ids, per-tab
 * leases, dashboard-free retries): the queue holds jobs ONLY, the
 * manager-browser executor tab polls GET /feedback-jobs/pending (folded into
 * the submit-jobs pending response so the tab keeps one poll loop), clicks
 * the task card's Feedback button in-page, writes the stalling notice, and
 * reports back. One shot per task — the FEEDBACK_SENT audit is the durable
 * guard (Redis has no persistence), and the job is dropped the moment a
 * link arrives. Fire-time re-validation happens at lease: a task that gained
 * a link, went terminal, or already got its notice refuses the lease and the
 * job is removed.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Client, TextChannel } from 'discord.js';
import { env } from '../config/env';
import {
  FEEDBACK_LEASE_TIMEOUT_MS,
  FEEDBACK_MAX_ATTEMPTS,
  FEEDBACK_QUEUE_NAME,
} from '../config/constants';
import { FeedbackJobData, Task, AuditAction } from '../types';
import {
  decideFeedbackAction,
  feedbackJobIdFor,
  feedbackRetryDelayFor,
  StoredFeedbackJob,
} from '../utils/feedback-queue';
import { parseDeadlineToMs } from '../utils/deadline';
import { taskService } from './task.service';
import { auditLogService } from './audit.service';
import { taskRepository } from '../database/repositories';
import { toTask } from '../database/converters';
import { getAdminOrManagerIds } from '../utils/permissions';
import { buildFeedbackFailedMessage } from '../utils/submission-reply';
import { logger } from '../utils/logger';

let queue: Queue<FeedbackJobData> | null = null;
let connection: IORedis | null = null;

export function initializeFeedbackQueue(): Queue<FeedbackJobData> {
  if (queue) return queue;
  connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on('error', (err) => logger.error('Feedback Redis error', { error: err.message }));
  queue = new Queue<FeedbackJobData>(FEEDBACK_QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 50 }, attempts: 1 },
  });
  logger.info('Feedback queue initialized', { name: FEEDBACK_QUEUE_NAME });
  return queue;
}

export function getFeedbackQueue(): Queue<FeedbackJobData> {
  if (!queue) throw new Error('Feedback queue not initialized. Call initializeFeedbackQueue() first.');
  return queue;
}

export async function closeFeedbackQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  queue = null;
  connection = null;
}

export { feedbackJobIdFor };

/** Durable one-shot guard: a FEEDBACK_SENT audit means the notice went out. */
async function feedbackAlreadySent(taskId: string): Promise<boolean> {
  try {
    const logs = await auditLogService.getByTaskId(taskId, 100);
    return logs.some((l) => l.action === 'FEEDBACK_SENT');
  } catch {
    return false;
  }
}

/**
 * Schedules (or keeps) the feedback job for a task. Existing jobs are left
 * alone — the deadline is static, so the original due time stays correct.
 * Never throws.
 */
export async function scheduleFeedbackForTask(task: Task): Promise<{ scheduled: boolean; reason: string }> {
  try {
    const q = getFeedbackQueue();
    const jobId = feedbackJobIdFor(task.id);
    const existing = await q.getJob(jobId).catch(() => null);
    if (existing) {
      if (task.formatCheckStatus === 'DELETED') {
        await existing.remove().catch(() => undefined);
      } else {
        return { scheduled: false, reason: 'already scheduled' };
      }
    }
    const feedbackSent = await feedbackAlreadySent(task.id);
    const createdAtMs =
      task.createdAt instanceof Date
        ? task.createdAt.getTime()
        : task.createdAt
          ? new Date(task.createdAt).getTime()
          : null;
    const decision = decideFeedbackAction(
      {
        status: task.status,
        assignmentStatus: task.assignmentStatus,
        submittedRedditUrl: task.submittedRedditUrl,
        deadlineMs: parseDeadlineToMs(task.deadline, task.createdAt),
        feedbackSent,
        formatCheckStatus: task.formatCheckStatus,
        createdAtMs,
      },
      Date.now(),
    );
    if (!decision.schedule) {
      logger.info('Feedback job skipped', { taskId: task.id, reason: decision.reason });
      return { scheduled: false, reason: decision.reason };
    }
    await q.add(
      'send-feedback',
      {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        attempt: 1,
        leasedBy: null,
        leasedAt: null,
      } satisfies FeedbackJobData,
      { delay: decision.delayMs, jobId, removeOnComplete: true },
    );
    logger.info('Feedback job scheduled', { taskId: task.id, delayMs: decision.delayMs });
    return { scheduled: true, reason: decision.reason };
  } catch (error) {
    logger.warn('Feedback scheduling failed (non-fatal)', {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { scheduled: false, reason: 'schedule failed' };
  }
}

/** Drops the pending feedback job (a link arrived — nothing to hold). Never throws. */
export async function removeFeedbackJobForTask(taskId: string): Promise<void> {
  try {
    const q = getFeedbackQueue();
    await q
      .getJob(feedbackJobIdFor(taskId))
      .then((job) => job?.remove().catch(() => undefined))
      .catch(() => undefined);
  } catch {
    // best-effort
  }
}

function toStored(job: { id?: string; data: FeedbackJobData; timestamp: number; opts: { delay?: number } }): StoredFeedbackJob {
  const d = job.data || ({} as FeedbackJobData);
  return {
    jobId: String(job.id || ''),
    taskId: d.taskId,
    externalTaskId: d.externalTaskId ?? null,
    attempt: d.attempt ?? 1,
    leasedBy: d.leasedBy ?? null,
    leasedAt: d.leasedAt ?? null,
    createdTimestamp: job.timestamp,
    delayMs: job.opts.delay ?? 0,
  };
}

/** Due + unleased jobs, oldest-due first (executor polls this). */
export async function pendingFeedbackJobs(nowMs: number = Date.now()): Promise<StoredFeedbackJob[]> {
  const q = getFeedbackQueue();
  const jobs = await q.getJobs(['waiting', 'delayed']);
  const { pickFeedbackJobs } = await import('../utils/feedback-queue');
  return pickFeedbackJobs(jobs.map(toStored), nowMs);
}

/**
 * Per-tab lease with fire-time re-validation: a task that gained a link,
 * went terminal, or already got its notice refuses the lease and the stale
 * job is removed instead.
 */
export async function leaseFeedbackJob(
  jobId: string,
  tabId: string,
  nowMs: number = Date.now(),
): Promise<{ leased: boolean; reason: string; job?: StoredFeedbackJob }> {
  const q = getFeedbackQueue();
  const job = await q.getJob(jobId).catch(() => null);
  if (!job) return { leased: false, reason: 'job not found (done, replaced, or expired)' };
  const data = (job.data || {}) as FeedbackJobData;
  const stale = !data.leasedBy || !data.leasedAt || nowMs - data.leasedAt > FEEDBACK_LEASE_TIMEOUT_MS;
  if (!stale && data.leasedBy !== tabId) {
    return { leased: false, reason: `held by ${data.leasedBy}` };
  }
  const task = await taskService.findById(data.taskId).catch(() => null);
  const createdAtMs =
    task?.createdAt instanceof Date
      ? task.createdAt.getTime()
      : task?.createdAt
        ? new Date(task.createdAt).getTime()
        : null;
  const decision = decideFeedbackAction(
    {
      status: task?.status,
      assignmentStatus: task?.assignmentStatus ?? null,
      submittedRedditUrl: task?.submittedRedditUrl ?? null,
      deadlineMs: task ? parseDeadlineToMs(task.deadline, task.createdAt) : null,
      feedbackSent: task ? await feedbackAlreadySent(task.id) : true,
      formatCheckStatus: task?.formatCheckStatus ?? null,
      createdAtMs,
    },
    nowMs,
  );
  if (!task || !decision.schedule) {
    await job.remove().catch(() => undefined);
    return { leased: false, reason: `stale: ${!task ? 'task gone' : decision.reason}` };
  }
  await job.updateData({ ...data, leasedBy: tabId, leasedAt: nowMs }).catch(() => undefined);
  return { leased: true, reason: 'leased', job: toStored({ id: job.id, data: { ...data, leasedBy: tabId, leasedAt: nowMs }, timestamp: job.timestamp, opts: job.opts }) };
}

export interface FeedbackResult {
  ok: boolean;
  failureReason?: string | null;
}

/**
 * Handles the executor verdict. Success removes the job + audits (the audit
 * is the one-shot guard). One retry after a transient failure; then gives
 * up: removes the job, audits FAILED, and tags the manager in the ticket so
 * the notice goes out by hand before expiry.
 */
export async function reportFeedbackResult(
  jobId: string,
  result: FeedbackResult,
  discordClient: Client | null,
): Promise<{ recorded: boolean; stale?: boolean; retried?: boolean; gaveUp?: boolean }> {
  const q = getFeedbackQueue();
  const job = await q.getJob(jobId).catch(() => null);
  if (!job) return { recorded: false, stale: true };
  const data = (job.data || {}) as FeedbackJobData;

  if (result.ok) {
    await job.remove().catch(() => undefined);
    await auditLogService
      .log(AuditAction.FEEDBACK_SENT, data.taskId, 'feedback-executor', `Stalling notice sent (task ${data.externalTaskId || data.taskId})`)
      .catch(() => undefined);
    logger.info('Feedback job completed', { jobId, taskId: data.taskId });
    return { recorded: true };
  }

  const reason = result.failureReason || 'executor reported failure';
  const attempt = data.attempt ?? 1;
  if (attempt < FEEDBACK_MAX_ATTEMPTS) {
    await job.remove().catch(() => undefined);
    await q
      .add(
        'send-feedback',
        { ...data, attempt: attempt + 1, leasedBy: null, leasedAt: null } satisfies FeedbackJobData,
        { delay: feedbackRetryDelayFor(), jobId, removeOnComplete: true },
      )
      .catch(() => undefined);
    logger.warn('Feedback job transient failure, retrying', { jobId, taskId: data.taskId, attempt, reason });
    return { recorded: true, retried: true };
  }

  await job.remove().catch(() => undefined);
  await auditLogService
    .log(AuditAction.FEEDBACK_FAILED, data.taskId, 'feedback-executor', `Stalling notice gave up after ${attempt} attempts: ${reason}`)
    .catch(() => undefined);
  logger.warn('Feedback job gave up', { jobId, taskId: data.taskId, attempt, reason });
  if (discordClient) {
    await notifyTicketFeedbackFailed(discordClient, data.taskId, reason).catch(() => undefined);
  }
  return { recorded: true, gaveUp: true };
}

/** Tags the manager in the task's ticket so a failed notice goes out by hand. */
export async function notifyTicketFeedbackFailed(
  discordClient: Client,
  taskId: string,
  reason: string,
): Promise<void> {
  const task = await taskService.findById(taskId).catch(() => null);
  if (!task) return;
  const channel = await discordClient.channels.fetch(task.channelId).catch(() => null);
  if (!(channel instanceof TextChannel)) return;
  const tags = getAdminOrManagerIds()
    .map((id) => `<@${id}>`)
    .join(' ');
  await channel.send(buildFeedbackFailedMessage(task, reason, tags));
}

/** Re-hydrates feedback jobs after restarts. Returns count scheduled. */
export async function rehydrateFeedbackJobs(): Promise<number> {
  let scheduled = 0;
  const rows = await taskRepository.findFeedbackCandidates().catch(() => []);
  for (const row of rows) {
    try {
      const task = toTask(row as any);
      const { scheduled: did } = await scheduleFeedbackForTask(task);
      if (did) scheduled++;
    } catch (error) {
      logger.warn('Feedback re-hydration failed for task (continuing)', { error });
    }
  }
  logger.info('Feedback re-hydration complete', { scheduled });
  return scheduled;
}
