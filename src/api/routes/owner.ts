import { Router, Request, Response } from 'express';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { ownerEarningsService } from '../../services/owner-earnings.service';

const router = Router();

/**
 * POST /api/v1/owner/verify
 * Verify a 4-digit PIN. Returns success/failure.
 * Body: { pin: string }
 */
router.post('/verify', (req: Request, res: Response): void => {
  try {
    const { pin } = req.body || {};
    if (!pin || typeof pin !== 'string') {
      res.status(400).json({ success: false, message: 'PIN is required.' });
      return;
    }

    if (pin !== env.OWNER_PIN) {
      res.json({ success: false, message: 'Invalid PIN.' });
      return;
    }

    res.json({ success: true, message: 'Access granted.' });
  } catch (error) {
    logger.error('POST /owner/verify failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/owner/daily-earnings
 * Calculate owner's daily net earnings from today's completed/deleted tasks.
 */
router.get('/daily-earnings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await ownerEarningsService.getDailyEarnings();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /owner/daily-earnings failed', { error });
    res.status(500).json({ success: false, message: 'Failed to calculate daily earnings.' });
  }
});

/**
 * GET /api/v1/owner/weekly-earnings
 * Calculate owner's weekly net earnings from Sunday-to-today in IST.
 */
router.get('/weekly-earnings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await ownerEarningsService.getWeeklyEarnings();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /owner/weekly-earnings failed', { error });
    res.status(500).json({ success: false, message: 'Failed to calculate weekly earnings.' });
  }
});

export default router;
