import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { z } from 'zod';
import { outreachService } from '../../services/outreach.service';
import { authMiddleware, AuthRequest, requireDashboardAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
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

  return router;
}