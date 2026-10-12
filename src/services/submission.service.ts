/**
 * GoPartTime link auto-submit — BullMQ schedule/lease store + result handling.
 *
 * The queue holds jobs ONLY (no server worker ever pops them: the datacenter
 * IP is Vercel-blocked, so just the manager-browser executor tab can do
 * GoPartTime I/O). The tab polls GET /submit-jobs/pending, leases one job,
 * submits in-page, and reports back. Mirrors the survival-queue wiring
 * (own queue, stable job ids, +2/+5min retries, dashboard retry).
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Client, TextChannel } from 'discord.js';
import { env } from '../config/env';
import { SUBMISSION_QUEUE_NAME, SUBMISSION_LEASE_TIMEOUT_MS } from '../config/constants';
import { SubmissionJobData, Task, AuditAction } from '../types';
import {
  decideSubmissionAction,
  maxAttemptsReached,
  pickSubmittableJobs,
  retryDelayFor,
  submissionJobIdFor,
  StoredSubmissionJob,
} from '../utils/submission-queue';
import { taskService } from './task.service';
import { auditLogService } from './audit.service';
import { getAdminOrManagerIds } from '../utils/permissions';
import { buildSubmissionFailedMessage } from '../utils/submission-reply';
import { logger } from '../utils/logger';

let queue: Queue<SubmissionJobData> | null = null;
let connection: IORedis | null = null;

export function initializeSubmissionQueue(): Queue<SubmissionJobData> {
  if (queue) return queue;
  connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on('error', (err) => logger.error('Submission Redis error', { error: err.message }));
  queue = new Queue<SubmissionJobData>(SUBMISSION_QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 50 }, attempts: 1 },
  });
  logger.info('Submission queue initialized', { name: SUBMISSION_QUEUE_NAME });
  return queue;
}

export function getSubmissionQueue(): Queue<SubmissionJobData> {
  if (!queue) throw new Error('Submission queue not initialized. Call initializeSubmissionQueue() first.');
  return queue;
}

export async function closeSubmissionQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  queue = null;
  connection = null;
}

/**
 * Enqueues (or replaces) the submit job for a task. Latest submission wins:
 * any pending job for the task is removed first. Gate failures remove the
 * stale job and enqueue nothing. Never throws — submissions must not break.
 */
export async function enqueueSubmissionJob(task: Task): Promise<{ enqueued: boolean; reason: string }> {
  try {
    const q = getSubmissionQueue();
    const jobId = submissionJobIdFor(task.id);
    const old = await q.getJob(jobId).catch(() => null);
    if (old) await old.remove().catch(() => undefined);
    const decision = decideSubmissionAction({
      taskType: task.type,
      formatCheckStatus: task.formatCheckStatus,
      submittedRedditUrl: task.submittedRedditUrl,
    });
    if (!decision.enqueue) {
      logger.info('Submission job skipped (manager review)', { taskId: task.id, reason: decision.reason });
      return { enqueued: false, reason: decision.reason };
    }
    await q.add(
      'submit-link',
      {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        submittedRedditUrl: (task.submittedRedditUrl as string).trim(),
        submittedAtISO: task.submittedAt ? task.submittedAt.toISOString() : null,
        attempt: 1,
        leasedBy: null,
        leasedAt: null,
      } satisfies SubmissionJobData,
      { delay: decision.delayMs, jobId, removeOnComplete: true },
    );
    logger.info('Submission job scheduled', { taskId: task.id, delayMs: decision.delayMs });
    return { enqueued: true, reason: decision.reason };
  } catch (error) {
    logger.warn('Submission enqueue failed (non-fatal)', {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { enqueued: false, reason: 'enqueue failed' };
  }
}

function toStored(job: { id?: string; data: SubmissionJobData; timestamp: number; opts: { delay?: number } }): StoredSubmissionJob {
  const d = job.data || ({} as SubmissionJobData);
  return {
    jobId: String(job.id || ''),
    taskId: d.taskId,
    externalTaskId: d.externalTaskId ?? null,
    submittedRedditUrl: d.submittedRedditUrl,
    attempt: d.attempt ?? 1,
    leasedBy: d.leasedBy ?? null,
    leasedAt: d.leasedAt ?? null,
    createdTimestamp: job.timestamp,
    delayMs: job.opts.delay ?? 0,
  };
}

/** Due + unleased jobs, oldest-due first (executor polls this). */
export async function pendingSubmissionJobs(nowMs: number = Date.now()): Promise<StoredSubmissionJob[]> {
  const q = getSubmissionQueue();
  const jobs = await q.getJobs(['waiting', 'delayed']);
  return pickSubmittableJobs(jobs.map(toStored), nowMs);
}

/**
 * Per-tab lease on a job (separate lease from accept-claims — never the
 * AutomationClaim table). Own-lease re-take allowed; a fresh foreign lease
 * rejects with 409 semantics for the caller.
 */
export async function leaseSubmissionJob(
  jobId: string,
  tabId: string,
  nowMs: number = Date.now(),
): Promise<{ leased: boolean; reason: string; job?: StoredSubmissionJob }> {
  const q = getSubmissionQueue();
  const job = await q.getJob(jobId).catch(() => null);
  if (!job) return { leased: false, reason: 'job not found (done, replaced, or expired)' };
  const data = (job.data || {}) as SubmissionJobData;
  const stale = !data.leasedBy || !data.leasedAt || nowMs - data.leasedAt > SUBMISSION_LEASE_TIMEOUT_MS;
  if (!stale && data.leasedBy !== tabId) {
    return { leased: false, reason: `held by ${data.leasedBy}` };
  }
  await job.updateData({ ...data, leasedBy: tabId, leasedAt: nowMs }).catch(() => undefined);
  return { leased: true, reason: 'leased', job: toStored({ id: job.id, data: { ...data, leasedBy: tabId, leasedAt: nowMs }, timestamp: job.timestamp, opts: job.opts }) };
}

export interface SubmissionResult {
  ok: boolean;
  failureReason?: string | null;
}

/**
 * Handles the executor verdict. Success removes the job + audits. Transient
 * failure re-queues at +2/+5min (max 3 attempts); then gives up: removes the
 * job, audits FAILED, and tags the manager in the ticket (same as a format
 * mismatch — a human takes it from here).
 */
export async function reportSubmissionResult(
  jobId: string,
  result: SubmissionResult,
  discordClient: Client | null,
): Promise<{ recorded: boolean; stale?: boolean; retried?: boolean; gaveUp?: boolean }> {
  const q = getSubmissionQueue();
  const job = await q.getJob(jobId).catch(() => null);
  if (!job) return { recorded: false, stale: true };
  const data = (job.data || {}) as SubmissionJobData;

  if (result.ok) {
    await job.remove().catch(() => undefined);
    await auditLogService
      .log(AuditAction.GPT_LINK_SUBMITTED, data.taskId, 'submit-executor', `GoPartTime link auto-submitted (task ${data.externalTaskId || data.taskId})`)
      .catch(() => undefined);
    logger.info('Submission job completed', { jobId, taskId: data.taskId });
    return { recorded: true };
  }

  const reason = result.failureReason || 'executor reported failure';
  const attempt = data.attempt ?? 1;
  if (!maxAttemptsReached(attempt)) {
    const delayMs = retryDelayFor(attempt);
    await job.remove().catch(() => undefined);
    await q
      .add(
        'submit-link',
        { ...data, attempt: attempt + 1, leasedBy: null, leasedAt: null } satisfies SubmissionJobData,
        { delay: delayMs, jobId, removeOnComplete: true },
      )
      .catch(() => undefined);
    logger.warn('Submission job transient failure, retrying', { jobId, taskId: data.taskId, attempt, delayMs, reason });
    return { recorded: true, retried: true };
  }

  await job.remove().catch(() => undefined);
  await auditLogService
    .log(AuditAction.GPT_LINK_SUBMIT_FAILED, data.taskId, 'submit-executor', `GoPartTime link auto-submit gave up after ${attempt} attempts: ${reason}`)
    .catch(() => undefined);
  logger.warn('Submission job gave up', { jobId, taskId: data.taskId, attempt, reason });
  if (discordClient) {
    await notifyTicketSubmissionFailed(discordClient, data.taskId, reason).catch(() => undefined);
  }
  return { recorded: true, gaveUp: true };
}

/** Tags the manager in the task's ticket so a failed job gets human review.
 * Worker-visible: never names the external task site. */
export async function notifyTicketSubmissionFailed(
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
  await channel.send(buildSubmissionFailedMessage(task, reason, tags));
}

/**
 * Manual retry from the dashboard (mirrors Retry Capture on survival proofs).
 * Re-gates the task — a still-mismatched link stays manual-only.
 */
export async function retrySubmissionNow(taskId: string): Promise<{ enqueued: boolean; reason: string }> {
  const task = await taskService.findById(taskId);
  if (!task) throw new Error('Task not found.');
  if (!task.submittedRedditUrl) throw new Error('No submitted URL to submit yet.');
  return enqueueSubmissionJob(task);
}
