import { Client } from 'discord.js';
import { automationRepository, taskRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, DetectedGoPartTimeTask } from '../../types';
import { AUTOMATION } from '../../config/constants';
import { getIstDayBoundaries } from '../../utils/ist-time';
import { logger } from '../../utils/logger';
import { validateDetectedTask } from './validator.service';
import { pickNextTask } from './eligibility';
import { outreachService, DAILY_POST_CAP } from '../outreach.service';

export interface BurstTaskInput {
  subTaskId: string;
  type: 'post' | 'comment';
  subreddit: string | null;
  title: string | null;
}

export interface BurstResult {
  cycleId: string;
  eligible: DetectedGoPartTimeTask[];
  blocked: number;
  duplicates: number;
  commentsSkipped: number;
  blast: { id: string; slotsTotal: number } | null;
  sent: number;
  skipped: { channelId: string; reason: string }[];
  dryRun: boolean;
}

/**
 * Burst auto-accept flow (lazy accept):
 *   eligible scan -> validate -> auto-blast (slots = eligible count) ->
 *   each blast reply -> one AutomationClaim for the next unheld task.
 * Nothing is ever accepted on GoPartTime without a named winner holding it
 * (accepted-but-unclaimed tasks cannot be returned there).
 */
export async function createBurstFlow(
  discordClient: Client,
  tasks: BurstTaskInput[],
  senderId: string | null,
): Promise<BurstResult> {
  const settings = await automationRepository.getSettings();
  const dryRun = settings ? settings.dryRun : true;

  const cycleId = `burst-${new Date().toISOString().slice(0, 16).replace('T', '-')}-${Date.now().toString(36)}`;
  await automationRepository.createCycle({ id: cycleId, dryRun });

  // Merge leftovers from still-open bursts (e.g. a :14 leak scan after a
  // :10 burst): unheld tasks carry over so the new blast (which supersedes
  // the old one) still serves them. Older tasks keep priority.
  const merged: BurstTaskInput[] = [];
  const mergedSeen = new Set<string>();
  try {
    const openBursts = await automationRepository.listOpenBursts();
    for (const b of openBursts) {
      const oldClaims = await automationRepository.listCycleClaims(b.cycleId).catch(() => []);
      const held = new Set(
        oldClaims.filter((c) => c.status === 'PENDING' || c.status === 'CLAIMED').map((c) => c.externalTaskId),
      );
      for (const id of b.taskIds) {
        if (!held.has(id) && !mergedSeen.has(id)) {
          mergedSeen.add(id);
          merged.push({ subTaskId: id, type: 'post', subreddit: null, title: null });
        }
      }
      await automationRepository.closeBurst(b.id).catch(() => undefined);
      await automationRepository.updateCycle(b.cycleId, { status: 'DONE', endedAt: new Date() }).catch(() => undefined);
    }
  } catch (error) {
    logger.warn('Burst leftover merge failed (continuing with fresh scan)', { error });
  }
  for (const t of tasks) {
    if (!mergedSeen.has(t.subTaskId)) {
      mergedSeen.add(t.subTaskId);
      merged.push(t);
    }
  }

  const eligible: DetectedGoPartTimeTask[] = [];
  let blocked = 0;
  let duplicates = 0;
  let commentsSkipped = 0;
  for (const t of merged) {
    const detected: DetectedGoPartTimeTask = {
      subTaskId: t.subTaskId,
      taskId: t.subTaskId,
      type: t.type,
      subreddit: t.subreddit,
      title: t.title,
      postLink: null,
      contentHtml: '',
      images: [],
      payment: null,
      deadline: null,
      karmaLimit: null,
      earnings: null,
    };
    const v = await validateDetectedTask(detected);
    await automationRepository.logTask({
      cycleId,
      externalTaskId: detected.subTaskId,
      taskType: detected.type,
      subreddit: detected.subreddit,
      status: v.reason,
    });
    if (v.eligible) eligible.push(detected);
    else if (v.reason === 'BLOCKED') blocked++;
    else if (v.reason === 'DUPLICATE') duplicates++;
    else if (v.reason === 'SKIPPED_COMMENT') commentsSkipped++;
  }
  await automationRepository.updateCycle(cycleId, {
    tasksDetected: merged.length,
    eligiblePosts: eligible.length,
    blocked,
    duplicates,
    commentsSkipped: commentsSkipped,
  });
  await auditLogService.log(
    AuditAction.AUTOMATION_CYCLE_STARTED,
    null,
    senderId,
    `Burst ${cycleId} scanned ${merged.length} task(s): ${eligible.length} eligible (dryRun=${dryRun})`,
  );

  if (eligible.length === 0 || dryRun) {
    await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date() });
    return {
      cycleId,
      eligible,
      blocked,
      duplicates,
      commentsSkipped,
      blast: null,
      sent: 0,
      skipped: [],
      dryRun,
    };
  }

  const { blast, sent, skipped } = await outreachService.sendBlast(discordClient, eligible.length, senderId || 'burst');
  await automationRepository.createBurst({
    blastId: blast.id,
    cycleId,
    taskIds: eligible.map((t) => t.subTaskId),
  });
  await automationRepository.updateCycle(cycleId, { workersContacted: sent.filter((s) => s.ok).length });
  logger.info('Burst blast opened', { cycleId, blastId: blast.id, slots: eligible.length });
  return {
    cycleId,
    eligible,
    blocked,
    duplicates,
    commentsSkipped,
    blast,
    sent: sent.filter((s) => s.ok).length,
    skipped: skipped.map((s) => ({ channelId: s.channelId, reason: s.reason })),
    dryRun,
  };
}

// Serializes concurrent blast replies (one Node process, but reply handling
// spans awaits — the mutex keeps read-compute-write of remaining tasks atomic).
let burstTail: Promise<void> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = burstTail.then(fn, fn);
  burstTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Converts one blast reply into one claim for the next unheld burst task.
 * Returns the claim id, or null when there is nothing to claim (no burst,
 * burst closed, all tasks held, ticket busy, worker capped). Never throws.
 */
export async function handleBurstReply(blastId: string, channelId: string, workerId: string): Promise<string | null> {
  try {
    return await serialized(async () => {
      const burst = await automationRepository.getBurstByBlast(blastId).catch(() => null);
      if (!burst || burst.status !== 'OPEN') return null;

      const claims = await automationRepository.listCycleClaims(burst.cycleId).catch(() => []);
      const held = new Set(
        claims
          .filter((c) => c.status === 'PENDING' || c.status === 'CLAIMED')
          .map((c) => c.externalTaskId),
      );
      const next = pickNextTask(burst.taskIds, held);
      if (!next) {
        logger.info('Burst reply: all tasks already held', { blastId, channelId });
        return null;
      }

      // Ticket must still be idle — a second accept into the same ticket
      // would trip the one-task-per-ticket guard on push.
      const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channelId).catch(() => null);
      if (awaiting) {
        logger.info('Burst reply skipped: ticket busy', { blastId, channelId });
        return null;
      }

      // Cap re-checked at claim time (a worker may have filled up since).
      const { dayStart, dayEnd } = getIstDayBoundaries();
      const assignedToday = await outreachService.countPostsAssignedToday(workerId, dayStart, dayEnd).catch(() => 0);
      if (assignedToday >= DAILY_POST_CAP) {
        logger.info('Burst reply skipped: worker at daily cap', { blastId, channelId, workerId });
        return null;
      }

      const claim = await automationRepository.createClaim({
        cycleId: burst.cycleId,
        externalTaskId: next,
        channelId,
        workerId,
        expiresAt: new Date(Date.now() + AUTOMATION.BURST_CLAIM_TTL_MS),
      });
      logger.info('Burst claim queued for companion', {
        claimId: claim.id,
        task: next,
        channelId,
        workerId,
      });
      return claim.id;
    });
  } catch (error) {
    logger.warn('handleBurstReply failed', { blastId, channelId, error });
    return null;
  }
}

/** Closes the burst row when its blast closes with no remaining work. */
export async function closeBurstForBlast(blastId: string): Promise<void> {
  try {
    const burst = await automationRepository.getBurstByBlast(blastId).catch(() => null);
    if (!burst || burst.status !== 'OPEN') return;
    await automationRepository.closeBurst(burst.id);
    await automationRepository
      .updateCycle(burst.cycleId, { status: 'DONE', endedAt: new Date() })
      .catch(() => undefined);
    logger.info('Burst closed', { blastId, cycleId: burst.cycleId });
  } catch (error) {
    logger.warn('closeBurstForBlast failed', { blastId, error });
  }
}
