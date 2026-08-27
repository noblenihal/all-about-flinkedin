import { Router, type Request, type Response } from 'express';

export const docsRouter = Router();

/** Machine-readable API description, so the deployed URL documents itself. */
docsRouter.get('/docs', (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get('host')}`;

  res.json({
    name: 'LinkedIn Profile API',
    version: '1.0.0',
    description:
      'Accepts a LinkedIn profile URL and returns the profile as structured JSON.',
    baseUrl: `${base}/api/v1`,
    authentication: {
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
      note: 'Only enforced when the API_KEYS environment variable is set on the server.',
    },
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/profile',
        description: 'Fetch a single profile.',
        query: {
          url: 'required — a LinkedIn profile URL or bare /in/ slug',
          refresh: 'optional — "true" bypasses the cache',
          fast: 'optional — "true" skips enrichment calls for a quicker, thinner response',
        },
        example: `${base}/api/v1/profile?url=https://www.linkedin.com/in/williamhgates`,
      },
      {
        method: 'POST',
        path: '/api/v1/profile',
        description: 'Fetch one profile, or up to 10 sequentially.',
        body: {
          url: 'string — one profile URL',
          urls: 'string[] — up to 10 profile URLs, processed sequentially',
          refresh: 'boolean',
          fast: 'boolean',
        },
      },
      { method: 'GET', path: '/api/v1/health', description: 'Liveness probe.' },
      {
        method: 'GET',
        path: '/api/v1/status',
        description: 'LinkedIn session state and cache statistics.',
      },
    ],
    errorCodes: {
      INVALID_URL: 'The supplied URL is not a LinkedIn member profile URL.',
      UNAUTHORIZED: 'Missing or invalid API key.',
      RATE_LIMITED: 'This client exceeded the request rate limit.',
      PROFILE_NOT_FOUND: 'LinkedIn has no profile at that slug.',
      LINKEDIN_AUTH_FAILED: 'The configured LinkedIn credentials were rejected.',
      LINKEDIN_CHALLENGE_REQUIRED:
        'LinkedIn demanded a 2FA/captcha challenge that automated login cannot clear.',
      LINKEDIN_RATE_LIMITED: 'LinkedIn throttled the backing account.',
      LINKEDIN_UNAVAILABLE: 'LinkedIn could not be reached, or blocked the request.',
      INTERNAL_ERROR: 'Unexpected server-side failure.',
    },
  });
});
