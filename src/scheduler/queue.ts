import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { QUEUE_NAME } from '../config/constants';
import { logger } from '../utils/logger';
import { ReminderJobData } from '../types';

let connection: IORedis;
let queue: Queue<ReminderJobData>;

/**
 * Initialize the Redis connection and BullMQ queue.
 */
export function initializeQueue(): Queue<ReminderJobData> {
  if (queue) return queue;

  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on('connect', () => {
    logger.info('Redis connected');
  });

  connection.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  queue = new Queue<ReminderJobData>(QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  });

  logger.info('BullMQ queue initialized', { name: QUEUE_NAME });
  return queue;
}

/**
 * Get the BullMQ queue instance.
 */
export function getQueue(): Queue<ReminderJobData> {
  if (!queue) {
    throw new Error('Queue not initialized. Call initializeQueue() first.');
  }
  return queue;
}

/**
 * Get the Redis connection instance.
 */
export function getRedisConnection(): IORedis {
  if (!connection) {
    throw new Error('Redis not initialized. Call initializeQueue() first.');
  }
  return connection;
}

/**
 * Check if Redis connection is healthy.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await connection.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Gracefully close the queue and connection.
 */
export async function closeQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
  logger.info('Queue and Redis connection closed');
}
