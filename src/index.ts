import { Client } from 'discord.js';
import { initializeQueue, getQueue } from './scheduler/queue';
import { initializeWorker } from './scheduler/worker';
import { createBotClient, startBot } from './bot';
import { createApiServer, startApiServer } from './api/server';
import { logger } from './utils/logger';
import { taskService } from './services/task.service';
import { initializeDatabase } from './database/db';
import { reminderRepository } from './database/repositories';
import { ARCHIVE_AFTER_DAYS, MAX_REMINDER_ATTEMPTS } from './config/constants';
import { scheduleReminderJob, scheduleRetryJob } from './scheduler/jobs';
import { Reminder, ReminderType, TaskStatus } from './types';

// ─── Re-Hydrate Reminders from PostgreSQL ─────────────────

async function rehydrateReminders(): Promise<void> {
  const queue = getQueue();
  let scheduled = 0;

  // 1. Re-hydrate unsent, incomplete reminders (primary jobs)
  const pendingReminders = await reminderRepository.findPending();

  for (const data of pendingReminders) {
    const reminder: Reminder = {
      id: data.id,
      taskId: data.taskId,
      type: data.type as ReminderType,
      dueAt: data.dueAt,
      sent: data.sent,
      completed: data.completed,
      sentAt: data.sentAt,
      completedAt: data.completedAt,
      retryCount: data.retryCount,
      jobId: data.jobId,
      reminderMessageId: data.reminderMessageId,
      insightImageUrl: data.insightImageUrl,
      insightImageName: data.insightImageName,
      insightUploadedAt: data.insightUploadedAt,
    };

    const task = await taskService.findById(reminder.taskId);
    if (!task || task.status === TaskStatus.CANCELLED || task.status === TaskStatus.ARCHIVED || task.cancelledReason !== null) continue;

    const existingJob = await queue.getJob(`reminder-${reminder.id}`);
    if (existingJob) continue;

    await scheduleReminderJob(reminder);
    scheduled++;
  }

  // 2. Re-hydrate sent-but-not-completed reminders (retry jobs)
  const sentReminders = await reminderRepository.findPendingSent();

  for (const data of sentReminders) {
    const reminder: Reminder = {
      id: data.id,
      taskId: data.taskId,
      type: data.type as ReminderType,
      dueAt: data.dueAt,
      sent: data.sent,
      completed: data.completed,
      sentAt: data.sentAt,
      completedAt: data.completedAt,
      retryCount: data.retryCount,
      jobId: data.jobId,
      reminderMessageId: data.reminderMessageId,
      insightImageUrl: data.insightImageUrl,
      insightImageName: data.insightImageName,
      insightUploadedAt: data.insightUploadedAt,
    };

    const task = await taskService.findById(reminder.taskId);
    if (!task || task.status === TaskStatus.CANCELLED || task.status === TaskStatus.ARCHIVED || task.cancelledReason !== null) continue;

    if (reminder.retryCount < MAX_REMINDER_ATTEMPTS) {
      const nextRetry = reminder.retryCount + 1;
      const retryJobId = `retry-${reminder.id}-${nextRetry}`;
      const existingRetry = await queue.getJob(retryJobId);
      if (!existingRetry) {
        await scheduleRetryJob(reminder, nextRetry);
        scheduled++;
      }
    }
  }

  if (scheduled > 0) {
    logger.info(`Re-hydrated ${scheduled} reminder jobs from PostgreSQL`);
  } else {
    logger.info('Reminder re-hydration complete — no orphaned reminders found');
  }
}

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════');
  logger.info('  Reddit Task Manager — Starting up...');
  logger.info('═══════════════════════════════════════════');

  let discordClient: Client;

  try {
    // 1. Initialize PostgreSQL via Prisma
    logger.info('[1/6] Initializing PostgreSQL...');
    initializeDatabase();

    // 2. Initialize Redis + BullMQ Queue
    logger.info('[2/6] Initializing Redis & BullMQ...');
    initializeQueue();

    // 3. Create and start Discord bot
    logger.info('[3/6] Starting Discord bot...');
    discordClient = createBotClient();
    await startBot(discordClient);

    // 4. Initialize BullMQ Worker (needs Discord client for sending messages)
    logger.info('[4/6] Initializing BullMQ worker...');
    initializeWorker(discordClient);

    // 5. Re-hydrate reminder jobs from PostgreSQL (recover from Redis/bot restarts)
    logger.info('[5/6] Re-hydrating reminder jobs...');
    await rehydrateReminders();

    // 6. Start REST API server
    logger.info('[6/6] Starting REST API server...');
    const apiApp = createApiServer(discordClient);
    startApiServer(apiApp);

    logger.info('═══════════════════════════════════════════');
    logger.info('  ✅ All systems online!');
    logger.info('═══════════════════════════════════════════');

  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Fatal startup error: ${error.message}`, { stack: error.stack });
    } else {
      logger.error('Fatal startup error', { error: String(error) });
    }
    process.exit(1);
  }

  // ─── Auto-Archive Schedule ─────────────────────────────────

  const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const archiveInterval = setInterval(async () => {
    try {
      const thresholdDate = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
      const archived = await taskService.archiveOld(thresholdDate);
      if (archived > 0) {
        logger.info(`Auto-archived ${archived} old tasks`);
      }
    } catch (error) {
      logger.error('Auto-archive failed', { error });
    }
  }, ARCHIVE_INTERVAL_MS);

  // Run the first archive 1 hour after startup (don't immediately hammer Firestore)
  setTimeout(async () => {
    try {
      const thresholdDate = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
      await taskService.archiveOld(thresholdDate);
    } catch (error) {
      logger.error('Initial auto-archive failed', { error });
    }
  }, 60 * 60 * 1000);

  logger.info(`Auto-archive checks daily for tasks older than ${ARCHIVE_AFTER_DAYS} days`);

  // ─── Sunday Archive Schedule ─────────────────────────────────

  function msUntilNextSunday(): number {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()) % 7);
    nextSunday.setUTCHours(0, 0, 0, 0);
    if (nextSunday <= now) {
      nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    }
    return nextSunday.getTime() - now.getTime();
  }

  async function runSundayArchive(): Promise<void> {
    try {
      const archived = await taskService.archiveAllCompleted();
      if (archived > 0) {
        logger.info(`Sunday archive: moved ${archived} completed tasks to ARCHIVED`);
      }
    } catch (error) {
      logger.error('Sunday archive failed', { error });
    }
    setTimeout(runSundayArchive, msUntilNextSunday());
  }

  // Start the Sunday archive cycle after a 1-hour delay on startup
  setTimeout(() => {
    setTimeout(runSundayArchive, msUntilNextSunday());
    logger.info('Sunday archive scheduled (weekly, moves all COMPLETED → ARCHIVED)');
  }, 60 * 60 * 1000);

  // ─── Insight Image Cleanup (60-hour TTL) ────────────────────

  const INSIGHT_CLEANUP_INTERVAL = 60 * 60 * 1000;

  const insightCleanupInterval = setInterval(async () => {
    try {
      const { insightStorageService } = await import('./services/insight-storage.service');
      const deleted = await insightStorageService.cleanup();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired insight images`);
      }
    } catch (error) {
      logger.error('Insight image cleanup failed', { error });
    }
  }, INSIGHT_CLEANUP_INTERVAL);

  // ─── Periodic Reminder Reconciliation (every 30 min) ────────

  const REHYDRATE_INTERVAL_MS = 30 * 60 * 1000;

  const rehydrateInterval = setInterval(async () => {
    try {
      await rehydrateReminders();
    } catch (error) {
      logger.error('Periodic reminder re-hydration failed', { error });
    }
  }, REHYDRATE_INTERVAL_MS);

  logger.info('Reminder reconciliation scheduled (every 30 minutes)');

  // ─── Graceful Shutdown ──────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);

    try {
      clearInterval(archiveInterval);
      clearInterval(insightCleanupInterval);
      clearInterval(rehydrateInterval);

      discordClient.destroy();
      logger.info('Discord client destroyed');

      const { closeQueue } = await import('./scheduler/queue');
      const { closeWorker } = await import('./scheduler/worker');

      await closeWorker();
      await closeQueue();

      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    process.exit(1);
  });
}

main();
