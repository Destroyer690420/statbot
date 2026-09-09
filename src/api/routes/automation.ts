import { Router, Request, Response, NextFunction } from 'express';
import { Client, TextChannel } from 'discord.js';
import { z } from 'zod';
import { automationRepository, taskRepository } from '../../database/repositories';
import { sessionService } from '../../services/automation/session.service';
import { normalizeSubreddit } from '../../services/automation/subreddit';
import { validateDetectedTask } from '../../services/automation/validator.service';
import { scanTasks, acceptTask } from '../../services/automation/poller.service';
import { runCycle } from '../../services/automation/cycle.service';
import { authMiddleware, AuthRequest, requireDashboardAdmin } from '../middleware/auth';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';
import { GOPARTTIME_SOURCE } from '../../config/constants';
import { getAllAdminIds } from '../../utils/permissions';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

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

const testContactSchema = z.object({
  channelId: z.string().min(5).max(32),
  message: z.string().min(1).max(500).optional().nullable(),
});

const testAcceptSchema = z.object({
  externalTaskId: z.string().regex(/^\d+$/),
  channelId: z.string().min(5).max(32),
  accept: z.boolean().optional().default(false),
});

const sightingTaskSchema = z.object({
  subTaskId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  type: z.enum(['post', 'comment']),
  subreddit: z.string().max(64).optional().nullable(),
  title: z.string().max(300).optional().nullable(),
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

const claimResultSchema = z.object({
  ok: z.boolean(),
  failureReason: z.string().max(500).optional().nullable(),
  pushed: z.boolean().optional().default(false),
});

export default function createAutomationRoutes(discordClient: Client): Router {
  const router = Router();

  // Dual auth on one prefix: the manager-browser companion uses the shared
  // extension key, everything else uses the dashboard JWT. A single router is
  // REQUIRED — two routers on the same prefix would let the first router's
  // router.use(auth) intercept (and reject) the other scheme's paths before
  // they ever reach their own router.
  router.use((req: Request, res: Response, next: NextFunction): void => {
    const p = req.path;
    if (p === '/sightings' || p === '/claims/pending' || /^\/claims\/[^/]+\/result$/.test(p)) {
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
      res.json({ success: true, data: { cycle, contacts, logs } });
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

      const v = await validateDetectedTask(detected);
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

  /** GET /api/v1/automation/claims/pending — oldest actionable claim (also a heartbeat). */
  router.get('/claims/pending', async (req: Request, res: Response): Promise<void> => {
    try {
      const version = typeof req.query.version === 'string' ? req.query.version : null;
      const companionId = typeof req.query.companionId === 'string' ? req.query.companionId : null;
      await automationRepository.heartbeat(companionId, version);
      const claim = await automationRepository.pendingClaim();
      if (!claim) {
        res.json({ success: true, data: { claim: null } });
        return;
      }
      res.json({
        success: true,
        data: {
          claim: {
            id: claim.id,
            cycleId: claim.cycleId,
            externalTaskId: claim.externalTaskId,
            channelId: claim.channelId,
            ticket: claim.channelId,
            workerId: claim.workerId,
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
        res.status(410).json({ success: false, message: 'Claim expired.' });
        return;
      }

      if (req.body.ok) {
        await automationRepository.resolveClaim(claim.id, 'CLAIMED');
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
      }
      res.json({ success: true, data: { recorded: true } });
    } catch (error) {
      logger.warn('POST /automation/claims/:id/result failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  return router;
}
