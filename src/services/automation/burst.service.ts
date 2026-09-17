import { Client } from 'discord.js';
import { automationRepository, outreachRepository, taskRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, DetectedGoPartTimeTask } from '../../types';
import { AUTOMATION } from '../../config/constants';
import { getIstDayBoundaries, getIstHourStart } from '../../utils/ist-time';
import { logger } from '../../utils/logger';
import { validateDetectedTask } from './validator.service';
import { diffNewTasks, isBurstActive, isMergeAllowed, parsePooledTasks, pickNextTask, serializePooledTasks } from './eligibility';
import { outreachService, DAILY_POST_CAP } from '../outreach.service';

export interface BurstTaskInput {
  subTaskId: string;
  type: 'post' | 'comment';
  subreddit: string | null;
  title: string | null;
}

/** Returned when a settled auto-report validated fine but only a manual start may blast. */
export const AUTO_PAUSED_REASON = 'auto bursts paused — use Blast Now';

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
  /** True when the report hit this hour's existing burst (pool frozen). */
  merged: boolean;
  /** Task ids actually added to the pool by this report. */
  added: string[];
  /** Human-readable why-no-blast (null when a blast opened). */
  reason: string | null;
}

/** Live-held external ids of a cycle (PENDING/CLAIMED claims). */
async function liveHeldIds(cycleId: string): Promise<Set<string>> {
  const claims = await automationRepository.listCycleClaims(cycleId).catch(() => []);
  return new Set(
    claims.filter((c) => c.status === 'PENDING' || c.status === 'CLAIMED').map((c) => c.externalTaskId),
  );
}

function toDetected(t: BurstTaskInput): DetectedGoPartTimeTask {
  return {
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
}

interface ValidationOutcome {
  eligible: DetectedGoPartTimeTask[];
  blocked: number;
  duplicates: number;
  commentsSkipped: number;
}

/** Validates inputs, logging every decision to the given cycle. */
async function validateInputs(inputs: BurstTaskInput[], cycleId: string): Promise<ValidationOutcome> {
  const eligible: DetectedGoPartTimeTask[] = [];
  let blocked = 0;
  let duplicates = 0;
  let commentsSkipped = 0;
  for (const t of inputs) {
    const detected = toDetected(t);
    // Listed + available means takeable: an accepted task vanishes from the
    // listing, so history never disqualifies a listed task here.
    const v = await validateDetectedTask(detected, { skipDuplicate: true });
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
  return { eligible, blocked, duplicates, commentsSkipped };
}

function dedupeInputs(tasks: BurstTaskInput[]): BurstTaskInput[] {
  const seen = new Set<string>();
  const out: BurstTaskInput[] = [];
  for (const t of tasks) {
    if (!t || !t.subTaskId || seen.has(t.subTaskId)) continue;
    seen.add(t.subTaskId);
    out.push(t);
  }
  return out;
}

/**
 * Burst auto-accept flow — the exact contract:
 *   manual Blast Now (force) -> validate -> blast (slots = eligible N) ->
 *   each blast reply -> one AutomationClaim for the next unheld task.
 * - Blasts open ONLY from an explicit manual start (Blast Now button,
 *   forceWindow). Automatic hourly bursts are paused: settled :10 reports
 *   still validate + log for observability but never message.
 * - One blast per IST hour: the manual report opens it; later reports hit
 *   the frozen pool and change nothing (late arrivals wait for next hour).
 * - Every validated-eligible listed post counts (blocked / duplicate /
 *   unreadable-subreddit / comment rules still exclude).
 * - Winners are served however long it takes: claims never expire while the
 *   burst is open (24h TTL backstop; closed-burst orphans are swept).
 * - Nothing is ever accepted on GoPartTime without a named winner holding it
 *   (accepted-but-unclaimed tasks cannot be returned there).
 */
export async function createBurstFlow(
  discordClient: Client,
  tasks: BurstTaskInput[],
  senderId: string | null,
  opts: { forceWindow?: boolean } = {},
): Promise<BurstResult> {
  const settings = await automationRepository.getSettings();
  const dryRun = settings ? settings.dryRun : true;
  // Freeze semantics: disabled means disabled — validate + log for
  // observability, but never blast, never touch real burst rows.
  // Manual Blast Now (forceWindow) is explicit human intent: it bypasses the
  // window gate, never the live gate.
  const enabled = settings?.enabled ?? false;
  const live = enabled && !dryRun;
  const inputs = dedupeInputs(tasks);
  const inWindow = isBurstActive() || !!opts.forceWindow;

  // One-blast-per-hour guard (live mode only): the settled report already
  // opened the blast — join it only inside the merge grace, never re-message.
  if (live) {
    const hourBursts = await automationRepository.listBurstsSince(getIstHourStart()).catch(() => []);
    const hourOpen = [...hourBursts].reverse().find((b) => b.status === 'OPEN');
    if (hourOpen) {
      return mergeIntoHourBurst(hourOpen.id, inputs, senderId);
    }
  }

  const cycleId = `burst-${new Date().toISOString().slice(0, 16).replace('T', '-')}-${Date.now().toString(36)}`;
  await automationRepository.createCycle({ id: cycleId, dryRun: !live });

  // Close previous-hour strays WITHOUT unioning (pools freeze; late sets
  // wait for next hour). Live mode only — a frozen system touches nothing.
  if (live) {
    try {
      const openBursts = await automationRepository.listOpenBursts();
      for (const b of openBursts) {
        await automationRepository.closeBurst(b.id).catch(() => undefined);
        await automationRepository.updateCycle(b.cycleId, { status: 'DONE', endedAt: new Date() }).catch(() => undefined);
      }
    } catch (error) {
      logger.warn('Burst stray close failed (continuing with fresh scan)', { error });
    }
  }
  const candidates: BurstTaskInput[] = [...inputs];

  const { eligible, blocked, duplicates, commentsSkipped } = await validateInputs(candidates, cycleId);

  await automationRepository.updateCycle(cycleId, {
    tasksDetected: candidates.length,
    eligiblePosts: eligible.length,
    blocked,
    duplicates,
    commentsSkipped: commentsSkipped,
  });
  await auditLogService.log(
    AuditAction.AUTOMATION_CYCLE_STARTED,
    null,
    senderId,
    `Burst ${cycleId} scanned ${candidates.length} task(s): ${eligible.length} eligible (live=${live}, inWindow=${inWindow}${opts.forceWindow ? ', forced' : ''})`,
  );

  let reason: string | null = null;
  if (eligible.length === 0) reason = 'no eligible tasks found';
  else if (!live) reason = dryRun ? 'dry-run is on' : 'automation disabled';
  else if (!inWindow) reason = 'outside the blast window';
  // Automatic hourly bursts are paused — only an explicit manual start
  // (Blast Now, forceWindow) may open a blast. Auto reports still validated
  // + logged above; they just never message.
  else if (!opts.forceWindow) reason = AUTO_PAUSED_REASON;
  if (reason) {
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
      merged: false,
      added: [],
      reason,
    };
  }

  // The pool is registered BEFORE the first message goes out: replies
  // arrive while sending is still in flight, and each must find an OPEN
  // burst to claim from — otherwise early winners burn slots with no claim.
  const blast = await outreachService.beginBlast(eligible.length, senderId || 'burst');
  const burst = await automationRepository.createBurst({
    blastId: blast.id,
    cycleId,
    taskIds: eligible.map((t) => t.subTaskId),
    taskDetails: serializePooledTasks(
      eligible.map((t) => ({ id: t.subTaskId, subreddit: t.subreddit, title: t.title })),
    ),
  });
  const { sent, skipped } = await outreachService
    .sendBlastMessages(discordClient, blast, senderId || 'burst')
    .catch(async (error) => {
      await automationRepository.closeBurst(burst.id).catch(() => undefined);
      await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date(), failures: 1 }).catch(() => undefined);
      throw error;
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
    merged: false,
    added: eligible.map((t) => t.subTaskId),
    reason: null,
  };
}

/**
 * Hour-burst merge: a later report in the same IST hour joins the pool ONLY
 * inside the merge grace after blast creation (streaming completion: slots
 * grow, zero new messages). Past grace the pool is frozen (late arrivals
 * wait for next hour). Always returns the open blast info (or null when it
 * already filled) so retries confirm delivery without ever re-messaging.
 */
async function mergeIntoHourBurst(
  burstId: string,
  inputs: BurstTaskInput[],
  senderId: string | null,
): Promise<BurstResult> {
  const empty: BurstResult = {
    cycleId: '',
    eligible: [],
    blocked: 0,
    duplicates: 0,
    commentsSkipped: 0,
    blast: null,
    sent: 0,
    skipped: [],
    dryRun: false,
    merged: true,
    added: [],
    reason: null,
  };

  const allBursts = await automationRepository.listBurstsSince(new Date(0)).catch(() => []);
  const burst = allBursts.find((b) => b.id === burstId);
  if (!burst || burst.status !== 'OPEN') return empty;
  const blast = await outreachRepository.getBlast(burst.blastId).catch(() => null);
  if (!blast || blast.status !== 'OPEN') {
    return { ...empty, cycleId: burst.cycleId, reason: 'hour blast already closed' };
  }

  // Grace-boxed append: streaming completions only.
  if (!isMergeAllowed(burst.createdAt, Date.now(), AUTOMATION.BURST_MERGE_GRACE_MS)) {
    logger.info('Hour pool frozen, report ignored', { blastId: burst.blastId });
    return { ...empty, cycleId: burst.cycleId, blast: { id: blast.id, slotsTotal: blast.slotsTotal } };
  }

  const candidates = dedupeInputs(inputs);
  const { eligible, blocked, duplicates, commentsSkipped } = await validateInputs(candidates, burst.cycleId);

  const held = await liveHeldIds(burst.cycleId);
  const stored = await automationRepository.listBurstsSince(new Date(0)).catch(() => []);
  const current = stored.find((b) => b.id === burst.id);
  const pooled: string[] = current ? current.taskIds : burst.taskIds;
  const added = diffNewTasks(
    eligible.map((t) => t.subTaskId),
    pooled,
    held,
  );

  if (added.length > 0) {
    await automationRepository.appendBurstTasks(burst.id, added);
    const byId = new Map(eligible.map((t) => [t.subTaskId, t]));
    const storedDetails = current ? current.taskDetails : burst.taskDetails;
    const details = [
      ...parsePooledTasks(storedDetails, pooled),
      ...added.map((id) => ({
        id,
        subreddit: byId.get(id)?.subreddit ?? null,
        title: byId.get(id)?.title ?? null,
      })),
    ];
    await automationRepository.setBurstDetails(burst.id, serializePooledTasks(details)).catch(() => undefined);
    const updated = await outreachRepository.bumpBlastSlots(blast.id, added.length).catch(() => null);
    const cycle = await automationRepository.getCycle(burst.cycleId).catch(() => null);
    if (cycle) {
      await automationRepository
        .updateCycle(burst.cycleId, {
          tasksDetected: cycle.tasksDetected + candidates.length,
          eligiblePosts: cycle.eligiblePosts + eligible.length,
          blocked: cycle.blocked + blocked,
          duplicates: cycle.duplicates + duplicates,
          commentsSkipped: cycle.commentsSkipped + commentsSkipped,
        })
        .catch(() => undefined);
    }
    await auditLogService.log(
      AuditAction.AUTOMATION_CYCLE_STARTED,
      null,
      senderId,
      `Burst grace merge: +${added.length} task(s) into blast ${blast.id} (slots now ${updated ? updated.slotsTotal : blast.slotsTotal + added.length}), no re-message`,
    );
    logger.info('Burst grace merge', { blastId: blast.id, added });
  }

  const live = await outreachRepository.getBlast(blast.id).catch(() => null);
  return {
    cycleId: burst.cycleId,
    eligible: eligible.filter((t) => added.includes(t.subTaskId)),
    blocked,
    duplicates,
    commentsSkipped,
    blast: live ? { id: live.id, slotsTotal: live.slotsTotal } : { id: blast.id, slotsTotal: blast.slotsTotal },
    sent: 0,
    skipped: [],
    dryRun: false,
    merged: true,
    added,
    reason: null,
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
      // Freeze semantics: no new claims unless the automation is live
      // (enabled + dry-run off). In-flight rounds halt at the next reply.
      const settings = await automationRepository.getSettings().catch(() => null);
      if (!settings?.enabled || settings.dryRun) {
        logger.info('Burst reply ignored: automation not live (frozen)', { blastId, channelId });
        return null;
      }
      const burst = await automationRepository.getBurstByBlast(blastId).catch(() => null);
      if (!burst || burst.status !== 'OPEN') return null;

      // PENDING/CLAIMED are in flight; FAILED was attempted and missed (move
      // on — never re-queue it). EXPIRED was never attempted: still fair game.
      const cycleClaims = await automationRepository.listCycleClaims(burst.cycleId).catch(() => []);
      // One task per winner per burst: intake already enforces one win each,
      // but a second reply reaching here directly must never double-claim.
      // A new burst is a new cycle, so second tasks only ever come from a
      // later burst — never twice from the same one.
      const alreadyHeld = cycleClaims.some(
        (c) => c.workerId === workerId && (c.status === 'PENDING' || c.status === 'CLAIMED'),
      );
      if (alreadyHeld) {
        logger.info('Burst reply ignored: worker already holds a task in this burst', { blastId, channelId, workerId });
        return null;
      }
      const taken = new Set(
        cycleClaims.filter((c) => c.status !== 'EXPIRED').map((c) => c.externalTaskId),
      );
      const next = pickNextTask(burst.taskIds, taken);
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
