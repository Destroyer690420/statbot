import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import reminderRoutes from './routes/reminders';
import statsRoutes from './routes/stats';
import healthRoutes from './routes/health';
import exportRoutes from './routes/export';
import auditRoutes from './routes/audit';
import uploadRoutes from './routes/uploads';

/**
 * Create and configure the Express API server.
 */
export function createApiServer(): express.Application {
  const app = express();
  app.set('trust proxy', 1);

  // ─── Security Middleware ────────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: env.DASHBOARD_URL,
    credentials: true,
  }));

  // ─── Rate Limiting ─────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });
  app.use('/api/', limiter);

  // ─── Body Parsing ──────────────────────────────────────────
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));

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
  app.use('/api/v1/tasks', taskRoutes);
  app.use('/api/v1/stats', statsRoutes);
  app.use('/api/v1/export', exportRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  // reminderRoutes mounts at /api/v1 to catch nested paths like /tasks/:id/reminders
  // MUST come last so specific paths above take priority
  app.use('/api/v1', reminderRoutes);

  // Upload routes for serving insight images
  app.use('/api/v1', uploadRoutes);

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
