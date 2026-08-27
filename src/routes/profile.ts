import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { fetchProfile } from '../linkedin/profile';
import { profileRateLimiter } from '../middleware/rateLimit';
import { requireApiKey } from '../middleware/apiKey';
import { ApiError } from '../util/errors';
import { extractPublicIdentifier } from '../util/url';

export const profileRouter = Router();

const querySchema = z.object({
  url: z
    .string({ required_error: 'The "url" query parameter is required.' })
    .min(1, 'The "url" query parameter must not be empty.'),
  refresh: z.enum(['true', 'false', '1', '0']).optional(),
  fast: z.enum(['true', 'false', '1', '0']).optional(),
});

const bodySchema = z.object({
  url: z.string().min(1).optional(),
  urls: z.array(z.string().min(1)).min(1).max(10).optional(),
  refresh: z.boolean().optional(),
  fast: z.boolean().optional(),
});

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/**
 * GET /api/v1/profile?url=<linkedin profile url>
 *
 * The primary endpoint. Kept as a GET with a query parameter so it is
 * trivially callable from a browser address bar or a curl one-liner.
 */
profileRouter.get(
  '/profile',
  profileRateLimiter,
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        throw ApiError.badRequest(
          'INVALID_URL',
          parsed.error.issues[0]?.message ?? 'Invalid query parameters.',
        );
      }

      const publicId = extractPublicIdentifier(parsed.data.url);
      const result = await fetchProfile(publicId, {
        refresh: truthy(parsed.data.refresh),
        fast: truthy(parsed.data.fast),
      });

      res.set('cache-control', 'public, max-age=300');
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/profile
 *
 * Same behaviour with a JSON body, plus an `urls` array for small batches.
 * Batches are processed sequentially on purpose — the outbound throttle exists
 * to protect the LinkedIn account, and parallelising here would defeat it.
 */
profileRouter.post(
  '/profile',
  profileRateLimiter,
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw ApiError.badRequest(
          'INVALID_URL',
          parsed.error.issues[0]?.message ?? 'Invalid request body.',
        );
      }

      const { url, urls, refresh, fast } = parsed.data;
      if (!url && !urls) {
        throw ApiError.badRequest('INVALID_URL', 'Provide either "url" or "urls" in the body.');
      }

      const options = { refresh: refresh === true, fast: fast === true };

      if (url && !urls) {
        const result = await fetchProfile(extractPublicIdentifier(url), options);
        res.json(result);
        return;
      }

      const results = [];
      for (const candidate of urls ?? []) {
        try {
          const publicId = extractPublicIdentifier(candidate);
          results.push({ input: candidate, ...(await fetchProfile(publicId, options)) });
        } catch (error) {
          results.push({
            input: candidate,
            success: false as const,
            error:
              error instanceof ApiError
                ? { code: error.code, message: error.message }
                : { code: 'INTERNAL_ERROR', message: 'Failed to fetch this profile.' },
          });
        }
      }

      res.json({ success: true, count: results.length, results });
    } catch (error) {
      next(error);
    }
  },
);
