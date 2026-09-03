import { initializeDatabase, getDb } from '../src/database/db';
import { auditLogService } from '../src/services/audit.service';
import { AuditAction } from '../src/types';
import { logger } from '../src/utils/logger';

/**
 * One-off repair (2026-09-03): the first run of
 * scripts/backfill-invite-detections.ts staged rows while the generated
 * Prisma client did not yet know the INVITE_* AuditAction enum values
 * (schema.prisma lagged behind migration.sql), so every INVITE_DETECTED
 * audit write failed validation while the rows themselves were created.
 *
 * This inserts a single INVITE_DETECTED audit per InviteDetection row that
 * has none (matched by inviteeId inside the details text). Safe to re-run.
 *
 * Usage: npx tsx scripts/repair-invite-detected-audits.ts
 */
async function main(): Promise<void> {
  initializeDatabase();
  const db = getDb();

  const detections = await db.inviteDetection.findMany({
    select: {
      inviteeId: true,
      inviteeName: true,
      inviterId: true,
      inviterName: true,
      ticketName: true,
    },
  });

  const audits = await db.auditLog.findMany({
    where: { action: AuditAction.INVITE_DETECTED },
    select: { details: true },
  });
  const haystack = audits.map((a) => a.details ?? '').join('\n');

  let inserted = 0;
  let seen = haystack;
  for (const d of detections) {
    if (seen.includes(d.inviteeId)) continue;
    await auditLogService.log(
      AuditAction.INVITE_DETECTED,
      null,
      'backfill-repair',
      `Invite detected — ${d.inviterName ?? d.inviterId ?? 'unknown'} → ${d.inviteeName ?? d.inviteeId}` +
        (d.ticketName ? ` ticket #${d.ticketName}` : ' no ticket yet'),
    );
    seen += `\n${d.inviteeId}`;
    inserted++;
    logger.info(`Repaired audit for invitee ${d.inviteeId}`);
  }

  logger.info(`Done: ${detections.length} detection(s), ${inserted} audit(s) inserted`);
  process.exit(0);
}

main().catch((err) => {
  logger.error('Repair failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
