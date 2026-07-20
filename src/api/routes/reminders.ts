import { Router, Request, Response } from 'express';
import { reminderService } from '../../services/reminder.service';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/v1/tasks/:taskId/reminders
 * Get all reminders for a task.
 */
router.get('/tasks/:taskId/reminders', async (req: Request, res: Response): Promise<void> => {
  try {
    const reminders = await reminderService.findByTaskId(String(req.params.taskId));
    res.json({ success: true, data: reminders });
  } catch (error) {
    logger.error('GET reminders failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/reminders/upcoming
 * Get upcoming reminders.
 */
router.get('/reminders/upcoming', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const reminders = await reminderService.findUpcoming(limit);
    res.json({ success: true, data: reminders });
  } catch (error) {
    logger.error('GET upcoming reminders failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * PATCH /api/v1/reminders/:id
 * Update a reminder (reschedule).
 */
router.patch('/reminders/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dueAt } = req.body;
    if (!dueAt) {
      res.status(400).json({ success: false, message: 'dueAt is required.' });
      return;
    }

    const newDate = new Date(dueAt);
    if (isNaN(newDate.getTime())) {
      res.status(400).json({ success: false, message: 'Invalid date format.' });
      return;
    }

    const updated = await reminderService.reschedule(String(req.params.id), newDate);
    res.json({ success: true, data: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

export default router;
