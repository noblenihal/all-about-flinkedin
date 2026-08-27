import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Per-IP request cap.
 *
 * The binding constraint here is not server capacity — it is that every
 * uncached request spends one LinkedIn API call against a single account that
 * gets restricted if pushed. The default is deliberately low.
 */
export const profileRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down and try again shortly.',
    },
  },
});
