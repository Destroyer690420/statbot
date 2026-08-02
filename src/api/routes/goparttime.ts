import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { goparttimeService } from '../../services/goparttime.service';
import { goPartTimePayloadSchema } from '../../utils/goparttime-payload';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { logger } from '../../utils/logger';

/**
 * Endpoints used by the GoPartTime browser extension. Authenticated with the
 * shared extension token (GOPARTTIME_API_KEY) — the equivalent of the
 * dashboard JWT for this external client.
 */
export default function createGoPartTimeRoutes(discordClient: Client): Router {
  const router = Router();

  router.use(extensionAuth);

  /**
   * GET /api/v1/goparttime/tickets
   * Lists text channels the extension can assign tasks to.
   */
  router.get('/tickets', async (_req: Request, res: Response): Promise<void> => {
    try {
      const tickets = await goparttimeService.listTickets(discordClient);
      res.json({ success: true, data: tickets });
    } catch (error) {
      logger.error('GET /goparttime/tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/goparttime/assign
   * Creates + delivers a task from the extension payload. Returns 409 with
   * the existing task when the GoPartTime task ID was already assigned.
   */
  router.post(
    '/assign',
    validateBody(goPartTimePayloadSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await goparttimeService.assignFromGoPartTime(req.body, discordClient);

        if (!result.created) {
          res.status(409).json({
            success: false,
            message: `Task has already been assigned (task ${req.body.taskId}).`,
            data: result.task,
          });
          return;
        }

        res.status(result.failed ? 200 : 201).json({
          success: true,
          data: result.task,
          failed: result.failed || false,
          error: result.error,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        logger.warn('POST /goparttime/assign failed', { message });
        res.status(400).json({ success: false, message });
      }
    },
  );

  return router;
}
