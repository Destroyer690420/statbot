import { Worker, Job } from 'bullmq';
import { Client } from 'discord.js';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { SURVIVAL_QUEUE_NAME } from '../config/constants';
import { SurvivalJobData } from '../types';
import { runSurvivalCapture, notifyAdminsSurvivalFailed } from '../services/survival.service';
import { logger } from '../utils/logger';

let worker: Worker<SurvivalJobData> | null = null;

/**
 * BullMQ worker for 10-minute survival screenshots. Concurrency is low on
 * purpose: each job launches Chromium and renders the full Reddit page.
 */
export function initializeSurvivalWorker(discordClient: Client): Worker<SurvivalJobData> {
  if (worker) return worker;

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });

  worker = new Worker<SurvivalJobData>(
    SURVIVAL_QUEUE_NAME,
    async (job: Job<SurvivalJobData>) => {
      const { taskId, redditUrl, attempt } = job.data;
      logger.info('Processing survival job', { taskId, attempt });
      await runSurvivalCapture(taskId, redditUrl, attempt, async (failedTaskId, label) => {
        await notifyAdminsSurvivalFailed(discordClient, failedTaskId, label);
      });
    },
    { connection: connection as any, concurrency: 2 },
  );

  worker.on('failed', (job, error) => {
    logger.error('Survival job failed', { jobId: job?.id, error: error.message });
  });
  worker.on('error', (error) => {
    logger.error('Survival worker error', { error: error.message });
  });

  logger.info('Survival worker initialized');
  return worker;
}

export async function closeSurvivalWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Survival worker closed');
  }
}
