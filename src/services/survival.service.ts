import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Client } from 'discord.js';
import { env } from '../config/env';
import {
  SURVIVAL_QUEUE_NAME,
  SURVIVAL_RETRY_DELAYS_MS,
  SURVIVAL_MAX_ATTEMPTS,
} from '../config/constants';
import { SurvivalJobData, SurvivalStatus, TaskStatus, TaskType, AuditAction } from '../types';
import {
  survivalJobIdFor,
  survivalDueAt,
  resolveSurvivalUrl,
  mapSurvivalError,
} from '../utils/survival-proof';
import { taskRepository } from '../database/repositories';
import { toTask } from '../database/converters';
import { taskService } from './task.service';
import { survivalStorageService } from './survival-storage.service';
import { captureSurvivalScreenshot } from './survival-screenshot.service';
import { auditLogService } from './audit.service';
import { getAdminOrManagerIds } from '../utils/permissions';
import { logger } from '../utils/logger';

let queue: Queue<SurvivalJobData> | null = null;
let connection: IORedis | null = null;

export function initializeSurvivalQueue(): Queue<SurvivalJobData> {
  if (queue) return queue;
  connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on('error', (err) => logger.error('Survival Redis error', { error: err.message }));
  queue = new Queue<SurvivalJobData>(SURVIVAL_QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 50 }, attempts: 1 },
  });
  logger.info('Survival queue initialized', { name: SURVIVAL_QUEUE_NAME });
  return queue;
}

export function getSurvivalQueue(): Queue<SurvivalJobData> {
  if (!queue) throw new Error('Survival queue not initialized. Call initializeSurvivalQueue() first.');
  return queue;
}

export async function closeSurvivalQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  queue = null;
  connection = null;
}

export { survivalJobIdFor, survivalDueAt, resolveSurvivalUrl };

export async function scheduleSurvivalJob(taskId: string, redditUrl: string, dueAt: Date, attempt = 1): Promise<string> {
  const q = getSurvivalQueue();
  const delay = Math.max(0, dueAt.getTime() - Date.now());
  const jobId = attempt === 1 ? survivalJobIdFor(taskId) : `${survivalJobIdFor(taskId)}-r${attempt}`;
  await q.add(`survival-capture`, { taskId, redditUrl, attempt } satisfies SurvivalJobData, {
    delay,
    jobId,
    removeOnComplete: true,
  });
  if (attempt === 1) {
    await taskRepository.updateSurvivalJobId(taskId, jobId).catch(() => undefined);
  }
  logger.info('Survival job scheduled', { taskId, attempt, dueAt: dueAt.toISOString(), delayMs: delay });
  return jobId;
}

export async function cancelSurvivalJob(taskId: string): Promise<void> {
  try {
    const q = getSurvivalQueue();
    const task = await taskService.findById(taskId);
    const ids = new Set<string>([survivalJobIdFor(taskId)]);
    if (task?.survivalJobId) ids.add(task.survivalJobId);
    for (let a = 2; a <= SURVIVAL_MAX_ATTEMPTS; a++) ids.add(`${survivalJobIdFor(taskId)}-r${a}`);
    for (const id of ids) {
      try {
        const job = await q.getJob(id);
        if (job) await job.remove();
      } catch {
        // best-effort
      }
    }
  } catch (error) {
    logger.warn('Failed to cancel survival job', { taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * (Re)starts the 11-min timer. POST only. Called from recordSubmission
 * (GoPartTime, latest URL wins) and from manual task creation.
 */
export async function scheduleSurvivalForTask(taskId: string): Promise<void> {
  const task = await taskService.findById(taskId);
  if (!task || task.type !== TaskType.POST) return;
  if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.ARCHIVED || task.cancelledReason !== null) return;
  const url = resolveSurvivalUrl(task);
  if (!url) return;
  await cancelSurvivalJob(taskId);
  await taskRepository.resetSurvival(taskId).catch(() => undefined);
  const anchor = task.submittedAt ?? task.createdAt;
  await scheduleSurvivalJob(taskId, url, survivalDueAt(anchor), 1);
}

/** Re-hydrates overdue/missing survival jobs after restarts. Returns count scheduled. */
export async function rehydrateSurvivalJobs(): Promise<number> {
  let scheduled = 0;
  const rows = await taskRepository.findSurvivalPending().catch(() => []);
  const now = Date.now();
  for (const row of rows) {
    try {
      const task = toTask(row as any);
      if (task.type !== TaskType.POST) continue;
      const url = resolveSurvivalUrl(task);
      if (!url) continue;
      const anchor = task.submittedAt ?? task.createdAt;
      // Tasks older than 24h predate the proof window — leave them without
      // proof instead of capturing a meaningless "now" screenshot.
      if (now - anchor.getTime() > 24 * 60 * 60 * 1000) continue;
      const q = getSurvivalQueue();
      const existing = await q.getJob(survivalJobIdFor(task.id)).catch(() => null);
      if (existing) continue;
      if (!task.survivalStatus) {
        await taskRepository.resetSurvival(task.id).catch(() => undefined);
      }
      const dueAt = survivalDueAt(anchor);
      await scheduleSurvivalJob(task.id, url, dueAt < new Date() ? new Date() : dueAt, 1);
      scheduled++;
    } catch (error) {
      logger.warn('Survival re-hydration skipped a task', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (scheduled > 0) logger.info(`Re-hydrated ${scheduled} survival jobs`);
  return scheduled;
}

/** Re-exported for callers; pure logic lives in utils/survival-proof (env-free). */
export function mapCaptureError(error: unknown): { status: SurvivalStatus; retryable: boolean; label: string } {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return mapSurvivalError(name, message);
}

/**
 * Runs one capture attempt. Stale jobs (URL since replaced) no-op so a
 * resubmission never overwrites the new PENDING with an old screenshot.
 */
export async function runSurvivalCapture(
  taskId: string,
  redditUrl: string,
  attempt: number,
  notify?: (taskId: string, label: string) => Promise<void>,
): Promise<void> {
  const task = await taskService.findById(taskId);
  if (!task) {
    logger.warn('Survival capture skipped: task gone', { taskId });
    return;
  }
  if (task.type !== TaskType.POST) return;
  if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.ARCHIVED || task.cancelledReason !== null) {
    logger.info('Survival capture skipped: task no longer active', { taskId });
    return;
  }
  const current = resolveSurvivalUrl(task);
  if (!current || current !== redditUrl.trim()) {
    logger.info('Survival capture skipped: stale URL (resubmitted since)', { taskId });
    return;
  }
  if (task.survivalStatus && task.survivalStatus !== 'PENDING') {
    logger.info('Survival capture skipped: already recorded', { taskId, status: task.survivalStatus });
    return;
  }

  try {
    const { buffer, verdict } = await captureSurvivalScreenshot(redditUrl);
    const saved = await survivalStorageService.save(taskId, attempt, buffer);
    await taskRepository.saveSurvivalProof(taskId, {
      status: verdict,
      imageUrl: saved.url,
      imageName: saved.filename,
    });
    await auditLogService
      .log(AuditAction.SURVIVAL_PROOF_CAPTURED, taskId, null, `10-min survival proof captured (${verdict})`)
      .catch(() => undefined);
    logger.info('Survival proof captured', { taskId, verdict });
  } catch (error) {
    const mapped = mapCaptureError(error);
    const canRetry = mapped.retryable && attempt < SURVIVAL_MAX_ATTEMPTS && attempt <= SURVIVAL_RETRY_DELAYS_MS.length;
    if (canRetry) {
      const delayMs = SURVIVAL_RETRY_DELAYS_MS[attempt - 1] ?? SURVIVAL_RETRY_DELAYS_MS[0];
      logger.warn('Survival capture transient failure, retrying', { taskId, attempt, delayMs, label: mapped.label });
      await scheduleSurvivalJob(taskId, redditUrl, new Date(Date.now() + delayMs), attempt + 1);
      return;
    }
    await taskRepository
      .saveSurvivalProof(taskId, { status: mapped.status, imageUrl: null, imageName: null, error: mapped.label })
      .catch(() => undefined);
    await auditLogService
      .log(AuditAction.SURVIVAL_PROOF_FAILED, taskId, null, `10-min survival proof failed (${mapped.status}): ${mapped.label}`)
      .catch(() => undefined);
    logger.warn('Survival proof failed', { taskId, status: mapped.status, label: mapped.label });
    if (notify) {
      await notify(taskId, mapped.label).catch((e) =>
        logger.warn('Survival failure DM failed', { taskId, error: e instanceof Error ? e.message : String(e) }),
      );
    }
  }
}

/**
 * Manual recapture from the dashboard (after fixing the session, or when the
 * automatic attempt was blocked). Captures immediately: a post alive now
 * necessarily survived its first 10 minutes, so the proof stays valid.
 */
export async function retrySurvivalNow(taskId: string): Promise<void> {
  const task = await taskService.findById(taskId);
  if (!task) throw new Error('Task not found.');
  if (task.type !== TaskType.POST) throw new Error('Survival proof is for POST tasks only.');
  const url = resolveSurvivalUrl(task);
  if (!url) throw new Error('No submitted URL to capture yet.');
  await cancelSurvivalJob(taskId);
  await taskRepository.resetSurvival(taskId);
  await scheduleSurvivalJob(taskId, url, new Date(), 1);
}

/** Discord DM to admins/managers when the proof hard-fails (user asked for this). */
export async function notifyAdminsSurvivalFailed(client: Client, taskId: string, label: string): Promise<void> {
  const task = await taskService.findById(taskId).catch(() => null);
  const url = task ? resolveSurvivalUrl(task) : null;
  const text =
    `⚠️ Survival screenshot failed for task \`${taskId}\`` +
    (url ? ` (<${url}>)` : '') +
    `: ${label}. Open the task in the dashboard to retry.`;
  for (const adminId of getAdminOrManagerIds()) {
    try {
      const user = await client.users.fetch(adminId);
      await user.send(text);
    } catch (error) {
      logger.warn('Survival failure DM failed for admin', {
        adminId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
