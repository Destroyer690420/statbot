import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Create a validation middleware for request body.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: messages,
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Create a validation middleware for query parameters.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({
          success: false,
          message: 'Invalid query parameters.',
          errors: messages,
        });
        return;
      }
      next(error);
    }
  };
}
