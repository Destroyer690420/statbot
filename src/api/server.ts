import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Client } from 'discord.js';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import createDiscordRoutes from './routes/discord';
import createGoPartTimeRoutes from './routes/goparttime';
import createOutreachRoutes from './routes/outreach';
import createAutomationRoutes from './routes/automation';
import reminderRoutes from './routes/reminders';
import statsRoutes from './routes/stats';
import healthRoutes from './routes/health';
import exportRoutes from './routes/export';
import auditRoutes from './routes/audit';
import uploadRoutes from './routes/uploads';
import createPayoutRoutes from './routes/payouts';
import payoutSettingsRoutes from './routes/settings';
import commissionRoutes from './routes/commissions';
import ownerRoutes from './routes/owner';
import createWorkerRoutes from './routes/worker';

/**
 * Create and configure the Express API server.
 */
export function createApiServer(discordClient: Client): express.Application {
  const app = express();
  app.set('trust proxy', 1);

  // ─── Security Middleware ────────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: [
      env.DASHBOARD_URL,
      // The GoPartTime send-task userscript calls the API from the task site.
      // Plain fetch() (mobile/stock browsers) requires these origins; the
      // Tampermonkey path uses GM_xmlhttpRequest and bypasses CORS entirely.
      'https://goparttime.net',
      'https://www.goparttime.net',
    ],
    credentials: true,
  }));

  // ─── Rate Limiting ─────────────────────────────────────────
  // The manager-browser companion polls claims/pending ~2/min from the same
  // home IP as the dashboard; those extension-key endpoints are exempt (the
  // shared secret is the gate — rate limiting adds nothing there). The assign
  // endpoint is likewise key-gated and low-frequency (a few pushes/hour max,
  // manual or companion-driven).
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // One home IP carries the dashboard (several auto-polling pages), the
    // watcher companion, and manual use at once — 100 was tripping normal
    // operation (dashboard alone polls ~7/min with the automation panel
    // open). Key-gated companion endpoints stay fully exempt below.
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
    skip: (req) =>
      req.path === '/api/v1/automation/claims/pending' ||
      req.path === '/api/v1/automation/sightings' ||
      req.path === '/api/v1/automation/burst' ||
      req.path === '/api/v1/automation/eligibility-bundle' ||
      req.path === '/api/v1/goparttime/assign',
  });
  app.use('/api/', limiter);

  // ─── Body Parsing ──────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ─── Request Logging ───────────────────────────────────────
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    next();
  });

  // ─── Routes ────────────────────────────────────────────────
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/tasks', taskRoutes(discordClient));
  app.use('/api/v1/discord', createDiscordRoutes(discordClient));
  app.use('/api/v1/goparttime', createGoPartTimeRoutes(discordClient));
  // Outreach routes (daily worker availability page)
  app.use('/api/v1/outreach', createOutreachRoutes(discordClient));
  // Automation routes (GoPartTime auto-accept: status/cycles/blocked/session;
  // companion sightings/claims share this prefix with per-path auth dispatch)
  app.use('/api/v1/automation', createAutomationRoutes(discordClient));
  app.use('/api/v1/stats', statsRoutes);
  app.use('/api/v1/export', exportRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  // Payout routes
  app.use('/api/v1/payouts', createPayoutRoutes(discordClient));
  // Settings routes
  app.use('/api/v1/settings', payoutSettingsRoutes);
  // Commission routes
  app.use('/api/v1/commissions', commissionRoutes);
  // Owner routes (hidden panel)
  app.use('/api/v1/owner', ownerRoutes);
  // Worker portal (ticket-OTP login + scoped read-only data).
  // MUST come before uploadRoutes/reminderRoutes: the reminder router 401s
  // any unmatched /api/v1/* path.
  app.use('/api/v1/worker', createWorkerRoutes(discordClient));
  // Upload routes for serving insight images (MUST come before reminderRoutes)
  app.use('/api/v1', uploadRoutes);

  // reminderRoutes mounts at /api/v1 to catch nested paths like /tasks/:id/reminders
  // MUST come last so specific paths above take priority
  app.use('/api/v1', reminderRoutes);

  // ─── Error Handling ────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Start the Express API server.
 */
export function startApiServer(app: express.Application): void {
  app.listen(env.PORT, () => {
    logger.info(`REST API server running on port ${env.PORT}`);
  });
}
