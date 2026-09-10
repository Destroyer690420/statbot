import { Client } from 'discord.js';
import { automationRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, DetectedGoPartTimeTask } from '../../types';
import { env } from '../../config/env';
import { AUTOMATION } from '../../config/constants';
import { logger } from '../../utils/logger';
import { scanTasks, acceptTask } from './poller.service';
import { validateDetectedTask } from './validator.service';
import { sessionService } from './session.service';
import {
  selectCandidates,
  sendConfirmations,
  collectConfirmed,
  expireContacts,
} from './worker-manager.service';

function buildCycleId(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace('T', '-');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let running = false;

export type AcceptStrategy = 'server' | 'companion';

/** Companion claim time-to-live (manager's browser polls the queue). */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

export interface CycleOpts {
  forced?: boolean;
  /** Injected tasks (skips the server scan — used by the sighting flow). */
  tasks?: DetectedGoPartTimeTask[];
  /** server = poller accepts; companion = claim queue + in-page accept. */
  strategy?: AcceptStrategy;
}

/**
 * Eligible-gated iterative cycle (user spec v3):
 *  poll -> count eligible x -> ping exactly x workers -> 5-min window
 *  -> accept min(eligible,confirmed) -> re-poll remaining -> repeat
 *  until no eligible remains or no workers left.
 * Dry-run (default) logs WOULD_ACCEPT and never accepts.
 * With opts.tasks, runs a SINGLE batch over the injected tasks (sighting flow).
 *
 * RETIRED from automatic use (burst-only everywhere): no scheduler or queue
 * tick calls this anymore. Kept for manual `POST /automation/start` and the
 * test endpoints.
 */
export async function runCycle(discordClient: Client, opts: CycleOpts = {}): Promise<string | null> {
  if (running) {
    logger.info('Automation cycle already running, skipping');
    return null;
  }
  const settings = await automationRepository.getSettings();
  const enabled = settings?.enabled ?? false;
  const dryRun = settings ? settings.dryRun : true;
  if (!enabled && !opts.forced) {
    logger.debug('Automation disabled, skipping cycle');
    return null;
  }
  const existing = await automationRepository.getRunningCycle();
  if (existing && !opts.forced) {
    logger.info('A cycle is already RUNNING, skipping', { cycleId: existing.id });
    return null;
  }

  running = true;
  const cycleId = `${buildCycleId()}-${Date.now().toString(36)}`;
  await automationRepository.createCycle({ id: cycleId, dryRun });
  await auditLogService.log(AuditAction.AUTOMATION_CYCLE_STARTED, null, null, `Cycle ${cycleId} started (dryRun=${dryRun})`);
  logger.info('Automation cycle started', { cycleId, dryRun });

  const contactedChannels = new Set<string>();
  const consumedIds = new Set<string>();
  const strategy: AcceptStrategy = opts.strategy || 'server';
  let postsAccepted = 0;
  let failures = 0;

  try {
    // Iterative batches: each batch re-polls so we ping only remaining eligible count.
    // Injected-tasks mode (sighting flow) runs a single batch — the queue tick re-runs.
    const maxBatches = opts.tasks ? 1 : 6;
    for (let batch = 0; batch < maxBatches; batch++) {
      let detected: DetectedGoPartTimeTask[];
      if (opts.tasks) {
        detected = batch === 0 ? opts.tasks : [];
      } else {
        try {
          const scan = await scanTasks();
          detected = scan.tasks;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn('Cycle scan failed', { cycleId, batch, error: msg });
          failures++;
          break;
        }
      }

      // Validate all detected.
      const eligible: DetectedGoPartTimeTask[] = [];
      let blocked = 0;
      let duplicates = 0;
      let comments = 0;
      for (const t of detected) {
        const v = await validateDetectedTask(t);
        await automationRepository.logTask({
          cycleId,
          externalTaskId: t.subTaskId,
          taskType: t.type,
          subreddit: t.subreddit,
          status: v.reason,
        });
        if (v.eligible) eligible.push(t);
        else if (v.reason === 'BLOCKED') blocked++;
        else if (v.reason === 'DUPLICATE') duplicates++;
        else if (v.reason === 'SKIPPED_COMMENT') comments++;
      }
      const remaining = eligible.slice(postsAccepted);
      await automationRepository.updateCycle(cycleId, {
        tasksDetected: detected.length,
        eligiblePosts: eligible.length,
        blocked,
        duplicates,
        commentsSkipped: comments,
      });
      if (remaining.length === 0) {
        logger.info('Cycle: no remaining eligible posts', { cycleId, batch });
        break;
      }

      // Ping exactly remaining count.
      const candidates = await selectCandidates(discordClient, remaining.length, contactedChannels);
      if (candidates.length === 0) {
        for (const t of remaining) {
          await automationRepository.logTask({
            cycleId, externalTaskId: t.subTaskId, taskType: t.type,
            subreddit: t.subreddit, status: 'NO_WORKER',
          });
        }
        logger.info('Cycle: no workers left', { cycleId, batch });
        break;
      }
      for (const c of candidates) contactedChannels.add(c.channelId);
      await sendConfirmations(discordClient, cycleId, candidates);
      await automationRepository.updateCycle(cycleId, { workersContacted: contactedChannels.size });
      const batchStart = Date.now();

      // 5-minute window (poll every 15s so Ctrl-C/shutdown stays responsive).
      await waitForWindow();
      await expireContacts();
      const confirmed = await collectConfirmed(cycleId);
      // Only confirmations from THIS batch's window count (Rule 6/7: availability
      // is time-sensitive; a stale reply from an earlier batch must not count).
      const fresh = confirmed.filter(
        (c: { id: string; respondedAt: Date | null }) =>
          !consumedIds.has(c.id) &&
          !!c.respondedAt &&
          c.respondedAt.getTime() >= batchStart - 1000 &&
          c.respondedAt.getTime() <= Date.now(),
      );
      await automationRepository.updateCycle(cycleId, { workersConfirmed: confirmed.length });

      const pairs = Math.min(remaining.length, fresh.length);
      if (pairs === 0) {
        logger.info('Cycle batch: no confirmations', { cycleId, batch });
        continue; // loop re-polls and pings next workers
      }

      for (let i = 0; i < pairs; i++) {
        const task = remaining[i];
        const contact = fresh[i];
        consumedIds.add(contact.id);
        if (dryRun || (strategy === 'server' && !env.GOPARTTIME_AUTO_ACCEPT)) {
          await automationRepository.logTask({
            cycleId, externalTaskId: task.subTaskId, taskType: task.type,
            subreddit: task.subreddit, status: 'WOULD_ACCEPT', workerId: contact.workerId,
          });
          await automationRepository.updateContactStatus(contact.id, 'ASSIGNED');
          postsAccepted++;
          continue;
        }
        // Real accept (flag-gated for server; companion uses the manager's browser).
        if (strategy === 'companion') {
          const ok = await acceptViaClaim(cycleId, task, contact.id, contact.channelId, contact.workerId);
          if (ok) postsAccepted++;
          else failures++;
          continue;
        }
        try {
          await automationRepository.updateContactStatus(contact.id, 'RESERVED');
          const session = await sessionService.load();
          const nextAction = session?.nextAction || '';
          if (!nextAction) throw new Error('No Next-Action id in session vault.');
          const ok = await acceptTask(task.subTaskId, nextAction);
          if (!ok) throw new Error('GoPartTime accept returned success=false.');
          await automationRepository.logTask({
            cycleId, externalTaskId: task.subTaskId, taskType: task.type,
            subreddit: task.subreddit, status: 'ACCEPTED', workerId: contact.workerId,
          });
          await automationRepository.updateContactStatus(contact.id, 'ASSIGNED');
          await auditLogService.log(
            AuditAction.AUTOMATION_TASK_ACCEPTED, null, null,
            `Task ${task.subTaskId} accepted for <@${contact.workerId}> (assignment wiring in Phase 8)`,
          );
          postsAccepted++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await automationRepository.logTask({
            cycleId, externalTaskId: task.subTaskId, taskType: task.type,
            subreddit: task.subreddit, status: 'FAILED', workerId: contact.workerId, failureReason: msg,
          });
          await automationRepository.updateContactStatus(contact.id, 'CONTACTED').catch(() => undefined);
          await auditLogService.log(AuditAction.AUTOMATION_TASK_FAILED, null, null, `Task ${task.subTaskId} failed: ${msg}`);
          failures++;
        }
      }
      await automationRepository.updateCycle(cycleId, { postsAccepted, failures });
    }

    await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date(), postsAccepted, failures });
    logger.info('Automation cycle done', { cycleId, postsAccepted, failures });
    return cycleId;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Automation cycle crashed', { cycleId, error: msg });
    await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date(), failures: failures + 1 });
    return cycleId;
  } finally {
    running = false;
  }
}

async function waitForWindow(): Promise<void> {
  const end = Date.now() + AUTOMATION.CONTACT_WINDOW_MS;
  while (Date.now() < end) {
    await sleep(15000);
  }
}

/**
 * Companion accept: queue a claim for the manager's browser (in-page accept
 * with the genuine session), then wait for its verdict. Releases the worker
 * on failure/timeout so nobody is left hanging.
 */
async function acceptViaClaim(
  cycleId: string,
  task: DetectedGoPartTimeTask,
  contactId: string,
  channelId: string,
  workerId: string | null,
): Promise<boolean> {
  await automationRepository.updateContactStatus(contactId, 'RESERVED');
  const claim = await automationRepository.createClaim({
    cycleId,
    externalTaskId: task.subTaskId,
    channelId,
    workerId,
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
  });
  logger.info('Automation claim queued for companion', { claimId: claim.id, task: task.subTaskId });

  const deadline = Date.now() + CLAIM_TTL_MS + 30 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const current = await automationRepository.findClaim(claim.id);
    if (!current) break;
    if (current.status === 'CLAIMED') {
      // Bookkeeping (contact ASSIGNED, logs, audit) is owned by the result
      // endpoint, which has the push outcome. Here just count the pair.
      logger.info('Automation claim accepted by companion', { claimId: claim.id, task: task.subTaskId });
      return true;
    }
    if (current.status === 'FAILED' || current.status === 'EXPIRED') break;
  }

  const final = await automationRepository.findClaim(claim.id);
  const reason = !final || final.status === 'PENDING' ? 'Companion did not respond in time' : (final.failureReason || 'Companion reported failure');
  if (final && final.status === 'PENDING') {
    await automationRepository.resolveClaim(claim.id, 'EXPIRED', reason);
  }
  await automationRepository.logTask({
    cycleId, externalTaskId: task.subTaskId, taskType: task.type,
    subreddit: task.subreddit, status: 'FAILED', workerId, failureReason: reason,
  });
  await automationRepository.updateContactStatus(contactId, 'RELEASED').catch(() => undefined);
  await auditLogService.log(AuditAction.AUTOMATION_TASK_FAILED, null, null, `Task ${task.subTaskId} failed: ${reason}`);
  return false;
}

export function isCycleRunning(): boolean {
  return running;
}
