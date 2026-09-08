import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { automationRepository } from '../../database/repositories';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';
import { logger } from '../../utils/logger';

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
});

const claimResultSchema = z.object({
  ok: z.boolean(),
  failureReason: z.string().max(500).optional().nullable(),
});

/**
 * Endpoints for the manager-browser companion script (hybrid flow).
 * Authenticated with the shared extension key (GOPARTTIME_API_KEY), like the
 * send-task userscript — the companion runs in the manager's own session, so
 * the server never touches GoPartTime here.
 */
export default function createAutomationCompanionRoutes(): Router {
  const router = Router();

  router.use(extensionAuth);

  /** POST /api/v1/automation/sightings — task list snapshot from the watcher. */
  router.post('/sightings', validateBody(sightingsSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const companionId = req.body.companionId || null;
      await automationRepository.heartbeat(companionId, req.body.version || null);
      let fresh = 0;
      for (const t of req.body.tasks) {
        const row = await automationRepository.upsertSighting({
          externalTaskId: t.subTaskId,
          taskType: t.type,
          subreddit: t.subreddit || null,
          title: t.title || null,
          companionId,
        });
        void row;
        fresh++;
      }
      res.json({ success: true, data: { received: req.body.tasks.length, upserted: fresh } });
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
        await auditLogService.log(
          AuditAction.AUTOMATION_TASK_ACCEPTED, null, 'companion',
          `Task ${claim.externalTaskId} accepted via companion for channel ${claim.channelId}`,
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
