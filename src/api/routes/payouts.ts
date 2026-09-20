import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { payoutService } from '../../services/payout.service';
import { sendPayoutNotification } from '../../services/payout-notification.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export default function createPayoutRoutes(discordClient: Client): Router {
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

// ─── Helpers ──────────────────────────────────────────────────

function parseWeekParams(req: Request): { weekStart?: Date; weekEnd?: Date } {
  const ws = (req.query.weekStart || req.body?.weekStart) as string | undefined;
  const we = (req.query.weekEnd || req.body?.weekEnd) as string | undefined;
  if (ws && we) {
    const weekStart = new Date(ws);
    const weekEnd = new Date(we);
    if (!isNaN(weekStart.getTime()) && !isNaN(weekEnd.getTime())) {
      return { weekStart, weekEnd };
    }
  }
  return {};
}

function escapeCSV(val: string): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Routes ───────────────────────────────────────────────────

/**
 * GET /api/v1/payouts/week
 * Get current and previous week info.
 */
router.get('/week', async (_req: Request, res: Response): Promise<void> => {
  try {
    const info = payoutService.getPayoutWeekInfo();
    res.json({ success: true, data: info });
  } catch (error) {
    logger.error('GET /payouts/week failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/summary
 * Dashboard cards data. Supports optional weekStart/weekEnd query params.
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const summary = await payoutService.getSummary(weekStart, weekEnd);
    res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('GET /payouts/summary failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/eligible
 * Eligible tasks grouped by worker. Supports optional weekStart/weekEnd query params.
 */
router.get('/eligible', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const breakdown = await payoutService.getWorkerBreakdown(weekStart, weekEnd);
    res.json({ success: true, data: breakdown });
  } catch (error) {
    logger.error('GET /payouts/eligible failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/payouts/workers/:workerId
 * Single worker detail with eligible tasks. Supports optional weekStart/weekEnd query params.
 */
router.get('/workers/:workerId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const detail = await payoutService.getWorkerDetail(String(req.params.workerId), weekStart, weekEnd);
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
 * Pay a single worker's eligible tasks. Accepts optional weekStart/weekEnd.
 * Best-effort: posts a payment-credited notice in the worker's ticket.
 * The payment itself never fails because of a Discord send failure.
 */
router.post('/pay-worker/:workerId', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const { weekStart, weekEnd } = parseWeekParams(req);
    const workerId = String(req.params.workerId);
    const result = await payoutService.payWorker(workerId, userId, weekStart, weekEnd);

    let notification: { sent: boolean; channelId: string; reason?: string } = { sent: false, channelId: result.channelId, reason: 'skipped' };
    try {
      const posts = result.items.filter((i) => i.taskType === 'POST').length;
      const comments = result.items.filter((i) => i.taskType === 'COMMENT').length;
      const totalAmount = result.items.reduce((sum, i) => sum + i.amount, 0);
      const weekLabel = payoutService.getWeekLabel(result.batch.weekStart, result.batch.weekEnd);
      notification = await sendPayoutNotification(discordClient, {
        channelId: result.channelId,
        workerId,
        totalAmount,
        posts,
        comments,
        batchNumber: result.batch.batchNumber,
        weekLabel,
        paidAt: new Date(),
      });
    } catch (notifyError) {
      logger.warn('Pay-worker notification error (payment kept)', {
        workerId,
        batchId: result.batch.id,
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }

    res.json({ success: true, data: { ...result, notification } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/v1/payouts/pay-all
 * Pay all eligible workers. Accepts optional weekStart/weekEnd.
 */
router.post('/pay-all', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const { weekStart, weekEnd } = parseWeekParams(req);
    const result = await payoutService.payAll(userId, weekStart, weekEnd);
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
 * Single batch detail with items and worker names.
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

/**
 * GET /api/v1/payouts/export/csv
 * CSV export of payout data. Accepts optional batchId or weekStart/weekEnd.
 */
router.get('/export/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.query.batchId as string | undefined;
    const { weekStart, weekEnd } = parseWeekParams(req);
    const exportData = await payoutService.getPayoutExportData(batchId, weekStart, weekEnd);

    const headers = ['Worker Name', 'Posts', 'Comments', 'Total Amount (₹)', 'Payment Date', 'Batch Number'];
    const rows = exportData.rows.map((r) =>
      [
        escapeCSV(r.workerName),
        String(r.posts),
        String(r.comments),
        String(r.totalAmount),
        escapeCSV(r.paymentDate),
        r.batchNumber ? String(r.batchNumber) : '',
      ].join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = batchId
      ? `payout-batch-${batchId}-${Date.now()}.csv`
      : `payout-export-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('GET /payouts/export/csv failed', { error });
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

  return router;
}
