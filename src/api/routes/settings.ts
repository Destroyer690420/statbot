import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { settingsService } from '../../services/settings.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { isAdmin } from '../../utils/permissions';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

const updateRatesSchema = z.object({
  commentRate: z.number().min(1).max(1000),
  postRate: z.number().min(1).max(10000),
});

/**
 * GET /api/v1/settings/payout-rates
 * Get current payout rates.
 */
router.get('/payout-rates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rates = await settingsService.getPayoutRates();
    res.json({ success: true, data: rates });
  } catch (error) {
    logger.error('GET /settings/payout-rates failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * PUT /api/v1/settings/payout-rates
 * Update payout rates (admin only).
 */
router.put('/payout-rates', validateBody(updateRatesSchema), async (req: Request, res: Response): Promise<void> => {
  if (!isAdmin((req as AuthRequest).userId || '')) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return;
  }

  try {
    const { commentRate, postRate } = req.body;
    const userId = (req as AuthRequest).userId || 'api';
    await settingsService.updatePayoutRates(commentRate, postRate, userId);
    res.json({ success: true, data: { commentRate, postRate } });
  } catch (error) {
    logger.error('PUT /settings/payout-rates failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
