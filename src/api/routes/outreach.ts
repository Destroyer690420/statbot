import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { z } from 'zod';
import { outreachService } from '../../services/outreach.service';
import { authMiddleware, AuthRequest, requireDashboardAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { getDb } from '../../database/db';
import { outreachRepository, ticketInactivityRepository } from '../../database/repositories';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';
import { logger } from '../../utils/logger';

const selectionSchema = z.object({
  selections: z
    .array(
      z.object({
        channelId: z.string().min(1),
        selected: z.boolean(),
      }),
    )
    .max(500),
});

const settingsSchema = z.object({
  message: z.string().min(1).max(2000),
});

export default function createOutreachRoutes(discordClient: Client): Router {
  const router = Router();

  router.use(authMiddleware);

  /**
   * GET /api/v1/outreach
   * Full daily outreach page state: every ticket channel with its worker,
   * selection, and today's Available/Post/Comment status.
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const status = await outreachService.getStatus(discordClient);
      res.json({ success: true, data: status });
    } catch (error) {
      logger.error('GET /outreach failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * PUT /api/v1/outreach/selection
   * Persists the checked/unchecked state per ticket channel.
   */
  router.put('/selection', validateBody(selectionSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const updated = await outreachService.saveSelection(req.body.selections);
      res.json({ success: true, data: { updated } });
    } catch (error) {
      logger.error('PUT /outreach/selection failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/outreach/send
   * Opens a blast campaign with `slots` availability slots across every
   * currently selected ticket (skipping capped workers). First-n repliers win.
   */
  router.post(
    '/send',
    validateBody(z.object({ slots: z.number().int().min(1).max(500) })),
    async (req: Request, res: Response): Promise<void> => {
      if (!requireDashboardAdmin(req, res)) return;
      try {
        const userId = (req as AuthRequest).userId || null;
        const result = await outreachService.sendBlast(discordClient, req.body.slots, userId);
        res.json({ success: true, data: result });
      } catch (error) {
        logger.error('POST /outreach/send failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * GET /api/v1/outreach/settings
   * Returns the configured daily outreach message.
   */
  router.get('/settings', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const message = await outreachService.getMessage();
      res.json({ success: true, data: { message } });
    } catch (error) {
      logger.error('GET /outreach/settings failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * PUT /api/v1/outreach/settings
   * Updates the configurable daily outreach message.
   */
  router.put('/settings', validateBody(settingsSchema), async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const userId = (req as AuthRequest).userId || 'unknown';
      const message = await outreachService.updateMessage(req.body.message, userId);
      res.json({ success: true, data: { message } });
    } catch (error) {
      logger.error('PUT /outreach/settings failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * GET /api/v1/outreach/dead-tickets
   * Lists outreach rows whose Discord channel no longer resolves (deleted
   * tickets) with last-known names, so they can be pruned from the selection.
   */
  router.get('/dead-tickets', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    try {
      const dead = await outreachService.findDeadTickets(discordClient);
      res.json({ success: true, data: { dead } });
    } catch (error) {
      logger.error('GET /outreach/dead-tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * DELETE /api/v1/outreach/dead-tickets
   * Deletes outreach rows for the given dead-ticket channel ids.
   */
  router.delete(
    '/dead-tickets',
    validateBody(z.object({ channelIds: z.array(z.string().min(1)).max(500) })),
    async (req: Request, res: Response): Promise<void> => {
      if (!requireDashboardAdmin(req, res)) return;
      try {
        const deleted = await outreachService.deleteDeadTickets(req.body.channelIds);
        res.json({ success: true, data: { deleted } });
      } catch (error) {
        logger.error('DELETE /outreach/dead-tickets failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * DELETE /api/v1/outreach/tickets/:channelId
   * Deletes the specified ticket channel in Discord, removes it from outreach,
   * updates inactivity status to DELETED, and logs the action.
   */
  router.delete('/tickets/:channelId', async (req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(req, res)) return;
    const channelId = req.params.channelId as string;
    const userId = (req as AuthRequest).userId || 'unknown';

    try {
      let channelName: string | null = null;
      let channelFound = false;

      try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel && 'name' in channel && 'delete' in channel) {
          channelName = (channel as any).name || null;
          channelFound = true;
          await (channel as any).delete(`Deleted via Daily Outreach dashboard by ${userId}`);
          logger.info(`Discord channel ${channelId} (#${channelName}) deleted via Daily Outreach`, { userId });
        }
      } catch (discErr: any) {
        if (discErr.code === 10003) {
          logger.info(`Channel ${channelId} was already deleted in Discord`, { channelId });
        } else {
          logger.warn(`Failed deleting Discord channel ${channelId}`, { error: discErr });
        }
      }

      // Remove from TicketOutreach table
      await getDb().ticketOutreach.deleteMany({
        where: { channelId },
      }).catch((err) => logger.warn('Failed deleting ticketOutreach row', { channelId, error: err }));

      // Mark in TicketInactivity as DELETED
      await ticketInactivityRepository.recordDeleted(channelId, null, new Date()).catch((err) => {
        logger.warn('Failed updating ticketInactivity recordDeleted', { channelId, error: err });
      });

      // Audit log
      await auditLogService.log(
        AuditAction.TICKET_DELETED,
        null,
        userId,
        `Ticket channel ${channelId} (#${channelName || 'unknown'}) deleted by admin via Daily Outreach dashboard.`,
      ).catch(() => undefined);

      res.json({
        success: true,
        message: `Ticket #${channelName || channelId} deleted successfully.`,
        data: { channelId, channelName, channelFound },
      });
    } catch (error) {
      logger.error('DELETE /outreach/tickets/:channelId failed', { channelId, error });
      res.status(500).json({ success: false, message: 'Failed to delete ticket channel.' });
    }
  });

  /**
   * PUT /api/v1/outreach/tickets/:channelId/limit
   * Updates the daily post limit for a ticket channel (e.g. workers with multiple IDs).
   */
  router.put(
    '/tickets/:channelId/limit',
    validateBody(z.object({ limit: z.number().int().min(1).max(50) })),
    async (req: Request, res: Response): Promise<void> => {
      if (!requireDashboardAdmin(req, res)) return;
      const channelId = req.params.channelId as string;
      const limit = req.body.limit;
      try {
        const updated = await outreachRepository.updateTicketLimit(channelId, limit);
        res.json({ success: true, data: { channelId, dailyPostLimit: updated.dailyPostLimit } });
      } catch (error) {
        logger.error('PUT /outreach/tickets/:channelId/limit failed', { channelId, limit, error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  return router;
}
