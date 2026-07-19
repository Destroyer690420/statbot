import { Client } from 'discord.js';
import { initializeFirebase } from './database/firebase';
import { initializeQueue } from './scheduler/queue';
import { initializeWorker } from './scheduler/worker';
import { createBotClient, startBot } from './bot';
import { createApiServer, startApiServer } from './api/server';
import { logger } from './utils/logger';
import { taskService } from './services/task.service';
import { ARCHIVE_AFTER_DAYS } from './config/constants';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════');
  logger.info('  Reddit Task Manager — Starting up...');
  logger.info('═══════════════════════════════════════════');

  let discordClient: Client;

  try {
    // 1. Initialize Firebase
    logger.info('[1/5] Initializing Firebase...');
    initializeFirebase();

    // 2. Initialize Redis + BullMQ Queue
    logger.info('[2/5] Initializing Redis & BullMQ...');
    initializeQueue();

    // 3. Create and start Discord bot
    logger.info('[3/5] Starting Discord bot...');
    discordClient = createBotClient();
    await startBot(discordClient);

    // 4. Initialize BullMQ Worker (needs Discord client for sending messages)
    logger.info('[4/5] Initializing BullMQ worker...');
    initializeWorker(discordClient);

    // 5. Start REST API server
    logger.info('[5/5] Starting REST API server...');
    const apiApp = createApiServer();
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

  // ─── Graceful Shutdown ──────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);

    try {
      clearInterval(archiveInterval);

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
