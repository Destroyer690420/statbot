import { Router, Request, Response } from 'express';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

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

export default router;
