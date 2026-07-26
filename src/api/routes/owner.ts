import { Router, Request, Response } from 'express';
import { env } from '../../config/env';
import { ownerEarningsService } from '../../services/owner-earnings.service';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /api/v1/owner/earnings
 * Protected by X-Earnings-Code header (4-digit PIN).
 */
router.get('/earnings', async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.headers['x-earnings-code'] as string | undefined;
    if (!code || code !== env.OWNER_PIN) {
      res.status(403).json({ success: false, message: 'Invalid access code.' });
      return;
    }

    const data = await ownerEarningsService.getEarnings();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /owner/earnings failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
