import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

/**
 * Global error handling middleware.
 * Must be registered last in the middleware chain.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled API error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  });

  // body-parser limit rejections (e.g. a QR data URL past its scoped cap)
  // surface as JSON 413s, not 500s.
  const coded = err as Error & { status?: number; type?: string };
  if (coded.status === 413 || coded.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      message: 'Request body too large.',
    });
    return;
  }

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error.'
    : err.message;

  res.status(500).json({
    success: false,
    message,
  });
}

/**
 * 404 Not Found handler.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found.`,
  });
}
