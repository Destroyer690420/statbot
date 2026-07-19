import { Router, Request, Response } from 'express';
import { analyticsService } from '../../services/analytics.service';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/v1/stats
 * Get overall task statistics.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const guildId = req.query.guildId as string | undefined;
    const stats = await analyticsService.getStats(guildId);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('GET /stats failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/stats/daily
 * Get tasks per day for the last N days.
 */
router.get('/daily', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const guildId = req.query.guildId as string | undefined;
    const data = await analyticsService.getTasksPerDay(days, guildId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /stats/daily failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/stats/types
 * Get task type distribution.
 */
router.get('/types', async (req: Request, res: Response): Promise<void> => {
  try {
    const guildId = req.query.guildId as string | undefined;
    const data = await analyticsService.getTypeDistribution(guildId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /stats/types failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/stats/employees
 * Get employee performance stats.
 */
router.get('/employees', async (req: Request, res: Response): Promise<void> => {
  try {
    const guildId = req.query.guildId as string | undefined;
    const data = await analyticsService.getEmployeePerformance(guildId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /stats/employees failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
