import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/v1/auth/login
 * Authenticate with username/password, returns JWT token.
 */
router.post('/login', (req: Request, res: Response): void => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    if (username !== env.DASHBOARD_USERNAME || password !== env.DASHBOARD_PASSWORD) {
      logger.warn('Failed login attempt', { username });
      res.status(401).json({ success: false, message: 'Invalid credentials.' });
      return;
    }

    const token = jwt.sign(
      { username },
      env.JWT_SECRET,
      { expiresIn: '24h' },
    );

    logger.info('Successful login', { username });

    res.json({
      success: true,
      data: {
        token,
        expiresIn: '24h',
      },
    });
  } catch (error) {
    logger.error('POST /auth/login failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/v1/auth/verify
 * Verify if a JWT token is still valid.
 */
router.post('/verify', (req: Request, res: Response): void => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ success: false, message: 'Token is required.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    res.json({ success: true, data: { valid: true, decoded } });
  } catch {
    res.json({ success: true, data: { valid: false } });
  }
});

export default router;
