import { initializeDatabase } from '../src/database/db';
import { inviteDetectionRepository } from '../src/database/repositories';
import { inviteDetectionService } from '../src/services/invite-detection.service';
import { toInviteDetection } from '../src/database/converters';
import { logger } from '../src/utils/logger';

/**
 * One-off approval sweep (2026-09-10): approves every pending InviteDetection
 * row that already has a known inviter — the backlog from the
 * manual-verification era. Unknown-inviter rows are left pending for manual
 * set-inviter + Approve (a referral cannot exist without an inviter).
 *
 * Each approval goes through `inviteDetectionService.approve()` (same guards
 * as the dashboard button and the new auto-approve: keep-first duplicates are
 * skipped, missing names fall back to Discord, audits written). Failures are
 * logged per-row and never abort the sweep.
 *
 * Safe to re-run (approved rows are no longer pending).
 *
 * Usage (host-run with DATABASE_URL localhost-substituted):
 *   npx tsx scripts/approve-pending-detections.ts [--dry-run]
 */

function parseArgs(): { dryRun: boolean } {
  return { dryRun: process.argv.slice(2).includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs();
  logger.info(`Approve-pending sweep starting (dryRun=${dryRun})`);

  initializeDatabase();

  let approved = 0;
  let skippedUnknown = 0;
  let failed = 0;

  for (;;) {
    const raws = await inviteDetectionRepository.findPending(500);
    if (raws.length === 0) break;
    for (const raw of raws as any[]) {
      const row = toInviteDetection(raw as any);
      if (!row.inviterId) {
        skippedUnknown += 1;
        logger.info('Approve sweep: skipping unknown inviter', {
          id: row.id,
          inviteeId: row.inviteeId,
        });
        continue;
      }
      if (dryRun) {
        approved += 1;
        logger.info('Approve sweep (dry-run): would approve', {
          id: row.id,
          inviterId: row.inviterId,
          inviteeId: row.inviteeId,
        });
        continue;
      }
      try {
        const { referralId } = await inviteDetectionService.approve(row.id, 'system');
        approved += 1;
        logger.info('Approve sweep: approved', { id: row.id, referralId });
      } catch (error) {
        failed += 1;
        logger.warn('Approve sweep: failed', {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (raws.length < 500) break;
  }

  logger.info(
    `Approve-pending sweep done (dryRun=${dryRun}): ${approved} approved, ${skippedUnknown} unknown-inviter skipped, ${failed} failed`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  logger.error('Approve-pending sweep crashed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
