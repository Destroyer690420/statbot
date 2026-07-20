import { Router, Request, Response } from 'express';
import { taskService } from '../../services/task.service';
import { TaskStatus, TaskType, TaskFilters } from '../../types';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

function escapeCSV(val: string): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function tasksToCSV(tasks: any[]): string {
  const headers = ['ID', 'Type', 'Status', 'Reddit URL', 'Assigned User', 'Ticket', 'Notes', 'Created At', 'Updated At'];
  const rows = tasks.map((t) =>
    [
      escapeCSV(t.id),
      escapeCSV(t.type),
      escapeCSV(t.status),
      escapeCSV(t.redditUrl),
      escapeCSV(t.assignedUserName || t.assignedUserId),
      escapeCSV(t.channelName || t.channelId),
      escapeCSV(t.notes || ''),
      escapeCSV(t.createdAt?.toDate?.()?.toISOString() || t.createdAt || ''),
      escapeCSV(t.updatedAt?.toDate?.()?.toISOString() || t.updatedAt || ''),
    ].join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

router.get('/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: TaskFilters = {};
    if (req.query.status) filters.status = req.query.status as TaskStatus;
    if (req.query.type) filters.type = req.query.type as TaskType;

    const tasks = await taskService.findAll(req.query.guildId as string);

    let filtered = tasks;
    if (filters.status) filtered = filtered.filter((t) => t.status === filters.status);
    if (filters.type) filtered = filtered.filter((t) => t.type === filters.type);

    const csv = tasksToCSV(filtered);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error('CSV export failed', { error });
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

export default router;
