import { Client } from 'discord.js';
import { automationRepository, outreachRepository, taskRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, DetectedGoPartTimeTask } from '../../types';
import { AUTOMATION } from '../../config/constants';
import { getIstDayBoundaries, getIstHourStart } from '../../utils/ist-time';
import { logger } from '../../utils/logger';
import { validateDetectedTask } from './validator.service';
import { diffNewTasks, pickNextTask } from './eligibility';
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
  /** True when the report merged into (or hit) this hour's existing burst. */
  merged: boolean;
  /** Task ids actually added to the pool by this report. */
  added: string[];
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
 * Burst auto-accept flow (lazy accept), one blast per IST hour:
 *   eligible scan -> validate -> auto-blast (slots = eligible count) ->
 *   each blast reply -> one AutomationClaim for the next unheld task.
 * The hour's FIRST eligible report opens the blast (workers messaged once).
 * Later reports in the same hour only APPEND brand-new task ids to the pool
 * (slots bumped, zero new messages); reports with nothing new are silent
 * no-ops. Nothing is ever accepted on GoPartTime without a named winner
 * holding it (accepted-but-unclaimed tasks cannot be returned there).
 */
export async function createBurstFlow(
  discordClient: Client,
  tasks: BurstTaskInput[],
  senderId: string | null,
): Promise<BurstResult> {
  const settings = await automationRepository.getSettings();
  const dryRun = settings ? settings.dryRun : true;
  const inputs = dedupeInputs(tasks);

  // One-blast-per-hour guard (live mode only): an earlier report this IST
  // hour already opened the blast — merge, never re-message.
  if (!dryRun) {
    const hourBursts = await automationRepository.listBurstsSince(getIstHourStart()).catch(() => []);
    const hourOpen = [...hourBursts].reverse().find((b) => b.status === 'OPEN');
    if (hourOpen) {
      return mergeIntoHourBurst(hourOpen.id, inputs, senderId);
    }
  }

  const cycleId = `burst-${new Date().toISOString().slice(0, 16).replace('T', '-')}-${Date.now().toString(36)}`;
  await automationRepository.createCycle({ id: cycleId, dryRun });

  // Merge leftovers from still-open bursts of PREVIOUS hours (e.g. unfilled
  // tasks carried into a new hour): unheld tasks carry over so the new blast
  // still serves them. Skipped entirely in dry-run (real rows stay untouched).
  const merged: BurstTaskInput[] = [];
  if (!dryRun) {
    try {
      const openBursts = await automationRepository.listOpenBursts();
      for (const b of openBursts) {
        const held = await liveHeldIds(b.cycleId);
        for (const id of b.taskIds) {
          if (!held.has(id)) {
            merged.push({ subTaskId: id, type: 'post', subreddit: null, title: null });
          }
        }
        await automationRepository.closeBurst(b.id).catch(() => undefined);
        await automationRepository.updateCycle(b.cycleId, { status: 'DONE', endedAt: new Date() }).catch(() => undefined);
      }
    } catch (error) {
      logger.warn('Burst leftover merge failed (continuing with fresh scan)', { error });
    }
  }
  const mergedSeen = new Set<string>();
  const candidates: BurstTaskInput[] = [];
  for (const t of [...merged, ...inputs]) {
    if (mergedSeen.has(t.subTaskId)) continue;
    mergedSeen.add(t.subTaskId);
    candidates.push(t);
  }

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
    `Burst ${cycleId} scanned ${candidates.length} task(s): ${eligible.length} eligible (dryRun=${dryRun})`,
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
      merged: false,
      added: [],
    };
  }

  const { blast, sent, skipped } = await outreachService.sendBlast(discordClient, eligible.length, senderId || 'burst').catch(async (error) => {
    await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date(), failures: 1 }).catch(() => undefined);
    throw error;
  });
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
    merged: false,
    added: eligible.map((t) => t.subTaskId),
  };
}

/**
 * One-blast-per-hour merge: a later report in the same IST hour joins the
 * hour's existing burst instead of opening a new blast. Brand-new task ids
 * are appended to the pool and the blast's slots grow — zero new Discord
 * messages. Reports with nothing new are silent no-ops (no cycle row, no
 * logs). When the hour's blast already closed (slots filled), late tasks
 * wait for the next hour's scan (still-listed tasks are re-detected there).
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
  };

  const allBursts = await automationRepository.listBurstsSince(new Date(0)).catch(() => []);
  const burst = allBursts.find((b) => b.id === burstId);
  if (!burst || burst.status !== 'OPEN') return empty;

  // Close previous-hour strays and union their unheld tasks (same pool).
  const extras: BurstTaskInput[] = [];
  try {
    const others = (await automationRepository.listOpenBursts()).filter((b) => b.id !== burst.id);
    for (const o of others) {
      const held = await liveHeldIds(o.cycleId);
      for (const id of o.taskIds) {
        if (!held.has(id)) {
          extras.push({ subTaskId: id, type: 'post', subreddit: null, title: null });
        }
      }
      await automationRepository.closeBurst(o.id).catch(() => undefined);
      const ob = await outreachRepository.getBlast(o.blastId).catch(() => null);
      if (ob && ob.status === 'OPEN') {
        const filled = await outreachRepository.countReplies(ob.id).catch(() => 0);
        await outreachRepository.closeBlast(ob.id, filled).catch(() => undefined);
      }
      await automationRepository.updateCycle(o.cycleId, { status: 'DONE', endedAt: new Date() }).catch(() => undefined);
    }
  } catch (error) {
    logger.warn('Hour-burst stray close failed (continuing)', { error });
  }

  const blast = await outreachRepository.getBlast(burst.blastId).catch(() => null);
  if (!blast || blast.status !== 'OPEN') {
    // Filled already: first-N won, losers cleaned. Late tasks ride next hour.
    logger.info('Hour blast already closed, report ignored', { blastId: burst.blastId });
    return { ...empty, cycleId: burst.cycleId };
  }

  const candidates = dedupeInputs([...extras, ...inputs]);
  const { eligible, blocked, duplicates, commentsSkipped } = await validateInputs(candidates, burst.cycleId);

  const held = await liveHeldIds(burst.cycleId);
  const fresh = await automationRepository.listBurstsSince(new Date(0)).catch(() => []);
  const current = fresh.find((b) => b.id === burst.id);
  const pooled: string[] = current ? current.taskIds : burst.taskIds;
  const added = diffNewTasks(
    eligible.map((t) => t.subTaskId),
    pooled,
    held,
  );

  if (added.length > 0) {
    await automationRepository.appendBurstTasks(burst.id, added);
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
      `Burst hour merge: +${added.length} task(s) into blast ${blast.id} (slots now ${updated ? updated.slotsTotal : blast.slotsTotal + added.length}), no re-message`,
    );
    logger.info('Burst hour merge', { blastId: blast.id, added });
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
