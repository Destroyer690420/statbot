import { Router, Request, Response } from 'express';
import { checkFirebaseHealth } from '../../database/firebase';
import { checkRedisHealth } from '../../scheduler/queue';
import { logger } from '../../utils/logger';

const router = Router();

const startTime = Date.now();

/**
 * GET /api/v1/health
 * Health check endpoint (no auth required).
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [dbHealthy, redisHealthy] = await Promise.all([
      checkFirebaseHealth(),
      checkRedisHealth(),
    ]);

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const allHealthy = dbHealthy && redisHealthy;

    res.status(allHealthy ? 200 : 503).json({
      success: true,
      data: {
        status: allHealthy ? 'healthy' : 'degraded',
        uptime: uptimeSeconds,
        version: '1.0.0',
        services: {
          database: dbHealthy ? 'connected' : 'disconnected',
          redis: redisHealthy ? 'connected' : 'disconnected',
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      success: false,
      data: {
        status: 'error',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export default router;
