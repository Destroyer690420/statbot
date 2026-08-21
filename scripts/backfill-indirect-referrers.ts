import { initializeDatabase, getDb } from '../src/database/db';
import { resolveIndirectSpecialInviterId } from '../src/services/commission.service';
import { logger } from '../src/utils/logger';

/**
 * One-off data fix (2026-08-21): recomputes Referral.indirectSpecialInviterId
 * for every normal-inviter referral by walking the FULL invite chain upward.
 *
 * Background: referral creation used to check only ONE level up, so in a chain
 * like special -> A -> B -> C only A's invitees were linked; B's and C's
 * invitees got indirectSpecialInviterId = null and the special inviter was
 * never paid per-task commissions on their tasks. Detection now walks the
 * whole chain; this script repairs rows created before the fix.
 *
 * Recomputes from scratch: sets the correct special inviter when one is found
 * AND clears stale values. Only rows whose stored value changes are updated.
 * Safe to re-run.
 *
 * Usage: npx tsx scripts/backfill-indirect-referrers.ts
 */
async function main(): Promise<void> {
  initializeDatabase();
  const db = getDb();

  const refs = await db.referral.findMany({
    where: { inviterType: 'normal' },
    select: { id: true, inviterId: true, inviteeName: true, indirectSpecialInviterId: true },
  });

  logger.info(`Checking ${refs.length} normal-inviter referral(s)`);

  let updated = 0;
  let linked = 0;
  let cleared = 0;
  for (const ref of refs) {
    const correct = await resolveIndirectSpecialInviterId(ref.inviterId);
    if ((ref.indirectSpecialInviterId ?? null) === correct) continue;

    await db.referral.update({
      where: { id: ref.id },
      data: { indirectSpecialInviterId: correct, updatedAt: new Date() },
    });
    updated++;

    if (correct) {
      linked++;
      logger.info(`Linked ${ref.id} (${ref.inviteeName}): indirect special -> ${correct}`);
    } else {
      cleared++;
      logger.info(`Cleared stale indirect on ${ref.id} (${ref.inviteeName})`);
    }
  }

  logger.info(
    `Done: ${refs.length} checked, ${updated} updated (${linked} linked, ${cleared} cleared)`,
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error('Backfill failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
