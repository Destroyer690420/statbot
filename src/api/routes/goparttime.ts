import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { z } from 'zod';
import { goparttimeService } from '../../services/goparttime.service';
import { goPartTimePayloadSchema } from '../../utils/goparttime-payload';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { redditSessionService } from '../../services/reddit-session.service';
import { logger } from '../../utils/logger';
import { reminderService } from '../../services/reminder.service';
import { resolveInsightReminder } from '../../services/goparttime-insight.service';
import { buildManualTaskIdCandidates, resolveSubmittedRedditUrl } from '../../services/goparttime-task-lookup.service';
import { taskRepository } from '../../database/repositories';
import { toTask } from '../../database/converters';
import { GOPARTTIME_SOURCE } from '../../config/constants';
import { Task } from '../../types';

/**
 * Endpoints used by the GoPartTime browser extension. Authenticated with the
 * shared extension token (GOPARTTIME_API_KEY) — the equivalent of the
 * dashboard JWT for this external client.
 */
export default function createGoPartTimeRoutes(discordClient: Client): Router {
  const router = Router();

  router.use(extensionAuth);

  /**
   * Resolves a GoPartTime task number to its Statbot task, or null when no task
   * is linked to it. Shared by every read-only endpoint below so the two-step
   * resolution is defined once:
   *
   *   1. the exact `(source, externalTaskId)` link written by the userscript /
   *      automation ingest, then
   *   2. manually-created tasks whose id embeds the number ("POST #688318") —
   *      only when they carry no `source`, so a real GoPartTime task is never
   *      shadowed by a manual one.
   */
  async function findTaskByExternalId(externalTaskId: string): Promise<Task | null> {
    const linked = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, externalTaskId);
    if (linked) return toTask(linked);

    for (const candidateId of buildManualTaskIdCandidates(externalTaskId)) {
      const candidate = await taskRepository.findById(candidateId);
      if (candidate && !candidate.source) return toTask(candidate);
    }

    return null;
  }

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

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

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

  /**
   * GET /api/v1/goparttime/expected/:externalTaskId
   * Returns the exact expected text Statbot delivered to Discord for a
   * GoPartTime task (title + formattedContent + type + subreddit), so a
   * manager-browser script on reddit.com can compare the live post against
   * the Discord copy using the manager's own Reddit session (VPS-proof:
   * no server-side Reddit fetch, no rate-limit exposure).
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies tasks or reminders.
   */
  router.get('/expected/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          title: task.title,
          formattedContent: task.formattedContent,
          subreddit: task.subreddit,
          submittedRedditUrl: task.submittedRedditUrl,
          formatCheckStatus: task.formatCheckStatus,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * GET /api/v1/goparttime/submission/:externalTaskId
   * Returns the Reddit link the worker submitted in their Discord ticket for a
   * GoPartTime task, so a manager-browser script on goparttime.net can prefill
   * GoPartTime's own "Submit Task" dialog instead of copy-pasting the link out
   * of the dashboard's Accepted section by hand.
   *
   * Deliberately does NOT filter on task status. The link is written while the
   * task sits in ACCEPTED, but the manager can submit on GoPartTime at any
   * point afterwards — including after the task already moved on to PENDING —
   * and the answer is the same link either way. A status filter would make the
   * helper fail exactly when it is still useful.
   *
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies tasks.
   */
  router.get('/submission/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      const redditUrl = resolveSubmittedRedditUrl(task);

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          status: task.status,
          redditUrl,
          submittedAt: task.submittedAt,
          formatCheckStatus: task.formatCheckStatus,
          ...(redditUrl ? {} : { message: 'No Reddit link has been submitted for this task yet.' }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/goparttime/reddit-session
   * Paste/refresh the spare Reddit account's login cookie (self-service,
   * no SSH). Same vault + validation as the dashboard path. The secret is
   * never echoed back.
   */
  router.post(
    '/reddit-session',
    validateBody(z.object({
      cookie: z.string().min(50).max(12000),
      userAgent: z.string().max(500).optional().nullable(),
    })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        await redditSessionService.save(req.body, 'goparttime-extension');
        res.json({ success: true, data: { updated: true } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        res.status(400).json({ success: false, message });
      }
    },
  );

  return router;
}
