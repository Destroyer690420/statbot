import { Client } from 'discord.js';
import { automationRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, DetectedGoPartTimeTask } from '../../types';
import { logger } from '../../utils/logger';
import { runCycle } from './cycle.service';

/** Sightings older than this are treated as gone from the listing. */
export const SIGHTING_TTL_MS = 15 * 60 * 1000;

export function isSightingFresh(lastSeenAt: Date, nowMs: number = Date.now(), ttlMs: number = SIGHTING_TTL_MS): boolean {
  return lastSeenAt.getTime() >= nowMs - ttlMs;
}

/**
 * Sighting-driven automation tick (hybrid companion flow):
 *  expire stale claims (releasing workers) -> take fresh NEW sightings ->
 *  run one companion-strategy cycle over them.
 * The companion browser does all GoPartTime I/O; the server never fetches.
 */
export async function processSightingQueue(discordClient: Client): Promise<string | null> {
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

  // 2. Fresh NEW sightings -> DetectedGoPartTimeTask.
  const freshSince = new Date(now.getTime() - SIGHTING_TTL_MS);
  const sightings = await automationRepository.listNewSightings(freshSince).catch(() => []);
  const usable = sightings
    .filter((s) => (s.taskType === 'post' || s.taskType === 'comment') && /^\d+$/.test(s.externalTaskId))
    .slice(0, 20);
  // Park malformed rows so they are never retried.
  const malformed = sightings.filter((s) => !usable.includes(s)).map((s) => s.id);
  if (malformed.length > 0) {
    await automationRepository.markSightings(malformed, 'DONE').catch(() => undefined);
  }
  if (usable.length === 0) return null;

  const tasks: DetectedGoPartTimeTask[] = usable.map((s) => ({
    subTaskId: s.externalTaskId,
    taskId: s.externalTaskId,
    type: s.taskType as 'post' | 'comment',
    subreddit: s.subreddit,
    title: s.title,
    postLink: null,
    contentHtml: '',
    images: [],
    payment: null,
    deadline: null,
    karmaLimit: null,
    earnings: null,
  }));

  await automationRepository.markSightings(usable.map((s) => s.id), 'CONTACTING').catch(() => undefined);
  const cycleId = await runCycle(discordClient, { forced: true, tasks, strategy: 'companion' });
  await automationRepository.markSightings(usable.map((s) => s.id), 'DONE').catch(() => undefined);
  return cycleId;
}
