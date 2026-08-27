import { Router, type Request, type Response } from 'express';
import { cacheStats } from '../linkedin/profile';
import { sessionStatus } from '../linkedin/session';

export const healthRouter = Router();

const startedAt = Date.now();

/** Liveness probe. Deliberately free of upstream calls so it never flaps. */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Operator-facing readiness detail: whether a LinkedIn session is live and, if
 * the last attempt failed, why. No credential material is exposed.
 */
healthRouter.get('/status', (_req: Request, res: Response) => {
  const session = sessionStatus();
  res.json({
    status: session.configured === 'none' ? 'unconfigured' : 'ok',
    session,
    cache: cacheStats(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});
