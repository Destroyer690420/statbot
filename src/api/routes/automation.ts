import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { z } from 'zod';
import { automationRepository } from '../../database/repositories';
import { sessionService } from '../../services/automation/session.service';
import { normalizeSubreddit } from '../../services/automation/subreddit';
import { runCycle } from '../../services/automation/cycle.service';
import { authMiddleware, requireDashboardAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';
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

export default function createAutomationRoutes(discordClient: Client): Router {
  const router = Router();
  router.use(authMiddleware);

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

  return router;
}
