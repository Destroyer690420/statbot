import { Worker, Job } from 'bullmq';
import { Client } from 'discord.js';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { NUDGE_QUEUE_NAME } from '../config/constants';
import { NudgeJobData } from '../types';
import { processEscalation, processNudge } from '../services/nudge.service';
import { logger } from '../utils/logger';

let worker: Worker<NudgeJobData> | null = null;

/**
 * BullMQ worker for post-link nudges. Lightweight (one Discord send per
 * job at most); concurrency is modest so a backlog of reminders can never
 * starve blast sends sharing the same bot token.
 */
export function initializeNudgeWorker(discordClient: Client): Worker<NudgeJobData> {
  if (worker) return worker;

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });

  worker = new Worker<NudgeJobData>(
    NUDGE_QUEUE_NAME,
    async (job: Job<NudgeJobData>) => {
      const { taskId, stage } = job.data;
      logger.info('Processing nudge job', { taskId, stage });
      if (stage === 'escalate') {
        await processEscalation(taskId, discordClient);
      } else {
        await processNudge(taskId, discordClient);
      }
    },
    { connection: connection as any, concurrency: 5 },
  );

  worker.on('failed', (job, error) => {
    logger.error('Nudge job failed', { jobId: job?.id, error: error.message });
  });
  worker.on('error', (error) => {
    logger.error('Nudge worker error', { error: error.message });
  });

  logger.info('Nudge worker initialized');
  return worker;
}

export async function closeNudgeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Nudge worker closed');
  }
}
