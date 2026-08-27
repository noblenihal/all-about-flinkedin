import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';
import { ApiError } from '../util/errors';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}.`,
      documentation: '/api/v1/docs',
    },
  });
}

/**
 * Terminal error handler. Every failure leaves through here so the response
 * envelope is identical whatever went wrong, and so no stack trace or upstream
 * body ever reaches the client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logger.error('Request failed', { path: req.path, code: error.code, message: error.message });
    } else {
      logger.info('Request rejected', { path: req.path, code: error.code });
    }

    res.status(error.status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.error('Unhandled error', { path: req.path, message });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while handling the request.',
    },
  });
}
