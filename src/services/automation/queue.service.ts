import { Client } from 'discord.js';
import { automationRepository, outreachRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction } from '../../types';
import { logger } from '../../utils/logger';

/** Sightings older than this are treated as gone from the listing. */
export const SIGHTING_TTL_MS = 15 * 60 * 1000;

export function isSightingFresh(lastSeenAt: Date, nowMs: number = Date.now(), ttlMs: number = SIGHTING_TTL_MS): boolean {
  return lastSeenAt.getTime() >= nowMs - ttlMs;
}

/**
 * Automation hygiene tick (60s). ONLY sweeps:
 *  - expired claims (releasing workers),
 *  - orphaned burst claims (burst closed before the companion processed).
 * It NEVER opens blasts: detection blasts fire solely from the watcher's
 * settled in-window report (plus manual rehearse), exactly at xx:10 — no
 * other time. Sightings are still recorded by the watcher (first-seen
 * tracks feed the burst freshness gate); this tick just doesn't consume them.
 */
export async function processSightingQueue(_discordClient: Client): Promise<string | null> {
  const settings = await automationRepository.getSettings().catch(() => null);
  if (!settings?.enabled) return null;

  const now = new Date();

  // 1. Sweep expired claims, releasing their workers.
  try {
    const pending = await automationRepository.listPendingClaims();
    for (const claim of pending) {
      if (claim.expiresAt > now) continue;
      await automationRepository.resolveClaim(claim.id, 'EXPIRED', 'Companion did not respond in time');
      try {
        const contacts = await automationRepository.listCycleContacts(claim.cycleId);
        const held = contacts.find(
          (c: { channelId: string; status: string }) =>
            c.channelId === claim.channelId && (c.status === 'RESERVED' || c.status === 'CONTACTED'),
        );
        if (held) await automationRepository.updateContactStatus(held.id, 'RELEASED');
      } catch {
        // best-effort
      }
      await auditLogService.log(
        AuditAction.AUTOMATION_TASK_FAILED, null, null,
        `Claim ${claim.id} (task ${claim.externalTaskId}) expired without companion verdict`,
      );
    }
  } catch (error) {
    logger.warn('Claim sweep failed', { error });
  }

  // 1b. Sweep orphaned burst claims: PENDING claims whose burst already
  // closed can never convert to a served task — EXCEPT the winners of a
  // fill-closed burst. Fill keeps winners' messages and their claims must
  // live until the claim TTL so the companion can serve them however long
  // each in-page accept takes. Only bursts whose blast never filled (cut
  // short by supersede/close) leave true orphans: those claims die fast so
  // they stop occupying the browser's serial claim queue ahead of live work.
  // Companion-cycle claims have no burst row and are never touched here.
  try {
    const pending = await automationRepository.listPendingClaims();
    const byCycle = new Map<string, { id: string; externalTaskId: string }[]>();
    for (const claim of pending) {
      const list = byCycle.get(claim.cycleId) || [];
      list.push({ id: claim.id, externalTaskId: claim.externalTaskId });
      byCycle.set(claim.cycleId, list);
    }
    for (const [cycleId, claims] of byCycle) {
      const bursts = await automationRepository.listBurstsByCycle(cycleId).catch(() => []);
      if (bursts.length === 0) continue;
      if (bursts.some((b) => b.status === 'OPEN')) continue;
      let winnersStanding = false;
      for (const b of bursts) {
        const blast = await outreachRepository.getBlast(b.blastId).catch(() => null);
        if (blast && blast.status === 'CLOSED' && blast.slotsFilled >= blast.slotsTotal) {
          winnersStanding = true;
          break;
        }
      }
      if (winnersStanding) continue;
      for (const claim of claims) {
        await automationRepository.resolveClaim(claim.id, 'EXPIRED', 'Burst closed before the companion processed it');
        logger.info('Orphaned burst claim expired', { claimId: claim.id, task: claim.externalTaskId });
      }
    }
  } catch (error) {
    logger.warn('Orphan claim sweep failed', { error });
  }

  // 2. Fresh NEW sightings -> DetectedGoPartTimeTask.
  // 2. Sightings are intentionally NOT consumed here. Fresh arrivals blast
  // solely via the watcher's settled :10 report (see burst.service); any
  // other trigger would message workers outside xx:10. Sightings rows stay
  // as first-seen tracks for the freshness gate.
  void now;
  return null;
}
