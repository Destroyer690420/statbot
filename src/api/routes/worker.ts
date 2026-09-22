import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Client, TextChannel } from 'discord.js';
import rateLimit from 'express-rate-limit';
import { getDb } from '../../database/db';
import { getAllAdminIds } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import {
  issueOtp,
  verifyOtp,
  signWorkerToken,
  checkRequestThrottle,
} from '../../services/worker-auth.service';
import { workerAuthMiddleware, WorkerAuthRequest } from '../middleware/workerAuth';
import {
  getWorkerOverview,
  listWorkerTasks,
  getWorkerTask,
  listWorkerTickets,
} from '../../services/worker.service';

async function resolveTicketChannel(discordClient: Client, ticket: string): Promise<TextChannel | null> {
  const input = ticket.trim();
  if (!input) return null;
  const byId =
    discordClient.channels.cache.get(input) ||
    (await discordClient.channels.fetch(input).catch(() => null));
  if (byId instanceof TextChannel) return byId;

  const normalized = input.startsWith('#') ? input.slice(1) : input;
  const guild = discordClient.guilds.cache.first();
  if (!guild) return null;
  const byName = guild.channels.cache.find(
    (c) => c instanceof TextChannel && c.name.toLowerCase() === normalized.toLowerCase(),
  );
  return (byName instanceof TextChannel ? byName : null) as TextChannel | null;
}

async function channelIdentity(channel: TextChannel): Promise<{ workerId: string | null; workerName: string | null; channelName: string }> {
  let workerId: string | null = null;
  let workerName: string | null = null;
  try {
    await channel.guild.members.fetch().catch(() => undefined);
    const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));
    const first = candidates.first();
    if (first) {
      workerId = first.id;
      workerName = first.displayName || first.user.username;
    }
  } catch {
    // best-effort only
  }
  // Fall back to the most recent task's assignee when member fetch fails.
  if (!workerId) {
    try {
      const row = await getDb().task.findFirst({
        where: { channelId: channel.id },
        orderBy: { createdAt: 'desc' },
      });
      if (row) {
        workerId = row.assignedUserId;
        workerName = row.assignedUserName;
      }
    } catch {
      // ignore
    }
  }
  return { workerId, workerName, channelName: channel.name };
}

export default function createWorkerRoutes(discordClient: Client): Router {
  const router = Router();

  const requestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20, // per IP; per-ticket throttle (3/10min) enforced in the handler
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });

  const verifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });

  /**
   * GET /api/v1/worker/tickets (public)
   * Distinct tickets that have tasks — powers the login dropdown.
   */
  router.get('/tickets', async (_req: Request, res: Response): Promise<void> => {
    try {
      const tickets = await listWorkerTickets();
      res.json({ success: true, data: tickets });
    } catch (error) {
      logger.error('GET /worker/tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  const requestSchema = z.object({ ticket: z.string().min(1).max(100) });

  /**
   * POST /api/v1/worker/request-code (public)
   * Body { ticket: channelId | channelName }. Sends a 6-digit code into the ticket.
   */
  router.post('/request-code', requestLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = requestSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Ticket is required.' });
        return;
      }

      const channel = await resolveTicketChannel(discordClient, parsed.data.ticket);
      if (!channel) {
        // Don't reveal whether a ticket exists — but workers need feedback.
        // Generic message keeps enumeration slightly harder while staying usable.
        res.status(404).json({ success: false, message: 'Ticket not found. Check the ticket name and try again.' });
        return;
      }

      const allowed = await checkRequestThrottle(channel.id);
      if (!allowed) {
        res.status(429).json({ success: false, message: 'Too many codes requested. Please wait 10 minutes.' });
        return;
      }

      const code = await issueOtp(channel.id);
      const identity = await channelIdentity(channel);

      try {
        const mention = identity.workerId ? `<@${identity.workerId}> ` : '';
        await channel.send(
          `${mention}🔐 Your worker portal login code is **${code}**. It expires in 5 minutes. Do not share it.`,
        );
      } catch (error) {
        logger.error('POST /worker/request-code Discord send failed', { channelId: channel.id, error });
        res.status(502).json({ success: false, message: 'Could not deliver the code to Discord. Please try again.' });
        return;
      }

      logger.info('Worker OTP issued', { channelId: channel.id });
      res.json({ success: true, data: { channelId: channel.id, channelName: channel.name } });
    } catch (error) {
      logger.error('POST /worker/request-code failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  const verifySchema = z.object({
    ticket: z.string().min(1).max(100),
    code: z.string().min(4).max(12),
  });

  /**
   * POST /api/v1/worker/verify-code (public)
   * Body { ticket, code } -> worker JWT scoped to that ticket channel.
   */
  router.post('/verify-code', verifyLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = verifySchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Ticket and code are required.' });
        return;
      }

      const channel = await resolveTicketChannel(discordClient, parsed.data.ticket);
      if (!channel) {
        res.status(404).json({ success: false, message: 'Ticket not found.' });
        return;
      }

      const result = await verifyOtp(channel.id, parsed.data.code);
      if (!result.ok) {
        const message =
          result.reason === 'expired'
            ? 'Code expired. Please request a new one.'
            : result.reason === 'locked'
              ? 'Too many wrong attempts. Please request a new code.'
              : 'Incorrect code. Please try again.';
        res.status(401).json({ success: false, message });
        return;
      }

      const identity = await channelIdentity(channel);
      // Prefer the task assignee as canonical worker identity when present.
      let workerId = identity.workerId;
      let workerName = identity.workerName;
      try {
        const row = await getDb().task.findFirst({
          where: { channelId: channel.id },
          orderBy: { createdAt: 'desc' },
        });
        if (row) {
          workerId = row.assignedUserId || workerId;
          workerName = row.assignedUserName || workerName;
        }
      } catch {
        // keep Discord-derived identity
      }

      const token = signWorkerToken({
        channelId: channel.id,
        channelName: channel.name,
        workerId,
        workerName,
      });

      logger.info('Worker OTP verified', { channelId: channel.id });
      res.json({
        success: true,
        data: {
          token,
          expiresIn: '7d',
          channelId: channel.id,
          channelName: channel.name,
          workerName,
        },
      });
    } catch (error) {
      logger.error('POST /worker/verify-code failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  // ─── Authenticated worker endpoints (scoped to req.worker.channelId) ───

  router.get('/me', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const overview = await getWorkerOverview(req.worker!.channelId);
      // Prefer token identity for names, fall back to DB.
      overview.channelName = req.worker!.channelName || overview.channelName;
      if (req.worker!.workerName) overview.workerName = req.worker!.workerName;
      if (req.worker!.workerId) overview.workerId = req.worker!.workerId;
      res.json({ success: true, data: overview });
    } catch (error) {
      logger.error('GET /worker/me failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  router.get('/tasks', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const page = parseInt(req.query.page as string, 10) || 1;
      const result = await listWorkerTasks(req.worker!.channelId, { status, type }, limit, page);
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error('GET /worker/tasks failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  router.get('/tasks/:id', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const result = await getWorkerTask(req.worker!.channelId, String(req.params.id));
      if (!result) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('GET /worker/tasks/:id failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  return router;
}
