import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * JWT authentication middleware.
 * Verifies the Authorization Bearer token.
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { username: string; iat: number };
    req.userId = decoded.username;
    next();
  } catch {
    logger.warn('Invalid JWT token attempt');
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}
