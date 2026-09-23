/**
 * Hourly auto-scan: at IST xx:10:05 every hour the server creates an
 * on-demand scan request through the same shared trigger as the DM-text
 * "scan" (requestScanCommand). Tabs cannot tell the difference: they scan,
 * report, and the per-request digest DM arrives labeled as scheduled.
 * The automatic hourly round is untouched — both DMs arrive by design.
 *
 * Timing is a self-rescheduling setTimeout chain (no cron dependency):
 * ms-until-next-IST-:10:05, exactly-once per IST hour key, recomputed
 * after every fire and on boot. IST has no DST; the offset is fixed.
 * Gated on the automation master switch (enabled && pollEnabled).
 */
import { automationRepository } from '../../database/repositories';
import { logger } from '../../utils/logger';
import {
  HOURLY_SCAN_ID,
  planNextHourlyScan,
} from './hourly-scan-plan';
import {
  isConsumedRequest,
  isScanRetry,
  pendingRequest,
  requestScanCommand,
} from './scan-request.service';

/** Watchdog: an unconsumed scheduled request means the tabs are down. */
const UNCONSUMED_WARN_MS = 3 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let lastKey: string | null = null;

async function fire(key: string): Promise<void> {
  if (lastKey === key) return;
  lastKey = key;
  try {
    const settings = await automationRepository.getSettings().catch(() => null);
    if (!settings?.enabled || !settings?.pollEnabled) {
      logger.info('Hourly scan skipped (automation off)', { key });
      return;
    }
    const result = requestScanCommand(HOURLY_SCAN_ID);
    if (isScanRetry(result)) {
      logger.info('Hourly scan skipped (cooldown)', { key, retryAfterSec: result.retryAfterSec });
      return;
    }
    logger.info('Hourly scan requested', {
      key,
      requestId: result.request.requestId,
      reused: result.reused,
    });
    // Watchdog (best-effort): if no tab consumes the request, the tabs
    // are closed — log loudly so the silence is diagnosable.
    const requestId = result.request.requestId;
    setTimeout(() => {
      try {
        if (isConsumedRequest(requestId)) return;
        const stillWaiting = pendingRequest()?.requestId === requestId;
        logger.warn('Scheduled scan unconsumed — watcher tabs may be closed', { key, requestId, stillWaiting });
      } catch {
        // ignore — watchdog must never break anything
      }
    }, UNCONSUMED_WARN_MS);
  } catch (error) {
    logger.error('Hourly scan trigger failed', { key, error });
  }
}

/** Starts the hourly chain. Idempotent — second calls are no-ops. */
export function startHourlyScanTrigger(): void {
  if (timer) return;
  const schedule = (): void => {
    try {
      const plan = planNextHourlyScan(Date.now());
      logger.info('Hourly scan scheduled', {
        key: plan.key,
        firesInSec: Math.round(plan.delayMs / 1000),
        late: plan.late,
      });
      timer = setTimeout(() => {
        timer = null;
        void fire(plan.key).finally(schedule);
      }, plan.delayMs);
    } catch (error) {
      logger.error('Hourly scan scheduling failed (retry in 1 min)', { error });
      timer = setTimeout(() => {
        timer = null;
        schedule();
      }, 60 * 1000);
    }
  };
  schedule();
}

/** Test hook: stops the chain. */
export function stopHourlyScanTrigger(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  lastKey = null;
}
