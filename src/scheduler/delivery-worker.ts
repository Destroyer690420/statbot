import { Worker, Job } from 'bullmq';
import { Client } from 'discord.js';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { DELIVERY_JOB_CONCURRENCY, DELIVERY_QUEUE_NAME } from '../config/constants';
import { DeliveryJobData } from '../types';
import { logger } from '../utils/logger';

let worker: Worker<DeliveryJobData> | null = null;

/**
 * BullMQ worker for ticket deliveries. Independent tickets deliver in
 * parallel (concurrency cap keeps Discord 429s quiet); each run is
 * checkpointed against its task row and stands down the moment a newer flow
 * (reassign) owns the task. A throw marks FAILED exactly like the old
 * synchronous path — no automatic retries (the dashboard Retry path stays
 * the recovery, same as today).
 */
export function initializeDeliveryWorker(discordClient: Client): Worker<DeliveryJobData> {
  if (worker) return worker;

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });

  worker = new Worker<DeliveryJobData>(
    DELIVERY_QUEUE_NAME,
    async (job: Job<DeliveryJobData>) => {
      const { taskId } = job.data;
      logger.info('Processing delivery job', { taskId });
      const { goparttimeService } = await import('../services/goparttime.service');
      const outcome = await goparttimeService.deliverPendingTask(taskId, discordClient);
      logger.info('Delivery job finished', { taskId, delivered: outcome.delivered, reason: outcome.reason });
    },
    { connection: connection as any, concurrency: DELIVERY_JOB_CONCURRENCY },
  );

  worker.on('failed', (job, error) => {
    logger.error('Delivery job failed', { jobId: job?.id, error: error.message });
  });
  worker.on('error', (error) => {
    logger.error('Delivery worker error', { error: error.message });
  });

  logger.info('Delivery worker initialized');
  return worker;
}

export async function closeDeliveryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Delivery worker closed');
  }
}
