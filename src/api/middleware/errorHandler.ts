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
