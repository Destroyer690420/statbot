import { Client } from 'discord.js';
import { OWNER_USER_ID } from '../config/constants';
import { auditRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { ownerEarningsService } from './owner-earnings.service';
import {
  DIGEST_AUDIT_PREFIX,
  digestWindowFromKey,
  describeDigestWeek,
  parseDigestAuditDetails,
  planNextDigest,
} from './owner-digest-plan';
import { buildOwnerDigestMessage } from '../utils/owner-digest-message';
import { logger } from '../utils/logger';
import { AuditAction } from '../types';

/**
 * Weekly owner digest — Thursday 00:00 IST → Wednesday 24:00 IST, DM'd to the
 * owner (OWNER_USER_ID) at Thursday 00:10 IST, ten minutes after the week
 * closes.
 *
 * Numbers come from `ownerEarningsService.getDigestWindow` (the creation-basis
 * owner-confirmed model: revenue minus live worker rates minus special
 * per-task commissions and one-time bonuses, deleted tasks contributing
 * zero), so the DM always matches the Owner Earnings page. The digest adds
 * the outcome split the page does not show: created / completed / deleted /
 * still open.
 *
 * Exactly-once across restarts: one `DIGEST_SENT` audit row per week key
 * (details 'owner-digest:<week-start-yyyy-mm-dd>'), written only AFTER the DM
 * was accepted by Discord — a send that failed leaves no marker, so the next
 * boot inside the catch-up grace re-delivers. A boot AFTER the grace never
 * fires a stale week; it just schedules the next Thursday.
 *
 * No cron: a self-rescheduling setTimeout chain (same shape as the daily
 * outreach ban scan), armed at boot and re-armed after every fire.
 */

export interface OwnerDigestRunResult {
  key: string;
  late: boolean;
  sent: boolean;
  /** Why nothing was sent (audit marker already present, dry-run, failure). */
  skipped?: 'already_audited' | 'no_client' | 'send_failed';
  error?: string;
  /** The rendered DM text — always present, so tests and --dry-run can print it. */
  message: string;
}

async function findServedWeekKeys(): Promise<string[]> {
  try {
    const rows = await auditRepository.findLatestByAction(AuditAction.DIGEST_SENT, 10);
    return rows
      .map((r) => parseDigestAuditDetails(r.details))
      .filter((k): k is string => k !== null);
  } catch (error) {
    logger.warn('Owner digest: could not read DIGEST_SENT markers (dedup falls back to the in-process key)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function runOwnerDigestForWeekKey(
  client: Client | null,
  key: string,
  opts: { late?: boolean } = {},
): Promise<OwnerDigestRunResult> {
  const late = opts.late ?? false;

  const servedKeys = await findServedWeekKeys();
  if (servedKeys.includes(key)) {
    logger.info('Owner digest: week already served (audit marker), skipping', { key });
    return { key, late, sent: false, skipped: 'already_audited', message: '' };
  }

  // Throws on a malformed/non-Thursday key — callers treat that as a bug, not
  // a skip, so a bad key can never silently swallow a week.
  const { startUTC, endUTC } = digestWindowFromKey(key);
  const { cohort, summary, rates } = await ownerEarningsService.getDigestWindow(startUTC, endUTC);
  const labels = describeDigestWeek(key);
  const message = buildOwnerDigestMessage({
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    cohort,
    money: {
      revenue: summary.totalRevenue,
      workerCost: summary.totalWorkerCost,
      perTaskCommissions: summary.totalSpecialPerTaskComm,
      oneTimeBonuses: summary.totalNormalBonuses + summary.totalSpecialBonuses,
      saved: summary.totalEarnings,
    },
    rates,
  });

  if (!client) {
    return { key, late, sent: false, skipped: 'no_client', message };
  }

  try {
    const owner = await client.users.fetch(OWNER_USER_ID);
    await owner.send({ content: message });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Owner digest: DM failed (no audit marker written; will retry on next boot/scan)', {
      key,
      late,
      error: msg,
    });
    return { key, late, sent: false, skipped: 'send_failed', error: msg, message };
  }

  // The marker goes out only after Discord accepted the DM, so a crash
  // between the two can re-send (rare, harmless duplicate) — the reverse
  // order could silently swallow a week, which is the worse mistake.
  try {
    await auditLogService.log(
      AuditAction.DIGEST_SENT,
      null,
      OWNER_USER_ID,
      `${DIGEST_AUDIT_PREFIX}${key}${late ? ' [late]' : ''}`,
    );
  } catch (error) {
    // A missing marker costs at most one duplicate DM on the next boot.
    logger.warn('Owner digest: audit marker write failed', {
      key,
      late,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Owner digest DM sent', { key, late, cohort, saved: summary.totalEarnings });
  return { key, late, sent: true, message };
}

// ─── Weekly Thursday 00:10 IST scheduler (self-rescheduling setTimeout, no cron) ───

let timer: NodeJS.Timeout | null = null;
let lastServedKey: string | null = null;

async function fire(key: string, late: boolean, client: Client): Promise<void> {
  if (key === lastServedKey) return;
  lastServedKey = key;
  try {
    await runOwnerDigestForWeekKey(client, key, { late });
  } catch (error) {
    logger.error('Owner digest run failed', {
      key,
      late,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reads the served-week keys from the audit log (so a restart never re-sends
 * a delivered week), then arms the weekly chain. Idempotent — second calls
 * are no-ops.
 */
export async function startOwnerDigestScheduler(client: Client): Promise<void> {
  if (timer) return;
  const servedKeys = await findServedWeekKeys();
  lastServedKey = servedKeys.sort().at(-1) ?? null;

  const schedule = (): void => {
    try {
      const plan = planNextDigest(Date.now(), lastServedKey);
      logger.info('Owner digest scheduled', {
        key: plan.key,
        firesInSec: Math.round(plan.delayMs / 1000),
        late: plan.late,
      });
      timer = setTimeout(() => {
        timer = null;
        void fire(plan.key, plan.late, client).finally(schedule);
      }, plan.delayMs);
    } catch (error) {
      logger.error('Owner digest scheduling failed (retry in 1 min)', { error });
      timer = setTimeout(() => {
        timer = null;
        schedule();
      }, 60 * 1000);
    }
  };
  schedule();
}

/** Test/shutdown hook: stops the chain. */
export function stopOwnerDigestScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  lastServedKey = null;
}
