import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * Extension authentication middleware for the GoPartTime userscript.
 *
 * The extension runs on the goparttime.net origin and cannot read the
 * dashboard's JWT from localStorage, so it authenticates with a shared
 * secret (env.GOPARTTIME_API_KEY) sent as a Bearer token — the same
 * transport the dashboard uses.
 */
export function extensionAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const configuredKey = env.GOPARTTIME_API_KEY;

  if (!configuredKey) {
    logger.warn('GOPARTTIME_API_KEY is not configured; extension endpoint disabled');
    res.status(503).json({ success: false, message: 'Extension endpoint not configured.' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No extension token provided.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  if (timingSafeEqual(token, configuredKey)) {
    req.userId = 'goparttime-extension';
    next();
    return;
  }

  // TEMPORARY companion-auth diagnostics (no secret values logged — only
  // length + a truncated hash, which cannot reconstruct the token).
  try {
    const digest = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    logger.warn('Invalid extension token attempt', { ip: req.ip, tokenLen: token.length, tokenHash: digest });
  } catch {
    logger.warn('Invalid extension token attempt', { ip: req.ip });
  }
  res.status(401).json({ success: false, message: 'Invalid or expired extension token.' });
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
