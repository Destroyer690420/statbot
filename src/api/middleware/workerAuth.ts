import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import {
  verifyWorkerToken,
  isTokenDenylisted,
  WorkerTokenPayload,
} from '../../services/worker-auth.service';
import { logger } from '../../utils/logger';

export interface WorkerAuthRequest extends AuthRequest {
  worker?: WorkerTokenPayload;
}

/**
 * Worker-portal JWT gate. Only tokens issued by the worker login pass:
 * separate secret, typ:'worker', pinned aud/iss/alg, checked denylist.
 * Identity comes ONLY from the token's `sub`. Attaches req.worker.
 */
export function workerAuthMiddleware(req: WorkerAuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  (async () => {
    try {
      const payload = verifyWorkerToken(token);
      if (await isTokenDenylisted(payload.jti)) {
        res.status(401).json({ success: false, message: 'Invalid or expired token.' });
        return;
      }
      req.worker = payload;
      req.userId = payload.sub;
      next();
    } catch {
      logger.warn('Invalid worker JWT attempt');
      res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
  })().catch(() => {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  });
}
