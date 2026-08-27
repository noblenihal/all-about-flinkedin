import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Request cap for the profile endpoints.
 *
 * The binding constraint is not server capacity — it is that every uncached
 * request spends one LinkedIn API call against a single real account that gets
 * restricted if pushed. So the default is a strict, GLOBAL cap: all clients
 * share one bucket (`scope: 'global'`), hard-limiting total upstream calls per
 * minute regardless of source IP. Set `RATE_LIMIT_SCOPE=ip` for the
 * conventional per-client limit instead.
 */
export const profileRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // A constant key funnels every caller into a single shared window.
  keyGenerator: config.rateLimit.scope === 'global' ? () => 'global' : undefined,
  // The per-IP validation warning is irrelevant when we intentionally key globally.
  // Disable the library's IP-key validation warnings when we key globally on purpose.
  validate: config.rateLimit.scope === 'global' ? false : undefined,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. This API is globally rate-limited to protect the ' +
        'underlying account. Try again shortly.',
    },
  },
});
