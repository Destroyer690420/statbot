/**
 * Server-side delivery pipeline — BullMQ queue + rehydration.
 *
 * The queue holds delivery jobs ONLY (stable id `deliver-<taskId>`,
 * latest-wins). The worker lives in scheduler/delivery-worker.ts (it needs
 * the Discord client). Retries are explicit, never automatic: a throw inside
 * the worker marks the task FAILED exactly like the old synchronous path,
 * and the dashboard Retry path stays the recovery.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { DELIVERY_QUEUE_NAME } from '../config/constants';
import { DeliveryJobData } from '../types';
import { deliveryJobIdFor } from '../utils/delivery-queue';
import { taskRepository } from '../database/repositories';
import { logger } from '../utils/logger';

let queue: Queue<DeliveryJobData> | null = null;
let connection: IORedis | null = null;

export function initializeDeliveryQueue(): Queue<DeliveryJobData> {
  if (queue) return queue;
  connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on('error', (err) => logger.error('Delivery Redis error', { error: err.message }));
  queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 50 }, attempts: 1 },
  });
  logger.info('Delivery queue initialized', { name: DELIVERY_QUEUE_NAME });
  return queue;
}

export function getDeliveryQueue(): Queue<DeliveryJobData> {
  if (!queue) throw new Error('Delivery queue not initialized. Call initializeDeliveryQueue() first.');
  return queue;
}

export async function closeDeliveryQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  queue = null;
  connection = null;
}

export { deliveryJobIdFor };

/**
 * Enqueues (or replaces) the delivery job for a task. The stable id makes
 * re-enqueues idempotent: a queued twin is replaced, never doubled.
 */
export async function enqueueDelivery(taskId: string): Promise<void> {
  const q = getDeliveryQueue();
  const jobId = deliveryJobIdFor(taskId);
  const old = await q.getJob(jobId).catch(() => null);
  if (old) await old.remove().catch(() => undefined);
  await q.add('deliver-task', { taskId } satisfies DeliveryJobData, { jobId, removeOnComplete: true });
}

/** Drops a queued delivery (reassign takes over synchronously). Never throws. */
export async function removeDeliveryJob(taskId: string): Promise<void> {
  try {
    const q = getDeliveryQueue();
    await q
      .getJob(deliveryJobIdFor(taskId))
      .then((job) => job?.remove().catch(() => undefined))
      .catch(() => undefined);
  } catch {
    // best-effort
  }
}

/**
 * Re-hydrates stuck deliveries: PENDING-delivery rows with no live delivery.
 * Boot passes 0 (nothing delivers during boot — every such row is stuck);
 * the periodic sweep passes DELIVERY_STUCK_AFTER_MS so live synchronous
 * deliveries (retry/reassign, seconds-long) are never disturbed.
 */
export async function rehydrateDeliveryJobs(stuckAfterMs: number): Promise<number> {
  let scheduled = 0;
  const cutoff = new Date(Date.now() - stuckAfterMs);
  const rows = await taskRepository.findStuckDeliveries(cutoff).catch(() => []);
  for (const row of rows) {
    try {
      await enqueueDelivery((row as { id: string }).id);
      scheduled++;
    } catch (error) {
      logger.warn('Delivery re-hydration failed for task (continuing)', { error });
    }
  }
  logger.info('Delivery re-hydration complete', { scheduled });
  return scheduled;
}
