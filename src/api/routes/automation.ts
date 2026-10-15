import { Router, Request, Response, NextFunction } from 'express';
import { Client, TextChannel } from 'discord.js';
import { z } from 'zod';
import { automationRepository, outreachRepository, taskRepository } from '../../database/repositories';
import { sessionService } from '../../services/automation/session.service';
import { redditSessionService } from '../../services/reddit-session.service';
import { normalizeSubreddit } from '../../services/automation/subreddit';
import { validateDetectedTask, loadSeenSubs, loadAllowedSubs } from '../../services/automation/validator.service';
import { handleAutoBlockReport } from '../../services/automation/content-block.service';
import { recordScreenEvent } from '../../services/automation/screen-events';
import { screenTitle } from '../../utils/content-screen';
import { scanTasks, acceptTask } from '../../services/automation/poller.service';
import { runCycle } from '../../services/automation/cycle.service';
import { CLAIM_TTL_MS } from '../../services/automation/cycle.service';
import { NO_ELIGIBLE_REASON, createBurstFlow } from '../../services/automation/burst.service';
import * as blastApprovalService from '../../services/automation/blast-approval.service';
import * as scanRequestService from '../../services/automation/scan-request.service';
import { parsePooledTasks, pickNextTask } from '../../services/automation/eligibility';
import { outreachService, DAILY_POST_CAP } from '../../services/outreach.service';
import { isAtDailyCap } from '../../utils/outreach-blast';
import { getIstDayBoundaries, getIstHourStart } from '../../utils/ist-time';
import { authMiddleware, AuthRequest, requireDashboardAdmin } from '../middleware/auth';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';
import { GOPARTTIME_SOURCE, AUTOMATION, CONTENT_SCREEN } from '../../config/constants';
import { getAllAdminIds } from '../../utils/permissions';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { buildClaimTimingsLog, claimTimingsSchema, ClaimTimings } from '../../utils/claim-timings';
import { shouldLogVersionChange } from '../../utils/companion-version';
import { burstSchema, sightingTaskSchema } from './automation.schemas';

const settingsSchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  pollEnabled: z.boolean(),
});

const sessionSchema = z.object({
  sessionToken: z.string().min(50),
  csrfToken: z.string().min(10),
  callbackUrl: z.string().optional().nullable(),
  nextAction: z.string().regex(/^[0-9a-f]{64}$/).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
});

const blockedSchema = z.object({
  subreddit: z.string().min(1).max(80),
  reason: z.string().max(200).optional().nullable(),
});

const redditSessionSchema = z.object({
  cookie: z.string().min(50).max(12000),
  userAgent: z.string().max(500).optional().nullable(),
});

const testContactSchema = z.object({
  channelId: z.string().min(5).max(32),
  message: z.string().min(1).max(500).optional().nullable(),
});

const testAcceptSchema = z.object({
  externalTaskId: z.string().regex(/^\d+$/),
  channelId: z.string().min(5).max(32),
  accept: z.boolean().optional().default(false),
});



const sightingsSchema = z.object({
  companionId: z.string().max(64).optional().nullable(),
  version: z.string().max(16).optional().nullable(),
  tasks: z.array(sightingTaskSchema).max(100),
  debug: z
    .object({
      source: z.string().max(16).optional().nullable(),
      page: z
        .object({
          htmlLen: z.number().optional().nullable(),
          scriptTags: z.number().optional().nullable(),
          flightHits: z.number().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
});

export const claimResultSchema = z.object({
  ok: z.boolean(),
  failureReason: z.string().max(500).optional().nullable(),
  pushed: z.boolean().optional().default(false),
  // Phase-0 instrumentation from the watcher (shared schema — old watcher
  // versions omit it entirely).
  timings: claimTimingsSchema,
  // Tier-1 content screen: the browser aborted an accept on a full-content
  // hit and asks the SERVER to auto-block (verdict-flag path — the companion
  // never calls the dashboard-authed block endpoints itself).
  autoBlock: z.object({
    subreddit: z.string().max(80),
    signal: z.enum(['sex', 'vape', 'dojo', 'non-en']),
    matched: z.string().max(120).optional().nullable(),
    snippet: z.string().max(300).optional().nullable(),
  }).optional().nullable(),
  // Tier-1 screen outcome on EVERY verdict (hit or pass): dry-run candidates
  // are browser-console-only otherwise, invisible to the server and to the
  // bot-DM `blocks` report. Old watchers omit it entirely.
  screenReport: z.object({
    subreddit: z.string().max(80).optional().nullable(),
    signal: z.enum(['sex', 'vape', 'dojo', 'non-en']).optional().nullable(),
    matched: z.string().max(120).optional().nullable(),
    dryRun: z.boolean().optional().nullable(),
  }).optional().nullable(),
});

const rehearseSchema = z.object({
  externalTaskId: z.string().regex(/^\d+$/),
  channelId: z.string().min(5).max(32),
  taskType: z.enum(['post', 'comment']).optional().default('post'),
  subreddit: z.string().max(64).optional().nullable(),
  title: z.string().max(300).optional().nullable(),
  /** Explicit live-fire confirmation — a created claim REALLY accepts on GoPartTime. */
  live: z.boolean().optional().default(false),
});

/** Phase-0 instrumentation: one log line per claim verdict with queue wait
 * (claim created -> verdict) plus the watcher's in-page step durations.
 * Never throws — timing must not break verdicts. */
export function logClaimTimings(
  claim: { id: string; cycleId: string; externalTaskId: string; workerId: string | null; createdAt: Date },
  ok: boolean,
  timings: ClaimTimings,
): void {
  try {
    logger.info('Claim timings', buildClaimTimingsLog(claim, ok, timings));
  } catch {
    // ignore — timing must never break verdicts
  }
}

type ScreenReportBody = {
  subreddit?: string | null;
  signal?: 'sex' | 'vape' | 'dojo' | 'non-en' | null;
  matched?: string | null;
  dryRun?: boolean | null;
} | null | undefined;

/**
 * Dry-run visibility for Tier-1: a verdict carrying a screen hit lands in the
 * in-memory event feed behind the bot-DM `blocks` report (browser console
 * alone is invisible to the server). Passes (null signal) are noise and
 * skipped. Never throws — observability must not break verdicts.
 */
function recordScreenReport(report: ScreenReportBody, externalTaskId: string): void {
  try {
    if (!report || !report.signal) return;
    recordScreenEvent({
      subreddit: report.subreddit ?? null,
      signal: report.signal,
      matched: report.matched ?? null,
      externalTaskId,
      dryRun: report.dryRun ?? CONTENT_SCREEN.DRY_RUN,
    });
  } catch {
    // ignore — observability must never break verdicts
  }
}

export default function createAutomationRoutes(discordClient: Client): Router {
  const router = Router();

  // Last watcher version seen on the claim poll (staleness radar —reset on
  // restart, which re-logs the current version once; harmless).
  let lastCompanionVersion: string | null = null;

  // Dual auth on one prefix: the manager-browser companion uses the shared
  // extension key, everything else uses the dashboard JWT. A single router is
  // REQUIRED — two routers on the same prefix would let the first router's
  // router.use(auth) intercept (and reject) the other scheme's paths before
  // they ever reach their own router.
  router.use((req: Request, res: Response, next: NextFunction): void => {
    const p = req.path;
    if (
      p === '/sightings' ||
      p === '/burst' ||
      p === '/eligibility-bundle' ||
      p === '/claims/pending' ||
      /^\/claims\/[^/]+\/result$/.test(p)
    ) {
      extensionAuth(req as AuthRequest, res, next);
      return;
    }
    authMiddleware(req as AuthRequest, res, next);
  });

  /** GET /api/v1/automation/status */
  router.get('/status', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const settings = await automationRepository.getSettings();
      const running = await automationRepository.getRunningCycle();
      const recent = await automationRepository.listCycles(1);
      const blocked = await automationRepository.listBlocked();
      res.json({
        success: true,
        data: {
          enabled: settings?.enabled ?? false,
          dryRun: settings?.dryRun ?? true,
          pollEnabled: settings?.pollEnabled ?? false,
          runningCycle: running,
          lastCycle: recent[0] || null,
          blockedCount: blocked.length,
        },
      });
    } catch (error) {
      logger.error('GET /automation/status failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** PUT /api/v1/automation/settings */
  router.put('/settings', validateBody(settingsSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      const saved = await automationRepository.saveSettings({ ...req.body, updatedBy: userId });
      res.json({ success: true, data: saved });
    } catch (error) {
      logger.error('PUT /automation/settings failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** POST /api/v1/automation/start — starts one cycle now (respects enabled unless forced) */
  router.post('/start', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const forced = (req.query.forced as string) === '1';
      const cycleId = await runCycle(discordClient, { forced });
      res.json({ success: true, data: { cycleId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /** POST /api/v1/automation/stop — marks running cycle STOPPED (no new accepts) */
  router.post('/stop', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const running = await automationRepository.getRunningCycle();
      if (running) {
        await automationRepository.updateCycle(running.id, { status: 'STOPPED', endedAt: new Date() });
      }
      const userId = (req as unknown as { userId: string }).userId;
      await auditLogService.log(AuditAction.AUTOMATION_STOPPED, null, userId, 'Automation stopped by manager');
      res.json({ success: true, data: { stopped: running?.id || null } });
    } catch (error) {
      logger.error('POST /automation/stop failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** GET /api/v1/automation/cycles */
  router.get('/cycles', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const cycles = await automationRepository.listCycles(20);
      res.json({ success: true, data: cycles });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** GET /api/v1/automation/cycles/:id */
  router.get('/cycles/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const id = String(req.params.id);
      const cycle = await automationRepository.getCycle(id);
      if (!cycle) {
        res.status(404).json({ success: false, message: 'Cycle not found.' });
        return;
      }
      const contacts = await automationRepository.listCycleContacts(cycle.id);
      const logs = await automationRepository.listCycleLogs(cycle.id);
      // Burst linkage (burst-only flow): newest burst + live blast fill so
      // the panel shows eligible -> blast slots -> accepted in one view.
      const bursts = await automationRepository.listBurstsByCycle(cycle.id).catch(() => []);
      const burstViews = [];
      for (const b of bursts) {
        const blast = await outreachRepository.getBlast(b.blastId).catch(() => null);
        const filled = blast
          ? await outreachRepository.countReplies(blast.id).catch(() => blast.slotsFilled)
          : 0;
        const replies = blast
          ? await outreachRepository.listBlastReplies(blast.id).catch(() => [])
          : [];
        burstViews.push({
          id: b.id,
          blastId: b.blastId,
          taskIds: b.taskIds,
          status: b.status,
          createdAt: b.createdAt,
          blast: blast
            ? { slotsTotal: blast.slotsTotal, slotsFilled: filled, status: blast.status }
            : null,
          replies: replies.map((r) => ({
            channelId: r.channelId,
            workerId: r.workerId,
            repliedAt: r.repliedAt,
          })),
        });
      }
      res.json({ success: true, data: { cycle, contacts, logs, bursts: burstViews } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** GET /api/v1/automation/blocked */
  router.get('/blocked', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      res.json({ success: true, data: await automationRepository.listBlocked() });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** PUT /api/v1/automation/blocked */
  router.put('/blocked', validateBody(blockedSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const normalized = normalizeSubreddit(req.body.subreddit);
      if (!normalized) {
        res.status(400).json({ success: false, message: 'Invalid subreddit.' });
        return;
      }
      const userId = (req as unknown as { userId: string }).userId;
      const row = await automationRepository.addBlocked(normalized, req.body.reason || null, userId);
      res.json({ success: true, data: row });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** DELETE /api/v1/automation/blocked/:subreddit */
  router.delete('/blocked/:subreddit', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const raw = String(req.params.subreddit);
      const normalized = normalizeSubreddit(raw) || raw.toLowerCase();
      await automationRepository.removeBlocked(normalized);
      res.json({ success: true, data: { removed: normalized } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * Allowed subreddits (manager-cleared quarantine verdicts). A row skips
   * NAME screening for that exact normalized sub in future scans; content
   * screening and manual blocks are unaffected (blocks always win).
   */
  /** GET /api/v1/automation/allowed */
  router.get('/allowed', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      res.json({ success: true, data: await automationRepository.listAllowed() });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** PUT /api/v1/automation/allowed */
  router.put('/allowed', validateBody(blockedSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const normalized = normalizeSubreddit(req.body.subreddit);
      if (!normalized) {
        res.status(400).json({ success: false, message: 'Invalid subreddit.' });
        return;
      }
      const userId = (req as unknown as { userId: string }).userId;
      const row = await automationRepository.addAllowed(normalized, req.body.reason || null, userId);
      await auditLogService
        .log(AuditAction.AUTOMATION_ALLOWED, null, userId, `r/${normalized} cleared for future scans (name review)`)
        .catch(() => undefined);
      res.json({ success: true, data: row });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** DELETE /api/v1/automation/allowed/:subreddit */
  router.delete('/allowed/:subreddit', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const raw = String(req.params.subreddit);
      const normalized = normalizeSubreddit(raw) || raw.toLowerCase();
      await automationRepository.removeAllowed(normalized);
      res.json({ success: true, data: { removed: normalized } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** POST /api/v1/automation/session */
  router.post('/session', validateBody(sessionSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      await sessionService.save(req.body, userId);
      res.json({ success: true, data: { updated: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /** GET /api/v1/automation/reddit-session — safe status, never the secret. */
  router.get('/reddit-session', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const status = await redditSessionService.status();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** POST /api/v1/automation/reddit-session — paste/refresh the spare-account login cookie. */
  router.post('/reddit-session', validateBody(redditSessionSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      await redditSessionService.save(req.body, userId);
      res.json({ success: true, data: { updated: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /** GET /api/v1/automation/companion — watcher heartbeat + queue depth. */
  router.get('/companion', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const companion = await automationRepository.companionStatus();
      const pending = await automationRepository.listPendingClaims();
      const since = new Date(Date.now() - 15 * 60 * 1000);
      const fresh = await automationRepository.listNewSightings(since);
      res.json({
        success: true,
        data: {
          lastSeenAt: companion?.lastSeenAt || null,
          version: companion?.version || null,
          pendingClaims: pending.length,
          freshSightings: fresh.length,
          online: !!companion && Date.now() - companion.lastSeenAt.getTime() < 3 * 60 * 1000,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** GET /api/v1/automation/claims — pending claim queue (dashboard view). */
  router.get('/claims', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      res.json({ success: true, data: await automationRepository.listPendingClaims() });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/automation/test-contact — manual single-ticket Stage-2 test.
   * Sends the availability message to one ticket and opens a 5-min contact
   * window (same correlation as cycle contacts). Never scans or accepts.
   */
  router.post('/test-contact', validateBody(testContactSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      const channel = await discordClient.channels.fetch(req.body.channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) {
        res.status(400).json({ success: false, message: 'Ticket channel not found.' });
        return;
      }
      await channel.guild.members.fetch().catch(() => undefined);
      const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));
      if (candidates.size !== 1) {
        res.status(400).json({
          success: false,
          message:
            candidates.size === 0
              ? 'No worker found in this ticket.'
              : 'Multiple workers in this ticket — test needs exactly one.',
        });
        return;
      }
      const worker = candidates.first()!;
      const busy = await taskRepository.findAwaitingSubmissionInChannel(channel.id);
      if (busy) {
        res.status(400).json({ success: false, message: 'Worker already has an active task in this ticket.' });
        return;
      }

      const settings = await automationRepository.getSettings();
      const cycleId = `manual-${Date.now().toString(36)}`;
      await automationRepository.createCycle({ id: cycleId, dryRun: settings?.dryRun ?? true });

      const text = (req.body.message || 'hey {user} wanna do a post').replace('{user}', `<@${worker.id}>`);
      const msg = await channel.send(text);
      const contact = await automationRepository.createContact({
        cycleId,
        channelId: channel.id,
        workerId: worker.id,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        messageId: msg.id,
      });
      await automationRepository.updateCycle(cycleId, { workersContacted: 1 });
      await auditLogService.log(
        AuditAction.AUTOMATION_CONTACT_SENT,
        null,
        userId,
        `Manual test contact to <@${worker.id}> in #${channel.name}`,
      );
      res.json({
        success: true,
        data: {
          cycleId,
          contact,
          worker: { id: worker.id, name: worker.displayName || worker.user.username },
          channel: { id: channel.id, name: channel.name },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      logger.warn('POST /automation/test-contact failed', { message });
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/automation/test-accept — manual single-task accept test.
   * Requires an ACTIVE + CONFIRMED contact for the channel (stale replies
   * never count). Scans GoPartTime live, validates (Post/duplicate/blocked),
   * then accepts ONLY when body.accept=true AND the server flag
   * GOPARTTIME_AUTO_ACCEPT=true AND settings dryRun=false; otherwise logs
   * WOULD_ACCEPT without touching GoPartTime.
   */
  router.post('/test-accept', validateBody(testAcceptSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      const { externalTaskId, channelId } = req.body;

      const contact = await automationRepository.findConfirmedContact(channelId);
      if (!contact) {
        const latest = await automationRepository.findLatestContactByChannel(channelId);
        let message = 'No availability message sent to this ticket yet — use step 1 first.';
        if (latest) {
          if (latest.status === 'TIMED_OUT' || (latest.expiresAt && latest.expiresAt <= new Date())) {
            message = 'Reply window expired (5 min). Send the availability message again for a fresh window.';
          } else if (latest.status === 'CONTACTED') {
            message = 'No reply from the worker yet — waiting on their response.';
          } else if (latest.status === 'ASSIGNED') {
            message = 'This confirmation was already used for an accepted task.';
          }
        }
        res.status(400).json({ success: false, message });
        return;
      }

      const settings = await automationRepository.getSettings();
      const dryRun = settings?.dryRun ?? true;

      let detected;
      try {
        const scan = await scanTasks();
        detected = scan.tasks.find((t) => t.subTaskId === externalTaskId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ success: false, message: `GoPartTime scan failed: ${message}` });
        return;
      }
      if (!detected) {
        await automationRepository.logTask({
          cycleId: contact.cycleId, externalTaskId, taskType: 'unknown',
          subreddit: null, status: 'FAILED', workerId: contact.workerId, failureReason: 'Task no longer listed (taken or gone)',
        });
        res.status(400).json({ success: false, message: 'Task is no longer listed on GoPartTime (taken or gone).' });
        return;
      }

      const v = await validateDetectedTask(detected, {
        seenSubs: await loadSeenSubs().catch(() => undefined),
        allowedSubs: await loadAllowedSubs().catch(() => undefined),
      });
      await automationRepository.logTask({
        cycleId: contact.cycleId, externalTaskId, taskType: detected.type,
        subreddit: detected.subreddit, status: v.reason, workerId: contact.workerId,
      });
      if (!v.eligible) {
        res.status(400).json({ success: false, message: `Task rejected: ${v.reason} — ${v.detail || ''}`.trim() });
        return;
      }

      const live = req.body.accept === true && env.GOPARTTIME_AUTO_ACCEPT && !dryRun;
      if (!live) {
        await automationRepository.logTask({
          cycleId: contact.cycleId, externalTaskId, taskType: detected.type,
          subreddit: detected.subreddit, status: 'WOULD_ACCEPT', workerId: contact.workerId,
        });
        res.json({
          success: true,
          data: {
            wouldAccept: true,
            task: { subTaskId: detected.subTaskId, type: detected.type, subreddit: detected.subreddit, title: detected.title },
            reason: !req.body.accept
              ? 'Pass accept:true to perform the real acceptance.'
              : !env.GOPARTTIME_AUTO_ACCEPT
                ? 'Server flag GOPARTTIME_AUTO_ACCEPT is false.'
                : 'Settings dryRun is on.',
          },
        });
        return;
      }

      await automationRepository.updateContactStatus(contact.id, 'RESERVED');
      const session = await sessionService.load();
      const nextAction = session?.nextAction || '';
      if (!nextAction) {
        res.status(400).json({ success: false, message: 'No Next-Action id in session vault.' });
        return;
      }
      const ok = await acceptTask(externalTaskId, nextAction);
      if (!ok) {
        await automationRepository.updateContactStatus(contact.id, 'CONFIRMED');
        await automationRepository.logTask({
          cycleId: contact.cycleId, externalTaskId, taskType: detected.type,
          subreddit: detected.subreddit, status: 'FAILED', workerId: contact.workerId, failureReason: 'GoPartTime returned success=false',
        });
        await auditLogService.log(AuditAction.AUTOMATION_TASK_FAILED, null, userId, `Manual accept of ${externalTaskId} failed`);
        res.status(502).json({ success: false, message: 'GoPartTime accept returned success=false (someone else may have claimed it).' });
        return;
      }

      const existing = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, externalTaskId);
      if (existing) {
        // Double-checked after accept: another process recorded it first.
        await automationRepository.logTask({
          cycleId: contact.cycleId, externalTaskId, taskType: detected.type,
          subreddit: detected.subreddit, status: 'DUPLICATE', workerId: contact.workerId,
        });
        res.status(409).json({ success: false, message: 'Task was already recorded by another process.' });
        return;
      }
      await automationRepository.updateContactStatus(contact.id, 'ASSIGNED');
      await automationRepository.updateCycle(contact.cycleId, { postsAccepted: 1, workersConfirmed: 1, status: 'DONE', endedAt: new Date() });
      await automationRepository.logTask({
        cycleId: contact.cycleId, externalTaskId, taskType: detected.type,
        subreddit: detected.subreddit, status: 'ACCEPTED', workerId: contact.workerId,
      });
      await auditLogService.log(
        AuditAction.AUTOMATION_TASK_ACCEPTED, null, userId,
        `Manual accept: task ${externalTaskId} (${detected.subreddit || '?'}) claimed for <@${contact.workerId}>`,
      );
      res.json({
        success: true,
        data: {
          accepted: true,
          task: { subTaskId: detected.subTaskId, type: detected.type, subreddit: detected.subreddit, title: detected.title },
          next: 'Push the task to the ticket with the Tampermonkey Send Task button, then Done to activate.',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      logger.warn('POST /automation/test-accept failed', { message });
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/automation/rehearse — single-task live-fire rehearsal.
   * Runs every pre-flight check (ticket, worker, busy, daily cap, validator)
   * and, ONLY when body.live=true AND settings dryRun=false AND the server
   * flag GOPARTTIME_AUTO_ACCEPT=true, queues one claim for the companion
   * browser (which really accepts on GoPartTime + pushes to the ticket).
   * Otherwise returns wouldAccept:true with the check results and creates
   * nothing — safe to probe with at any time.
   */
  router.post('/rehearse', validateBody(rehearseSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as unknown as { userId: string }).userId;
      const { externalTaskId, channelId } = req.body;

      const channel = await discordClient.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) {
        res.status(400).json({ success: false, message: 'Ticket channel not found.' });
        return;
      }
      await channel.guild.members.fetch().catch(() => undefined);
      const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));
      if (candidates.size !== 1) {
        res.status(400).json({
          success: false,
          message:
            candidates.size === 0
              ? 'No worker found in this ticket.'
              : 'Multiple workers in this ticket — rehearsal needs exactly one.',
        });
        return;
      }
      const worker = candidates.first()!;
      const busy = await taskRepository.findAwaitingSubmissionInChannel(channel.id);
      if (busy) {
        res.status(400).json({ success: false, message: 'Worker already has an active task in this ticket.' });
        return;
      }

      const { dayStart, dayEnd } = getIstDayBoundaries();
      const assignedToday = await outreachService.countPostsAssignedToday(worker.id, dayStart, dayEnd);
      if (isAtDailyCap(assignedToday, DAILY_POST_CAP)) {
        res.status(400).json({
          success: false,
          message: `Worker at daily cap (${assignedToday}/${DAILY_POST_CAP}).`,
        });
        return;
      }

      const detected = {
        subTaskId: externalTaskId as string,
        taskId: externalTaskId as string,
        type: req.body.taskType as 'post' | 'comment',
        subreddit: (req.body.subreddit as string | null) || null,
        title: (req.body.title as string | null) || null,
        postLink: null,
        contentHtml: '',
        images: [],
        payment: null,
        deadline: null,
        karmaLimit: null,
        earnings: null,
      };
      const v = await validateDetectedTask(detected, {
        seenSubs: await loadSeenSubs().catch(() => undefined),
        allowedSubs: await loadAllowedSubs().catch(() => undefined),
      });

      const settings = await automationRepository.getSettings();
      const dryRun = settings?.dryRun ?? true;
      const liveFire = req.body.live === true && !dryRun && env.GOPARTTIME_AUTO_ACCEPT;
      const gateReason = !v.eligible
        ? `Task rejected: ${v.reason}${v.detail ? ` — ${v.detail}` : ''}`
        : req.body.live !== true
          ? 'Pass live:true to queue the real claim.'
          : dryRun
            ? 'Settings dryRun is on.'
            : !env.GOPARTTIME_AUTO_ACCEPT
              ? 'Server flag GOPARTTIME_AUTO_ACCEPT is false.'
              : null;

      const cycleId = `rehearse-${Date.now().toString(36)}`;
      await automationRepository.createCycle({ id: cycleId, dryRun: !liveFire });
      await automationRepository.logTask({
        cycleId,
        externalTaskId,
        taskType: detected.type,
        subreddit: detected.subreddit,
        status: v.eligible ? (liveFire ? 'ELIGIBLE' : 'WOULD_ACCEPT') : v.reason,
        workerId: worker.id,
        failureReason: v.eligible ? null : v.detail || v.reason,
      });

      if (!liveFire) {
        await automationRepository.updateCycle(cycleId, { status: 'DONE', endedAt: new Date() });
        res.json({
          success: true,
          data: {
            wouldAccept: v.eligible,
            reason: gateReason,
            task: { subTaskId: detected.subTaskId, type: detected.type, subreddit: detected.subreddit, title: detected.title },
            worker: { id: worker.id, name: worker.displayName || worker.user.username },
            channel: { id: channel.id, name: channel.name },
          },
        });
        return;
      }

      const claim = await automationRepository.createClaim({
        cycleId,
        externalTaskId,
        channelId: channel.id,
        workerId: worker.id,
        expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
      });
      await auditLogService.log(
        AuditAction.AUTOMATION_CYCLE_STARTED,
        null,
        userId,
        `Rehearsal claim queued: task ${externalTaskId} for <@${worker.id}> in #${channel.name}`,
      );
      res.json({
        success: true,
        data: {
          accepted: false,
          claimQueued: true,
          claim,
          cycleId,
          task: { subTaskId: detected.subTaskId, type: detected.type, subreddit: detected.subreddit, title: detected.title },
          worker: { id: worker.id, name: worker.displayName || worker.user.username },
          channel: { id: channel.id, name: channel.name },
          next: 'The companion browser picks up the claim within ~30s, accepts in-page, and pushes to the ticket.',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      logger.warn('POST /automation/rehearse failed', { message });
      res.status(400).json({ success: false, message });
    }
  });

  // ─── Companion endpoints (extension key via the dispatcher above) ───

  /** POST /api/v1/automation/sightings — task list snapshot from the watcher. */
  router.post('/sightings', validateBody(sightingsSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const companionId = req.body.companionId || null;
      await automationRepository.heartbeat(companionId, req.body.version || null);
      for (const t of req.body.tasks) {
        await automationRepository.upsertSighting({
          externalTaskId: t.subTaskId,
          taskType: t.type,
          subreddit: t.subreddit || null,
          title: t.title || null,
          companionId,
        });
      }
      if (req.body.tasks.length === 0 && req.body.debug) {
        logger.info('Companion sighting: zero tasks parsed', { debug: req.body.debug });
      }
      res.json({ success: true, data: { received: req.body.tasks.length } });
    } catch (error) {
      logger.warn('POST /automation/sightings failed', { error });
      res.status(400).json({ success: false, message: 'Invalid sightings payload.' });
    }
  });

  /**
   * GET /api/v1/automation/eligibility-bundle — cached eligibility data for
   * the watcher's in-page filter (blocked subreddits). The server re-validates
   * everything on /burst; this bundle only lets the browser skip the obvious
   * rejects in milliseconds. No history is shipped: listed + available means
   * takeable, so the browser reports everything readable.
   */
  router.get('/eligibility-bundle', async (_req: Request, res: Response): Promise<void> => {
    try {
      const blocked = await automationRepository.listBlocked();
      res.json({
        success: true,
        data: {
          version: 1,
          blocked: blocked.map((b) => b.subreddit),
        },
      });
    } catch (error) {
      logger.warn('GET /automation/eligibility-bundle failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/automation/burst — watcher's settled hourly scan report, or
   * a manual Blast Now (force:true bypasses the window gate only — the live
   * gate, validation, and one-blast-per-hour dedupe still apply).
   * Server re-validates every task (Post/blocked + readable subreddit; listed
   * means takeable, no history filter), then opens the hour's single blast —
   * or acknowledges an existing one without messaging. In dry-run: validates
   * + logs only, no blast. Always explains itself via `reason` when no blast.
   */
  router.post('/burst', validateBody(burstSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const companionId = req.body.companionId || null;
      await automationRepository.heartbeat(companionId, req.body.version || null);
      const tasks = req.body.tasks.map(
        (t: { subTaskId: string; type: 'post' | 'comment'; subreddit?: string | null; title?: string | null }) => ({
          subTaskId: t.subTaskId,
          type: t.type,
          subreddit: t.subreddit || null,
          title: t.title || null,
        }),
      );
      // On-demand scan reports (DM `scan` / scheduled hourly) are identified
      // BEFORE the flow runs. First report wins, atomically: takeRequest
      // returns the request only for the first caller, which gets its OWN
      // cycle + its own digest DM. Same-id duplicates (second tab, retries)
      // get null and take the normal auto path — merging into the hour's
      // open blast instead of opening a competing one (a competing blast
      // would supersede-close the first and re-message every ticket).
      // Forged or ancient ids are NOT manual: they keep the normal auto path.
      const rawScanRequestId = typeof req.body.scanRequestId === 'string' ? req.body.scanRequestId : null;
      // The winning report ALWAYS answers with its own digest DM (per-request
      // idempotency, never the hour gate). Same-id duplicates stay silent.
      const manualRequest = rawScanRequestId ? scanRequestService.takeRequest(rawScanRequestId) : null;
      const isManualReport = manualRequest !== null;
      const result = await createBurstFlow(discordClient, tasks, 'burst', {
        forceWindow: req.body.force === true,
        freshCycleOnly: isManualReport,
      });
      if (manualRequest) {
        void blastApprovalService
          .sendManualDigest(discordClient, result.cycleId, manualRequest.requestId, manualRequest.requestedBy)
          .catch(() => undefined);
      }
      // Digest DMs: the pre-blast report for a freshly opened automatic blast
      // already went out inside createBurstFlow (awaited, DM-before-blast).
      // What remains here: rounds that opened NOTHING still report (banned-only
      // or empty — "nothing listed" — so no hour stays silent), and merges
      // into a live hour blast DM once as information.
      if (!isManualReport && req.body.force !== true && result.blast === null && !result.merged &&
        result.reason === NO_ELIGIBLE_REASON
      ) {
        void blastApprovalService
          .maybeSendDigest(discordClient, result.cycleId, result.scanned)
          .catch(() => undefined);
      } else if (
        !isManualReport &&
        req.body.force !== true &&
        result.merged === true &&
        result.blast !== null &&
        !blastApprovalService.digestSentForHour(getIstHourStart().getTime()) &&
        // Same-scan duplicates stay fully silent: the winning report's
        // manual digest already covered this content (fixes the double-DM).
        !(rawScanRequestId && scanRequestService.wasRequested(rawScanRequestId))
      ) {
        void blastApprovalService
          .maybeSendDigest(discordClient, result.cycleId, result.scanned)
          .catch(() => undefined);
      }
      res.json({
        success: true,
        data: {
          cycleId: result.cycleId,
          eligible: result.eligible.map((t) => ({
            subTaskId: t.subTaskId,
            subreddit: t.subreddit,
            title: t.title,
          })),
          blocked: result.blocked,
          duplicates: result.duplicates,
          commentsSkipped: result.commentsSkipped,
          quarantined: result.quarantined,
          blast: result.blast,
          sent: result.sent,
          skipped: result.skipped,
          dryRun: result.dryRun,
          merged: result.merged,
          added: result.added,
          reason: result.reason,
        },
      });
    } catch (error) {
      logger.warn('POST /automation/burst failed', { error });
      res.status(400).json({ success: false, message: 'Invalid burst payload.' });
    }
  });

  /** GET /api/v1/automation/claims/pending — oldest actionable claim (also a heartbeat). */
  router.get('/claims/pending', async (req: Request, res: Response): Promise<void> => {
    try {
      const version = typeof req.query.version === 'string' ? req.query.version : null;
      const companionId = typeof req.query.companionId === 'string' ? req.query.companionId : null;
      await automationRepository.heartbeat(companionId, version);
      // Staleness radar: a stale watcher silently stops auto-reporting, so
      // every version transition is logged (upgrades and regressions alike).
      if (shouldLogVersionChange(lastCompanionVersion, version)) {
        logger.info('Companion watcher version', { previous: lastCompanionVersion, version });
        lastCompanionVersion = version;
      }
      // Phase-2 parallel tabs: a tab id leases the oldest actionable claim
      // atomically (two tabs never hold the same claim). Watchers without a
      // tab id keep the legacy oldest-first pickup.
      const rawTabId = typeof req.query.tabId === 'string' ? req.query.tabId.trim() : '';
      const tabId = rawTabId.length > 0 && rawTabId.length <= 64 ? rawTabId : null;
      // Parked retries: a tab lists claim ids it failed once and parked, so
      // other actionable work is handed first and the retry comes back only
      // when nothing else is leasable (retry runs last). Absent on old tabs.
      const rawDefer = typeof req.query.defer === 'string' ? req.query.defer : '';
      const deferIds = rawDefer
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64)
        .slice(0, 20);
      const claim = tabId
        ? await automationRepository.leaseNextClaim(tabId, AUTOMATION.CLAIM_LEASE_TIMEOUT_MS, deferIds)
        : await automationRepository.pendingClaim();
      // Scan telemetry (watcher v1.4.6+): last monitor outcome per tab, so
      // "empty listing" vs "stalled/off-page scan" is distinguishable from
      // logs alone. Debug level (invisible by default; flip LOG_LEVEL to
      // debug during an incident). Never affects the response.
      const telePage = typeof req.query.page === 'string' ? req.query.page.slice(0, 64) : null;
      const teleScan = typeof req.query.scan === 'string' ? Number(req.query.scan) : NaN;
      const teleElig = typeof req.query.elig === 'string' ? Number(req.query.elig) : NaN;
      const telePost = typeof req.query.post === 'string' ? Number(req.query.post) : NaN;
      const telePostOk = typeof req.query.postOk === 'string' ? Number(req.query.postOk) : NaN;
      // Consecutive scans the watcher could not read at all. Distinct from
      // `scanned: 0` (an hour that genuinely published nothing): a non-zero
      // value means the page shape changed, the payload was stripped, or the
      // transport failed, and the watcher is deliberately NOT reporting an
      // empty drop in that case.
      const teleUnreadable = typeof req.query.unreadable === 'string' ? Number(req.query.unreadable) : NaN;
      let telePostAt: string | null = null;
      if (Number.isFinite(telePost) && telePost > 0 && telePost < 4102444800000) {
        try {
          telePostAt = new Date(telePost).toISOString();
        } catch {
          telePostAt = null;
        }
      }
      if (telePage !== null || Number.isFinite(teleScan) || Number.isFinite(teleElig) || telePostAt !== null) {
        logger.debug('Companion scan telemetry', {
          tabId,
          page: telePage,
          scanned: Number.isFinite(teleScan) ? teleScan : null,
          eligible: Number.isFinite(teleElig) ? teleElig : null,
          postAt: telePostAt,
          postOk: Number.isFinite(telePostOk) ? telePostOk : null,
        });
      }
      // Loud, not debug: an unreadable page is a fault that silently stops
      // scanning, and it is the single most important thing to see in a log.
      if (Number.isFinite(teleUnreadable) && teleUnreadable > 0) {
        logger.warn('Companion cannot read the /tasks page - NOT reporting an empty drop', {
          tabId,
          consecutiveUnreadableScans: teleUnreadable,
          page: telePage,
        });
      }
      // Phase-1 speed: tell the tab whether work is live so it can poll fast
      // (2s) while work is live and idle (30s) otherwise. A burst row is not
      // the whole signal: the fill closes it on the very same reply that
      // creates the LAST claim, so gating on it alone dropped the final task
      // of every blast back to the 30-40s cadence. Any PENDING claim (even
      // one a tab parked mid-flight) keeps the fast poll alive.
      // Best-effort — a lookup failure must never break the claim poll.
      let burstOpen = false;
      try {
        const openBursts = await automationRepository.listOpenBursts();
        burstOpen = openBursts.length > 0 || (await automationRepository.hasPendingClaim());
      } catch {
        burstOpen = false;
      }
      if (!claim) {
        // On-demand scan: a pending `/scan` request rides the poll so the
        // watcher performs one immediate full scan + settled report.
        // Best-effort — a lookup failure must never break the claim poll.
        let scanNow: string | null = null;
        try {
          scanNow = scanRequestService.pendingRequest()?.requestId ?? null;
        } catch {
          scanNow = null;
        }
        res.json({ success: true, data: { claim: null, burstOpen, scanNow } });
        return;
      }
      // Expected subreddit for the browser's drawer ground-truth check
      // (aborts the accept on mismatch — never accept on a heuristic miss).
      let claimSubreddit: string | null = null;
      // Tier-0 flag for Tier-1: whether the sub was seen in a PRIOR cycle,
      // plus the title-only signal when unseen. Computed from the pooled
      // details the report already stored — no extra schema, no migration.
      // Per-claim cost only (not per poll): claims are rare, polls are not.
      let seenBefore: boolean | null = null;
      let contentReview: string | null = null;
      try {
        const bursts = await automationRepository.listBurstsByCycle(claim.cycleId);
        const latest = bursts[bursts.length - 1];
        if (latest) {
          const details = parsePooledTasks(latest.taskDetails, latest.taskIds);
          const pooled = details.find((d) => d.id === claim.externalTaskId);
          claimSubreddit = pooled?.subreddit ?? null;
          const normalized = normalizeSubreddit(claimSubreddit);
          if (normalized) {
            const seen = await loadSeenSubs(claim.cycleId).catch(() => null);
            if (seen) {
              seenBefore = seen.has(normalized);
              if (!seenBefore) {
                const hit = screenTitle(pooled?.title ?? null);
                if (hit) contentReview = hit.signal;
              }
            }
          }
        }
      } catch {
        // leave nulls — the browser skips Tier-1 without these hints
      }
      res.json({
        success: true,
        data: {
          burstOpen,
          scanNow: (() => {
            try {
              return scanRequestService.pendingRequest()?.requestId ?? null;
            } catch {
              return null;
            }
          })(),
          claim: {
            id: claim.id,
            cycleId: claim.cycleId,
            externalTaskId: claim.externalTaskId,
            channelId: claim.channelId,
            ticket: claim.channelId,
            workerId: claim.workerId,
            subreddit: claimSubreddit,
            seenBefore,
            contentReview,
            createdAt: claim.createdAt,
            expiresAt: claim.expiresAt,
          },
        },
      });
    } catch (error) {
      logger.warn('GET /automation/claims/pending failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /** POST /api/v1/automation/claims/:id/result — in-page accept verdict. */
  router.post('/claims/:id/result', validateBody(claimResultSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const claim = await automationRepository.findClaim(String(req.params.id));
      if (!claim || claim.status !== 'PENDING') {
        res.status(404).json({ success: false, message: 'Claim not found or already resolved.' });
        return;
      }
      if (claim.expiresAt <= new Date()) {
        await automationRepository.resolveClaim(claim.id, 'EXPIRED', 'Reported after expiry');
        if (req.body.ok) {
          // The browser DID accept on GoPartTime but reported too late: the
          // task is claimed over there, so record it instead of dropping it
          // silently. Push state is unknown — the manager verifies the ticket.
          await automationRepository.logTask({
            cycleId: claim.cycleId,
            externalTaskId: claim.externalTaskId,
            taskType: 'post',
            subreddit: null,
            status: 'ACCEPTED',
            workerId: claim.workerId,
            failureReason: 'Reported after expiry — verify the ticket push manually',
          });
          await auditLogService.log(
            AuditAction.AUTOMATION_TASK_ACCEPTED, null, 'companion',
            `Task ${claim.externalTaskId} accepted late via companion for channel ${claim.channelId} (claim had expired)`,
          );
          res.json({ success: true, data: { recorded: true, late: true } });
          return;
        }
        await automationRepository.logTask({
          cycleId: claim.cycleId,
          externalTaskId: claim.externalTaskId,
          taskType: 'post',
          subreddit: null,
          status: 'FAILED',
          workerId: claim.workerId,
          failureReason: req.body.failureReason || 'Companion reported failure after expiry',
        });
        // No post from this round: remove the winner's availability message.
        try {
          const bursts = await automationRepository.listBurstsByCycle(claim.cycleId).catch(() => []);
          const round = bursts.find((b) => b.status === 'OPEN') ?? bursts[0];
          if (round) await outreachService.deleteBlastMessage(discordClient, round.blastId, claim.channelId);
        } catch {
          // best-effort
        }
        res.status(410).json({ success: false, message: 'Claim expired.' });
        return;
      }

      if (req.body.ok) {
        await automationRepository.resolveClaim(claim.id, 'CLAIMED');
        logClaimTimings(claim, true, req.body.timings);
        recordScreenReport(req.body.screenReport, claim.externalTaskId);
        const pushed = req.body.pushed === true;
        try {
          const contacts = await automationRepository.listCycleContacts(claim.cycleId);
          const held = contacts.find(
            (c: { channelId: string; status: string }) =>
              c.channelId === claim.channelId && (c.status === 'RESERVED' || c.status === 'CONTACTED'),
          );
          if (held) await automationRepository.updateContactStatus(held.id, 'ASSIGNED');
          const cycle = await automationRepository.getCycle(claim.cycleId);
          if (cycle) {
            await automationRepository.updateCycle(claim.cycleId, { postsAccepted: cycle.postsAccepted + 1 });
          }
        } catch {
          // best-effort bookkeeping; the claim verdict itself is recorded
        }
        await automationRepository.logTask({
          cycleId: claim.cycleId,
          externalTaskId: claim.externalTaskId,
          taskType: 'post',
          subreddit: null,
          status: pushed ? 'ACCEPTED' : 'NEEDS_PUSH',
          workerId: claim.workerId,
          failureReason: pushed ? null : 'Accepted on GoPartTime but not delivered to Discord — push via Send Task button',
        });
        await auditLogService.log(
          AuditAction.AUTOMATION_TASK_ACCEPTED, null, 'companion',
          pushed
            ? `Task ${claim.externalTaskId} accepted via companion for channel ${claim.channelId}`
            : `Task ${claim.externalTaskId} accepted via companion but NEEDS manual push to channel ${claim.channelId}`,
        );
      } else {
        const reason = req.body.failureReason || 'Companion reported failure';
        await automationRepository.resolveClaim(claim.id, 'FAILED', reason);
        logClaimTimings(claim, false, req.body.timings);
        recordScreenReport(req.body.screenReport, claim.externalTaskId);
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
          AuditAction.AUTOMATION_TASK_FAILED, null, 'companion',
          `Task ${claim.externalTaskId} failed via companion: ${reason}`,
        );
        // Tier-1 server half: the browser aborted on a full-content hit and
        // asks for an auto-block. Never breaks the verdict — the failure is
        // already recorded above; the move-on retry below still runs.
        // A fresh block also shrinks any open round holding pooled posts
        // from that sub (slots drop, excess winners' messages go).
        let blockedSub: string | null = null;
        if (req.body.autoBlock) {
          try {
            const seen = await loadSeenSubs(claim.cycleId).catch(() => undefined);
            const outcome = await handleAutoBlockReport(
              {
                subreddit: req.body.autoBlock.subreddit,
                signal: req.body.autoBlock.signal,
                matched: req.body.autoBlock.matched ?? null,
                snippet: req.body.autoBlock.snippet ?? null,
              },
              { seenSubs: seen },
            );
            logger.info('Tier-1 auto-block verdict processed', {
              claimId: claim.id,
              task: claim.externalTaskId,
              outcome: outcome.outcome,
            });
            if (
              outcome.subreddit &&
              (outcome.disposition === 'blocked' || outcome.disposition === 'already-blocked')
            ) {
              blockedSub = outcome.subreddit;
            }
            if (outcome.notice && outcome.subreddit) {
              await blastApprovalService
                .sendAutoBlockNotice(discordClient, outcome.notice, {
                  subreddit: outcome.subreddit,
                  externalTaskId: claim.externalTaskId,
                })
                .catch(() => undefined);
            }
          } catch (error) {
            logger.warn('Tier-1 auto-block handling failed (verdict kept)', { claimId: claim.id, error });
          }
        }
        // Move on: the worker replied but this task failed — queue them for
        // the next unheld task instead of abandoning a willing winner. Each
        // iteration excludes one more task id, so this chain terminates.
        let retried: { claimId: string; externalTaskId: string } | null = null;
        try {
          const workerId = claim.workerId;
          const bursts = await automationRepository.listBurstsByCycle(claim.cycleId);
          const open = bursts.find((b) => b.status === 'OPEN');
          if (open && workerId && claim.channelId) {
            const cycleClaims = await automationRepository.listCycleClaims(claim.cycleId).catch(() => []);
            const taken = new Set(
              cycleClaims.filter((c) => c.status !== 'EXPIRED').map((c) => c.externalTaskId),
            );
            const next = pickNextTask(open.taskIds, taken);
            if (next) {
              const busy = await taskRepository.findAwaitingSubmissionInChannel(claim.channelId).catch(() => null);
              const { dayStart, dayEnd } = getIstDayBoundaries();
              const assignedToday = await outreachService
                .countPostsAssignedToday(workerId, dayStart, dayEnd)
                .catch(() => DAILY_POST_CAP);
              if (!busy && !isAtDailyCap(assignedToday, DAILY_POST_CAP)) {
                const follow = await automationRepository.createClaim({
                  cycleId: claim.cycleId,
                  externalTaskId: next,
                  channelId: claim.channelId,
                  workerId,
                  expiresAt: new Date(Date.now() + AUTOMATION.BURST_CLAIM_TTL_MS),
                });
                await automationRepository.logTask({
                  cycleId: claim.cycleId,
                  externalTaskId: next,
                  taskType: 'post',
                  subreddit: null,
                  status: 'ELIGIBLE',
                  workerId,
                  failureReason: `Retry for ${workerId} after ${claim.externalTaskId} failed: ${reason}`,
                });
                logger.info('Burst retry claim queued', { claimId: follow.id, task: next, channelId: claim.channelId });
                retried = { claimId: follow.id, externalTaskId: next };
              }
            }
          }
        } catch {
          // best-effort; the failure itself is already recorded above
        }
        if (blockedSub) {
          await outreachService.shrinkBlastsForBlockedSub(discordClient, blockedSub).catch(() => undefined);
        }
        if (!retried) {
          // Winner gets no post from this round: remove their availability
          // message so the ticket doesn't promise what never arrives.
          try {
            const bursts = await automationRepository.listBurstsByCycle(claim.cycleId).catch(() => []);
            const round = bursts.find((b) => b.status === 'OPEN') ?? bursts[0];
            if (round) await outreachService.deleteBlastMessage(discordClient, round.blastId, claim.channelId);
          } catch {
            // best-effort; the verdict response is already decided
          }
        }
        res.json({ success: true, data: { recorded: true, retried: retried !== null, ...(retried || {}) } });
      }
    } catch (error) {
      logger.warn('POST /automation/claims/:id/result failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  return router;
}