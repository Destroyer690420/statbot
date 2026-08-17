import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { goparttimeService } from '../../services/goparttime.service';
import { goPartTimePayloadSchema } from '../../utils/goparttime-payload';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { logger } from '../../utils/logger';
import { taskRepository } from '../../database/repositories';
import { reminderService } from '../../services/reminder.service';
import { toTask } from '../../database/converters';
import { GOPARTTIME_SOURCE } from '../../config/constants';
import { resolveInsightReminder, buildManualTaskIdCandidates } from '../../services/goparttime-insight.service';

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

  /**
   * GET /api/v1/goparttime/insight/:externalTaskId?step=1|2
   * Returns the stored Statbot insight screenshot for a GoPartTime task's
   * current view-data step (1 = 20h insight, 2 = 70h insight for posts).
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies reminders or tasks.
   */
  router.get('/insight/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      let step: number | undefined;
      if (req.query.step !== undefined) {
        step = Number(req.query.step);
        if (!Number.isInteger(step)) {
          res.status(400).json({ success: false, message: 'Invalid step. Use 1 or 2.' });
          return;
        }
      }

      let taskDoc = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, externalTaskId);

      // Tasks are sometimes created manually (slash command / dashboard) with
      // the GoPartTime number embedded in the id ("POST #688318"). Fall back
      // to those when no GoPartTime-linked task exists — but only for manual
      // tasks (no source), so a real GoPartTime task is never shadowed.
      if (!taskDoc) {
        for (const candidateId of buildManualTaskIdCandidates(externalTaskId)) {
          const candidate = await taskRepository.findById(candidateId);
          if (candidate && !candidate.source) {
            taskDoc = candidate;
            break;
          }
        }
      }

      if (!taskDoc) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      const task = toTask(taskDoc);
      const reminders = await reminderService.findByTaskId(task.id);
      const { reminder, step: resolvedStep } = resolveInsightReminder(reminders, task.type, step);

      if (!reminder) {
        res.json({
          success: true,
          data: {
            taskId: externalTaskId,
            internalTaskId: task.id,
            type: task.type,
            reminderId: null,
            reminderType: null,
            step: resolvedStep,
            completed: false,
            imageUrl: null,
            message: 'No insight data available for this task yet.',
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          reminderId: reminder.id,
          reminderType: reminder.type,
          step: resolvedStep,
          completed: reminder.completed,
          imageUrl: reminder.insightImageUrl,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  return router;
}
