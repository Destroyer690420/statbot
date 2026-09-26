import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getDb } from '../../database/db';
import { workerPortalAccessRepository } from '../../database/repositories';
import { validateQuery } from '../middleware/validate';
import { workerAuthMiddleware, WorkerAuthRequest } from '../middleware/workerAuth';
import {
  isWorkerPortalAvailable,
  planIssueCode,
  storeIssuedCode,
  verifyOtpCode,
  readOtpRecord,
  signWorkerToken,
  buildOtpMessage,
  deleteChannelMessageBestEffort,
  scheduleOtpExpiryCleanup,
  denylistWorkerToken,
  clearOtpRecord,
  WORKER_OTP_TTL_SECONDS,
  WORKER_OTP_COOLDOWN_SECONDS,
  WorkerRedisUnavailableError,
} from '../../services/worker-auth.service';
import {
  resolveWorkerIdentityForChannel,
  getMeData,
  getHomeData,
  listTasksForWorker,
  getTaskForWorker,
  getWalletForWorker,
} from '../../services/worker.service';
import { getInvitesForWorker } from '../../services/worker-referrals.service';

/**
 * Read-only worker portal. Factory (needs the Discord client to post codes),
 * mounted BEFORE uploadRoutes/reminderRoutes in server.ts.
 * Every response carries `Cache-Control: no-store`.
 */

function isUsableTicketChannel(channel: any): boolean {
  if (!channel) return false;
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) return false;
  if (typeof channel.send !== 'function') return false;
  if (channel.guildId && channel.guildId !== env.GUILD_ID) return false;
  return true;
}

async function resolveTicketChannel(discordClient: any, channelId: string): Promise<any | null> {
  const id = String(channelId || '').trim();
  if (!id || id.length > 64) return null;
  try {
    const fetch = discordClient?.channels?.fetch;
    if (typeof fetch !== 'function') return null;
    const channel = await fetch.call(discordClient.channels, id).catch(() => null);
    if (!isUsableTicketChannel(channel)) return null;
    return channel;
  } catch {
    return null;
  }
}

/** A ticket qualifies only if it exists in the guild AND has at least one Task. Generic null otherwise. */
async function resolveLoginTicket(
  discordClient: any,
  channelId: string,
): Promise<{ channel: any; workerId: string; workerName: string | null; ticketName: string } | null> {
  const channel = await resolveTicketChannel(discordClient, channelId);
  if (!channel) return null;
  const identity = await resolveWorkerIdentityForChannel(channel.id).catch(() => null);
  if (!identity) return null;
  return {
    channel,
    workerId: identity.workerId,
    workerName: identity.workerName,
    ticketName: channel.name ?? identity.channelName ?? channel.id,
  };
}

const TICKET_NOT_FOUND = 'Ticket not found. Check the ticket number and try again.';

export default function createWorkerRoutes(discordClient: any): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ─── Public: portal status (always available so the login page can render the kill-switch message) ───
  router.get('/auth/status', (_req: Request, res: Response) => {
    res.json({ success: true, data: { enabled: isWorkerPortalAvailable(), guildId: env.GUILD_ID } });
  });

  // Kill switch: everything else 404s when the portal is disabled.
  router.use((req, res, next) => {
    if (req.path === '/auth/status') {
      next();
      return;
    }
    if (!isWorkerPortalAvailable()) {
      res.status(404).json({ success: false, message: 'Worker portal is not available.' });
      return;
    }
    next();
  });

  const ticketsLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });

  const requestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
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

  // ─── GET /auth/tickets?q= — type-ahead, max 5, {channelId, name} only ───
  router.get('/auth/tickets', ticketsLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 3) {
        res.json({ success: true, data: [] });
        return;
      }
      const needle = q.toLowerCase();
      const out: { channelId: string; name: string }[] = [];
      const seen = new Set<string>();

      // Prefer live Discord channel names: guild text channels matching q that have tasks.
      try {
        const guilds: any = discordClient?.guilds?.cache;
        const guild = guilds?.get?.(env.GUILD_ID) ?? guilds?.first?.();
        let channels: any[] = [];
        if (guild?.channels?.cache && guild.channels.cache.size > 0) {
          channels = [...guild.channels.cache.values()];
        } else if (typeof guild?.channels?.fetch === 'function') {
          const fetched = await guild.channels.fetch().catch(() => null);
          if (fetched) channels = [...fetched.values()];
        }
        const matching = channels
          .filter(
            (c) =>
              typeof c?.name === 'string' &&
              c.name.toLowerCase().includes(needle) &&
              (typeof c.isTextBased !== 'function' || c.isTextBased()),
          )
          .slice(0, 20);
        if (matching.length > 0) {
          const ids = matching.map((c) => String(c.id));
          const withTasks = await getDb().task.findMany({
            where: { channelId: { in: ids } },
            select: { channelId: true },
          });
          const hasTasks = new Set(withTasks.map((t) => t.channelId));
          for (const c of matching) {
            if (out.length >= 5) break;
            if (!hasTasks.has(String(c.id)) || seen.has(String(c.id))) continue;
            seen.add(String(c.id));
            out.push({ channelId: String(c.id), name: c.name });
          }
        }
      } catch {
        // fall through to the DB fallback below
      }

      // Fall back to stored Task.channelName for the remainder.
      if (out.length < 5) {
        const rows = await getDb().task.findMany({
          where: { channelName: { contains: q, mode: 'insensitive' } },
          select: { channelId: true, channelName: true },
          take: 50,
        });
        for (const r of rows) {
          if (out.length >= 5) break;
          if (seen.has(r.channelId)) continue;
          seen.add(r.channelId);
          const live = await resolveTicketChannel(discordClient, r.channelId).catch(() => null);
          if (!live) continue;
          out.push({ channelId: r.channelId, name: live.name ?? r.channelName ?? r.channelId });
        }
      }

      res.json({ success: true, data: out.slice(0, 5) });
    } catch (error) {
      logger.error('GET /worker/auth/tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  const requestSchema = z.object({ channelId: z.string().min(1).max(64) });

  // ─── POST /auth/request-code — post a one-time code into the ticket ───
  router.post('/auth/request-code', requestLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = requestSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'channelId is required.' });
        return;
      }
      const ticket = await resolveLoginTicket(discordClient, parsed.data.channelId).catch(() => null);
      if (!ticket) {
        res.status(404).json({ success: false, message: TICKET_NOT_FOUND });
        return;
      }

      let plan;
      try {
        plan = await planIssueCode(ticket.channel.id);
      } catch (error) {
        if (error instanceof WorkerRedisUnavailableError) {
          res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
          return;
        }
        throw error;
      }
      if (!plan.ok) {
        if (plan.reason === 'active') {
          res.status(429).json({
            success: false,
            message: 'A code was already sent to your ticket \u2014 check Discord.',
            remainingSeconds: plan.remainingSeconds,
          });
          return;
        }
        if (plan.reason === 'cooldown') {
          res.status(429).json({
            success: false,
            message: 'Please wait before requesting a new code.',
            remainingSeconds: plan.remainingSeconds,
          });
          return;
        }
        if (plan.reason === 'locked') {
          res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
          return;
        }
        res.status(429).json({ success: false, message: 'Too many codes requested. Try again later.' });
        return;
      }

      // Deliver BEFORE storing: a send failure must not leave a stored code behind.
      let messageId: string | null = null;
      try {
        const sent: any = await ticket.channel.send({
          content: buildOtpMessage(ticket.workerId, plan.code),
          allowedMentions: { users: [ticket.workerId] },
        });
        messageId = sent?.id ?? null;
      } catch (error) {
        logger.error('POST /worker/auth/request-code Discord send failed', { channelId: ticket.channel.id });
        try {
          await clearOtpRecord(ticket.channel.id);
        } catch {
          // ignore
        }
        res.status(502).json({ success: false, message: 'Could not deliver the code to Discord. Please try again.' });
        return;
      }

      try {
        await storeIssuedCode(ticket.channel.id, plan.code, messageId);
      } catch (error) {
        if (error instanceof WorkerRedisUnavailableError) {
          await deleteChannelMessageBestEffort(discordClient, ticket.channel.id, messageId);
          try {
            await clearOtpRecord(ticket.channel.id);
          } catch {
            // ignore
          }
          res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
          return;
        }
        throw error;
      }
      scheduleOtpExpiryCleanup(discordClient, ticket.channel.id, messageId);

      logger.info('Worker OTP issued', { channelId: ticket.channel.id });
      res.json({
        success: true,
        data: { expiresInSeconds: WORKER_OTP_TTL_SECONDS, cooldownSeconds: WORKER_OTP_COOLDOWN_SECONDS },
      });
    } catch (error) {
      logger.error('POST /worker/auth/request-code failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  const verifySchema = z.object({
    channelId: z.string().min(1).max(64),
    code: z.string().min(4).max(32),
  });

  // ─── POST /auth/verify-code — single-use, returns the worker JWT ───
  router.post('/auth/verify-code', verifyLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = verifySchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'channelId and code are required.' });
        return;
      }
      const ticket = await resolveLoginTicket(discordClient, parsed.data.channelId).catch(() => null);
      if (!ticket) {
        res.status(404).json({ success: false, message: TICKET_NOT_FOUND });
        return;
      }

      const before = await readOtpRecord(ticket.channel.id).catch(() => null);
      const staleMessageId = before?.record.messageId ?? null;

      let result;
      try {
        result = await verifyOtpCode(ticket.channel.id, parsed.data.code);
      } catch (error) {
        if (error instanceof WorkerRedisUnavailableError) {
          res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
          return;
        }
        throw error;
      }

      if (!result.ok) {
        if (result.reason === 'locked' || result.reason === 'invalidated') {
          await deleteChannelMessageBestEffort(discordClient, ticket.channel.id, staleMessageId);
        }
        if (result.reason === 'locked') {
          res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
          return;
        }
        if (result.reason === 'invalidated') {
          res.status(401).json({ success: false, message: 'Too many wrong attempts. Request a new code.' });
          return;
        }
        if (result.reason === 'missing') {
          res.status(401).json({ success: false, message: 'Code expired or not found. Request a new code.' });
          return;
        }
        res.status(401).json({
          success: false,
          message: `Incorrect code. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`,
        });
        return;
      }

      await deleteChannelMessageBestEffort(discordClient, ticket.channel.id, staleMessageId);

      const identity = await resolveWorkerIdentityForChannel(ticket.channel.id).catch(() => null);
      const workerId = identity?.workerId ?? ticket.workerId;
      const workerName = identity?.workerName ?? ticket.workerName;
      const token = signWorkerToken({ workerId, channelId: ticket.channel.id, name: workerName });

      try {
        await workerPortalAccessRepository.recordSuccessfulLogin(ticket.channel.id, workerId);
      } catch (error) {
        logger.warn('Worker portal access tracking failed', { channelId: ticket.channel.id, error });
      }

      logger.info('Worker OTP verified', { channelId: ticket.channel.id });
      res.json({
        success: true,
        data: { token, expiresIn: '7d', workerName, ticketName: ticket.ticketName },
      });
    } catch (error) {
      logger.error('POST /worker/auth/verify-code failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  // ─── POST /auth/logout — denylist the token's jti until its exp ───
  router.post('/auth/logout', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const payload = req.worker;
      if (payload) {
        try {
          await denylistWorkerToken(payload.jti, payload.exp * 1000);
        } catch (error) {
          if (error instanceof WorkerRedisUnavailableError) {
            logger.warn('Worker logout denylist unavailable; client must discard token');
          } else {
            throw error;
          }
        }
      }
      res.json({ success: true, data: { loggedOut: true } });
    } catch (error) {
      logger.error('POST /worker/auth/logout failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  // ─── Authenticated data endpoints (identity ONLY from the token's sub) ───

  router.get('/me', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const data = await getMeData(req.worker!.sub, req.worker!.tid);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('GET /worker/me failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  router.get('/home', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const data = await getHomeData(req.worker!.sub);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('GET /worker/home failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  const tasksQuerySchema = z.object({
    tab: z.enum(['todo', 'completed', 'failed']).default('todo'),
    sub: z.enum(['all', 'awaiting', 'paid']).default('all'),
    type: z.enum(['POST', 'COMMENT']).optional(),
    q: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  });

  router.get(
    '/tasks',
    workerAuthMiddleware,
    validateQuery(tasksQuerySchema),
    async (req: WorkerAuthRequest, res: Response): Promise<void> => {
      try {
        const q = req.query as unknown as {
          tab: 'todo' | 'completed' | 'failed';
          sub: 'all' | 'awaiting' | 'paid';
          type?: 'POST' | 'COMMENT';
          q?: string;
          page: number;
          limit: number;
        };
        const result = await listTasksForWorker(req.worker!.sub, {
          tab: q.tab,
          sub: q.sub,
          type: q.type,
          q: q.q,
          page: q.page,
          limit: q.limit,
        });
        res.json({ success: true, data: result.tasks, ...result });
      } catch (error) {
        logger.error('GET /worker/tasks failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  router.get('/tasks/:id', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const result = await getTaskForWorker(req.worker!.sub, String(req.params.id));
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

  router.get('/wallet', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const data = await getWalletForWorker(req.worker!.sub);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('GET /worker/wallet failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  router.get('/invites', workerAuthMiddleware, async (req: WorkerAuthRequest, res: Response): Promise<void> => {
    try {
      const data = await getInvitesForWorker(req.worker!.sub);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('GET /worker/invites failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  return router;
}
