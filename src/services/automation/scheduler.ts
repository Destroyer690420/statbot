import { Client } from 'discord.js';
import { automationRepository } from '../../database/repositories';
import { AUTOMATION } from '../../config/constants';
import { logger } from '../../utils/logger';
import { runCycle } from './cycle.service';
import { processSightingQueue } from './queue.service';
import { expireContacts } from './worker-manager.service';

let timer: NodeJS.Timeout | null = null;
let queueTimer: NodeJS.Timeout | null = null;
let lastSlotKey: string | null = null;

function slotKey(now: Date): string {
  const h = now.getHours();
  const m = now.getMinutes();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${h}:${m}`;
}

/**
 * Oracle-safe scheduler: ticks every 30s, fires at most once per
 * minute-slot in SCAN_MINUTES (0,10,11,20,30,40,50) with human jitter.
 * 7 scans/hour total. Expires timed-out contacts every tick.
 * Plus the hybrid companion queue tick (60s): sighting-driven cycles where
 * the manager's browser does all GoPartTime I/O (server never fetches).
 */
export function startAutomationScheduler(discordClient: Client): void {
  if (timer) return;
  logger.info('Automation scheduler started', { minutes: [...AUTOMATION.SCAN_MINUTES] });
  timer = setInterval(async () => {
    try {
      await expireContacts().catch(() => undefined);
      const settings = await automationRepository.getSettings().catch(() => null);
      if (!settings?.enabled || !settings?.pollEnabled) return;

      const now = new Date();
      if (!(AUTOMATION.SCAN_MINUTES as readonly number[]).includes(now.getMinutes())) return;
      const key = slotKey(now);
      if (lastSlotKey === key) return;
      lastSlotKey = key;

      const mandatory = now.getMinutes() === 10 || now.getMinutes() === 11;
      const jitter = Math.floor(
        Math.random() * (mandatory ? AUTOMATION.MANDATORY_JITTER_MS : AUTOMATION.ROUTINE_JITTER_MS),
      );
      logger.info('Automation scan scheduled', { slot: key, jitterMs: jitter });
      setTimeout(() => {
        runCycle(discordClient).catch((e) => logger.error('Scheduled cycle failed', { error: e }));
      }, jitter);
    } catch (error) {
      logger.error('Automation scheduler tick failed', { error });
    }
  }, 30 * 1000);

  if (!queueTimer) {
    queueTimer = setInterval(async () => {
      try {
        await processSightingQueue(discordClient).catch((e) =>
          logger.error('Sighting queue tick failed', { error: e }),
        );
      } catch (error) {
        logger.error('Sighting queue tick failed', { error });
      }
    }, 60 * 1000);
    logger.info('Automation sighting queue started (60s tick)');
  }
}

export function stopAutomationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (queueTimer) {
    clearInterval(queueTimer);
    queueTimer = null;
  }
}
