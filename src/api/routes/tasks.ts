import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { scheduleAllReminders, cancelTaskJobs } from '../../scheduler/jobs';
import { TaskType, TaskStatus, TaskFilters } from '../../types';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { logger } from '../../utils/logger';

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

    const limit = parseInt(req.query.limit as string) || 20;
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

export default router;
