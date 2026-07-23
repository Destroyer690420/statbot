import { Router, Request, Response } from 'express';
import { payoutService } from '../../services/payout.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware);

function requireDashboardAdmin(req: Request, res: Response): boolean {
  const username = (req as AuthRequest).userId || '';
  if (username !== env.DASHBOARD_USERNAME) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

/**
 * GET /api/v1/payouts/summary
 * Dashboard cards data.
 */
router.get('/summary', async (_req: Request, res: Response): Promise<void> => {
  try {
    const summary = await payoutService.getSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('GET /payouts/summary failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/eligible
 * Eligible tasks grouped by worker.
 */
router.get('/eligible', async (_req: Request, res: Response): Promise<void> => {
  try {
    const breakdown = await payoutService.getWorkerBreakdown();
    res.json({ success: true, data: breakdown });
  } catch (error) {
    logger.error('GET /payouts/eligible failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/workers/:workerId
 * Single worker detail with eligible tasks.
 */
router.get('/workers/:workerId', async (req: Request, res: Response): Promise<void> => {
  try {
    const detail = await payoutService.getWorkerDetail(String(req.params.workerId));
    if (!detail) {
      res.status(404).json({ success: false, message: 'No eligible tasks found for this worker.' });
      return;
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('GET /payouts/workers/:workerId failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/v1/payouts/pay-worker/:workerId
 * Pay a single worker's eligible tasks.
 */
router.post('/pay-worker/:workerId', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const result = await payoutService.payWorker(String(req.params.workerId), userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/v1/payouts/pay-all
 * Pay all eligible workers.
 */
router.post('/pay-all', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const result = await payoutService.payAll(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/v1/payouts/batches
 * Payout batch history.
 */
router.get('/batches', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const batches = await payoutService.getBatchHistory(limit);
    res.json({ success: true, data: batches });
  } catch (error) {
    logger.error('GET /payouts/batches failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/batches/:batchId
 * Single batch detail with items.
 */
router.get('/batches/:batchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const detail = await payoutService.getBatchDetail(String(req.params.batchId));
    if (!detail) {
      res.status(404).json({ success: false, message: 'Batch not found.' });
      return;
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('GET /payouts/batches/:batchId failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
