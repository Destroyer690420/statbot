import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Client } from 'discord.js';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { goparttimeService } from '../../services/goparttime.service';
import { goPartTimePayloadSchema } from '../../utils/goparttime-payload';
import { scheduleAllReminders, scheduleReminderJob, cancelTaskJobs } from '../../scheduler/jobs';
import { Task, TaskType, TaskStatus, TaskFilters } from '../../types';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { logger } from '../../utils/logger';

export default function createTaskRoutes(discordClient: Client): Router {
  const router = Router();

  // All task routes require authentication
  router.use(authMiddleware);

  // ─── Validation Schemas ──────────────────────────────────────

  const createTaskSchema = z.object({
    redditUrl: z.string().min(1),
    type: z.nativeEnum(TaskType),
    channelId: z.string().min(1),
    assignedUserId: z.string().min(1),
    guildId: z.string().min(1),
    createdById: z.string().min(1),
    channelName: z.string().optional(),
    assignedUserName: z.string().optional(),
    notes: z.string().max(500).optional(),
  });

  const updateTaskSchema = z.object({
    status: z.nativeEnum(TaskStatus).optional(),
    notes: z.string().max(500).optional(),
    cancelledReason: z.string().nullable().optional(),
  });

  const reassignTaskSchema = z.object({
    ticket: z.string().min(1),
  });

  const submitUrlSchema = z.object({
    redditUrl: z.string().min(1),
  });

  // ─── Routes ──────────────────────────────────────────────────

  /**
   * GET /api/v1/tasks
   * List tasks with optional filters.
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: TaskFilters = {};

      if (req.query.status) filters.status = req.query.status as TaskStatus;
      if (req.query.type) filters.type = req.query.type as TaskType;
      if (req.query.assignedUserId) filters.assignedUserId = req.query.assignedUserId as string;
      if (req.query.channelId) filters.channelId = req.query.channelId as string;
      if (req.query.redditUrl) filters.redditUrl = req.query.redditUrl as string;

      const limit = parseInt(req.query.limit as string) || 1000;
      const tasks = await taskService.search(filters, limit);

      res.json({ success: true, data: tasks, total: tasks.length });
    } catch (error) {
      logger.error('GET /tasks failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * GET /api/v1/tasks/:id
   * Get a single task by ID.
   */
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await taskService.findById(String(req.params.id));
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      const reminders = await reminderService.findByTaskId(task.id);
      res.json({ success: true, data: { ...task, reminders } });
    } catch (error) {
      logger.error('GET /tasks/:id failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/tasks
   * Create a new task.
   */
  router.post('/', validateBody(createTaskSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await taskService.create(req.body);
      const reminders = await reminderService.createForTask(task.id, task.type, task.createdAt);
      await scheduleAllReminders(reminders);

      res.status(201).json({ success: true, data: { ...task, reminders } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      const status = message.includes('already exists') ? 409 : 400;
      res.status(status).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/assign-from-goparttime
   * Create + deliver a task from the GoPartTime extension payload.
   * Idempotent per external task ID (409 on duplicates).
   */
  router.post(
    '/assign-from-goparttime',
    validateBody(goPartTimePayloadSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await goparttimeService.assignFromGoPartTime(req.body, discordClient);
        if (!result.created) {
          res.status(409).json({
            success: false,
            message: `Task for task ${req.body.taskId} already exists.`,
            data: result.task,
          });
          return;
        }
        res.status(201).json({ success: true, data: result.task, failed: result.failed || false });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        res.status(400).json({ success: false, message });
      }
    },
  );

  /**
   * POST /api/v1/tasks/:id/submit-url
   * Record the submitted Reddit URL for a GoPartTime task.
   */
  router.post('/:id/submit-url', validateBody(submitUrlSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthRequest).userId || 'dashboard';
      const task = await goparttimeService.recordSubmission(String(req.params.id), req.body.redditUrl, userId);
      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      const status = message.includes('already') ? 409 : 400;
      res.status(status).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/:id/recheck-format
   * Re-runs the Reddit format check for a task with a submitted URL
   * (fresh posts can 404 for ~30s after publish; Reddit 429s also recover).
   */
  router.post('/:id/recheck-format', async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await goparttimeService.recheckFormat(String(req.params.id));
      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/:id/done
   * Accept an ACCEPTED task into the active workflow (status → PENDING,
   * bind submitted URL, schedule insight reminders).
   */
  router.post('/:id/done', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthRequest).userId || 'dashboard';
      const task = await goparttimeService.activateTask(String(req.params.id), userId);
      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/:id/reassign
   * Move an ACCEPTED task to a different ticket, deleting the old delivery
   * and re-delivering the task content to the new ticket.
   */
  router.post('/:id/reassign', validateBody(reassignTaskSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await goparttimeService.reassignTask(String(req.params.id), req.body.ticket, discordClient);
      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/:id/retry-assignment
   * Re-attempt delivery of a FAILED GoPartTime assignment.
   */
  router.post('/:id/retry-assignment', async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await goparttimeService.retryAssignment(String(req.params.id), discordClient);
      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * POST /api/v1/tasks/restore-unpaid-archived
   * Restore all ARCHIVED tasks that have NOT been paid back to COMPLETED.
   */
  router.post('/restore-unpaid-archived', async (_req: Request, res: Response): Promise<void> => {
    try {
      const count = await taskService.restoreUnpaidArchivedTasks();
      res.json({ success: true, data: { restored: count } });
    } catch (error) {
      logger.error('POST /tasks/restore-unpaid-archived failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * PATCH /api/v1/tasks/:id
   * Update a task (status, notes).
   */
  router.patch('/:id', validateBody(updateTaskSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = String(req.params.id);
      const task = await taskService.findById(taskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      // Handle cancelledReason override (admin manual deletion status)
      if ('cancelledReason' in req.body) {
        const reason = req.body.cancelledReason;
        const userId = (req as AuthRequest).userId || 'api';

        let updated: Task;

        if (reason !== null) {
          // Non-null → stop future reminders, keep current status
          updated = await taskService.updateCancelledReason(taskId, reason, userId);
          await cancelTaskJobs(taskId);
        } else {
          // Null → restore normal operation
          if (task.status === TaskStatus.CANCELLED) {
            // Previously auto-cancelled: reset to PENDING so worker resumes it
            updated = await taskService.restoreCancelledTask(taskId, userId);
          } else {
            // Was never cancelled, just clear the override field
            updated = await taskService.updateCancelledReason(taskId, null, userId);
          }
          // Schedule the next pending reminder so notifications resume
          const nextPending = await reminderService.findNextPending(taskId);
          if (nextPending) {
            await scheduleReminderJob(nextPending);
          }
        }

        res.json({ success: true, data: updated });
        return;
      }

      if (req.body.status) {
        const updated = await taskService.updateStatus(taskId, req.body.status);
        res.json({ success: true, data: updated });
        return;
      }

      res.json({ success: true, data: task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * DELETE /api/v1/tasks/:id
   * Delete a task.
   */
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = String(req.params.id);

      await cancelTaskJobs(taskId);
      await taskService.delete(taskId, 'api');

      res.json({ success: true, data: { deleted: taskId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, message });
    }
  });

  return router;
}
