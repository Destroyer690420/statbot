import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { commissionService } from '../../services/commission.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { isAdmin } from '../../utils/permissions';
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

function parseWeekParams(req: Request): { weekStart?: Date; weekEnd?: Date } {
  const ws = req.query.weekStart as string | undefined;
  const we = req.query.weekEnd as string | undefined;
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

const createReferralSchema = z.object({
  inviterId: z.string().min(1),
  inviterName: z.string().min(1),
  inviteeId: z.string().min(1),
  inviteeName: z.string().min(1),
  inviterType: z.enum(['normal', 'special']),
});

const updateReferralSchema = z.object({
  inviterName: z.string().min(1).optional(),
  inviteeName: z.string().min(1).optional(),
  ticketId: z.string().nullable().optional(),
});

const updateRatesSchema = z.object({
  normalInviteBonus: z.number().min(0).max(10000),
  normalInviteTaskThreshold: z.number().min(1).max(100),
  specialInviteBonus: z.number().min(0).max(10000),
  specialInviteTaskThreshold: z.number().min(1).max(100),
  specialPerComment: z.number().min(0).max(1000),
  specialPerPost: z.number().min(0).max(10000),
});

// ─── Routes ───────────────────────────────────────────────────

/**
 * GET /api/v1/commissions/rates
 */
router.get('/rates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rates = await commissionService.getCommissionRates();
    res.json({ success: true, data: rates });
  } catch (error) {
    logger.error('GET /commissions/rates failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * PUT /api/v1/commissions/rates
 */
router.put('/rates', validateBody(updateRatesSchema), async (req: Request, res: Response): Promise<void> => {
  if (!isAdmin((req as AuthRequest).userId || '')) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return;
  }

  try {
    const userId = (req as AuthRequest).userId || 'api';
    await commissionService.updateCommissionRates(req.body, userId);
    res.json({ success: true, data: req.body });
  } catch (error) {
    logger.error('PUT /commissions/rates failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/commissions/summary
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const summary = await commissionService.getSummary(weekStart, weekEnd);
    res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('GET /commissions/summary failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/commissions/breakdown
 */
router.get('/breakdown', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const breakdown = await commissionService.getBreakdown(weekStart, weekEnd);
    res.json({ success: true, data: breakdown });
  } catch (error) {
    logger.error('GET /commissions/breakdown failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/commissions/inviters/:inviterId
 */
router.get('/inviters/:inviterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { weekStart, weekEnd } = parseWeekParams(req);
    const detail = await commissionService.getInviterDetail(String(req.params.inviterId), weekStart, weekEnd);
    if (!detail) {
      res.status(404).json({ success: false, message: 'Inviter not found.' });
      return;
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('GET /commissions/inviters/:inviterId failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/commissions/referrals
 */
router.get('/referrals', async (_req: Request, res: Response): Promise<void> => {
  try {
    const referrals = await commissionService.getReferrals();
    res.json({ success: true, data: referrals });
  } catch (error) {
    logger.error('GET /commissions/referrals failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/v1/commissions/referrals
 */
router.post('/referrals', validateBody(createReferralSchema), async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const referral = await commissionService.createReferral(req.body, userId);
    res.status(201).json({ success: true, data: referral });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/v1/commissions/referrals/:referralId
 */
router.patch('/referrals/:referralId', validateBody(updateReferralSchema), async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const referral = await commissionService.updateReferral(String(req.params.referralId), req.body, userId);
    res.json({ success: true, data: referral });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * DELETE /api/v1/commissions/referrals/:referralId
 */
router.delete('/referrals/:referralId', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    await commissionService.deleteReferral(String(req.params.referralId), userId);
    res.json({ success: true, message: 'Referral deleted.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/v1/commissions/pay-inviter/:inviterId
 */
router.post('/pay-inviter/:inviterId', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const result = await commissionService.payInviter(String(req.params.inviterId), userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/v1/commissions/pay-all
 */
router.post('/pay-all', async (req: Request, res: Response): Promise<void> => {
  if (!requireDashboardAdmin(req, res)) return;

  try {
    const userId = (req as AuthRequest).userId || 'api';
    const result = await commissionService.payAll(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/v1/commissions/export/csv
 */
router.get('/export/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.query.batchId as string | undefined;
    const { weekStart, weekEnd } = parseWeekParams(req);
    const exportData = await commissionService.getCommissionExportData(batchId, weekStart, weekEnd);

    const headers = ['Inviter Name', 'Inviter Type', 'Invitee Name', 'Bonus (₹)', 'Per-Task (₹)', 'Total Commission (₹)', 'Status'];
    const rows = exportData.rows.map((r) =>
      [
        escapeCSV(r.inviterName),
        escapeCSV(r.inviterType),
        escapeCSV(r.inviteeName),
        String(r.bonusAmount),
        String(r.perTaskAmount),
        String(r.totalCommission),
        escapeCSV(r.status),
      ].join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = batchId
      ? `commission-batch-${batchId}-${Date.now()}.csv`
      : `commission-export-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('GET /commissions/export/csv failed', { error });
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

/**
 * GET /api/v1/commissions/batches
 * Commission batch history.
 */
router.get('/batches', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const batches = await commissionService.getBatchHistory(limit);
    res.json({ success: true, data: batches });
  } catch (error) {
    logger.error('GET /commissions/batches failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/v1/commissions/batches/:batchId
 * Single batch detail with items.
 */
router.get('/batches/:batchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const detail = await commissionService.getBatchDetail(String(req.params.batchId));
    if (!detail) {
      res.status(404).json({ success: false, message: 'Batch not found.' });
      return;
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('GET /commissions/batches/:batchId failed', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
