import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../util/errors';

/** Constant-time comparison, so a key cannot be recovered byte-by-byte. */
function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Optional API-key gate.
 *
 * When `API_KEYS` is unset the API is open, which is the right default for a
 * reviewable demo. Setting it protects the deployment — and by extension the
 * LinkedIn account behind it — from being used as a free scraping endpoint.
 */
export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  if (config.apiKeys.length === 0) {
    next();
    return;
  }

  const header = req.get('x-api-key');
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = header || bearer;

  if (!provided) {
    next(ApiError.unauthorized('Missing API key. Send it in the "x-api-key" header.'));
    return;
  }

  if (!config.apiKeys.some((key) => matches(provided, key))) {
    next(ApiError.unauthorized('The provided API key is not valid.'));
    return;
  }

  next();
}
