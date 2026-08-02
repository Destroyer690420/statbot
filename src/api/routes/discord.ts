import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { goparttimeService } from '../../services/goparttime.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export default function createDiscordRoutes(discordClient: Client): Router {
  const router = Router();

  router.use(authMiddleware);

  function requireDashboardAdmin(req: Request, res: Response): boolean {
    const username = (req as AuthRequest).userId || '';
    if (username !== env.DASHBOARD_USERNAME) {
      res.status(403).json({ success: false, message: 'Admin access required.' });
      return false;
    }
    return true;
  }

  /**
   * GET /api/v1/discord/tickets
   * Lists all text channels as tickets with their GoPartTime task state.
   */
  router.get('/tickets', async (_req: Request, res: Response): Promise<void> => {
    if (!requireDashboardAdmin(_req, res)) return;

    try {
      const tickets = await goparttimeService.listTickets(discordClient);
      res.json({ success: true, data: tickets });
    } catch (error) {
      logger.error('GET /discord/tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  return router;
}
