import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { verifyWorkerToken, WorkerTokenPayload } from '../../services/worker-auth.service';
import { logger } from '../../utils/logger';

export interface WorkerAuthRequest extends AuthRequest {
  worker?: WorkerTokenPayload;
}

/**
 * Worker-portal JWT gate. Only tokens with scope 'worker' pass.
 * Attaches req.worker = { channelId, channelName, workerId, workerName }.
 * Must be used on /api/v1/worker/* data endpoints (never on admin routes).
 */
export function workerAuthMiddleware(req: WorkerAuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    req.worker = verifyWorkerToken(token);
    next();
  } catch {
    logger.warn('Invalid worker JWT attempt');
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}
