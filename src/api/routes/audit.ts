import { Router, Request, Response } from 'express';
import { auditLogService } from '../../services/audit.service';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/v1/audit-logs
 * Get recent audit logs, optionally filtered by task ID or action.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.query.taskId as string | undefined;
    const action = req.query.action as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    let logs;
    if (taskId) {
      logs = await auditLogService.getByTaskId(taskId, limit);
    } else {
      logs = await auditLogService.getRecent(limit);
    }

    if (action) {
      logs = logs.filter((l) => l.action === action);
    }

    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('GET /audit-logs failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
