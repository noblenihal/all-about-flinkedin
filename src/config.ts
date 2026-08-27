import 'dotenv/config';

/** Returns the first of `names` that is set, or throws naming all of them. */
function requiredAny(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function num(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Credentials are resolved lazily so that `npm run build` and `--help`-style
 * invocations never explode on a machine without a .env file. The first
 * request that actually needs LinkedIn access is where a missing credential
 * turns into an error.
 */
export const config = {
  port: num('PORT', 8080),
  nodeEnv: optional('NODE_ENV', 'development'),
  logLevel: optional('LOG_LEVEL', 'info'),

  /** Comma-separated list of keys accepted in `x-api-key`. Empty = open API. */
  apiKeys: optional('API_KEYS')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),

  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    max: num('RATE_LIMIT_MAX', 10),
    /**
     * 'global' counts every client against one shared bucket (a hard cap on
     * total upstream LinkedIn calls, protecting the single real account behind
     * the API); 'ip' is the conventional per-client limit.
     */
    scope: (optional('RATE_LIMIT_SCOPE', 'global') === 'ip' ? 'ip' : 'global') as 'global' | 'ip',
  },

  cache: {
    ttlMs: num('CACHE_TTL_MS', 15 * 60_000),
    maxEntries: num('CACHE_MAX_ENTRIES', 200),
  },

  linkedin: {
    get email(): string {
      return requiredAny('LINKEDIN_EMAIL', 'LINKEDIN_USERNAME');
    },
    get password(): string {
      // `LINKEDIN_PASS` is accepted as an alias so an existing .env keeps working.
      return requiredAny('LINKEDIN_PASSWORD', 'LINKEDIN_PASS');
    },
    /** Optional pre-obtained session cookie; bypasses the login flow entirely. */
    liAt: optional('LINKEDIN_LI_AT'),
    /**
     * Optional full cookie jar as a JSON object (`{"li_at":"…","JSESSIONID":"…"}`).
     * The zero-login auth path for stateless hosts. Capture with
     * `npm run login:export`.
     */
    cookieJar: optional('LINKEDIN_COOKIE_JAR'),
    /** Optional companion cookie for `li_at`; improves request success rate. */
    jsessionId: optional('LINKEDIN_JSESSIONID'),
    userAgent: optional(
      'LINKEDIN_USER_AGENT',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ),
    requestTimeoutMs: num('LINKEDIN_TIMEOUT_MS', 20_000),
    /** Minimum gap between two outbound LinkedIn calls, to stay polite. */
    minRequestGapMs: num('LINKEDIN_MIN_REQUEST_GAP_MS', 900),
    /**
     * Upper bound on session reuse. Kept deliberately long (20 days) because
     * re-authenticating is the operation most likely to trip a LinkedIn
     * verification challenge, so a healthy session should be reused as long as
     * possible. Actual session death is caught separately by the 401/403
     * re-auth path, independent of this timer.
     */
    sessionMaxAgeMs: num('LINKEDIN_SESSION_MAX_AGE_MS', 20 * 24 * 60 * 60_000),
    /** Allow falling back to the logged-out public profile page. */
    allowPublicFallback: bool('LINKEDIN_ALLOW_PUBLIC_FALLBACK', true),
  },
} as const;

export function hasCredentials(): boolean {
  const email = process.env.LINKEDIN_EMAIL || process.env.LINKEDIN_USERNAME;
  const password = process.env.LINKEDIN_PASSWORD || process.env.LINKEDIN_PASS;
  return Boolean(email && password);
}

export function hasSessionCookie(): boolean {
  return Boolean(process.env.LINKEDIN_LI_AT);
}

export function hasCookieJarEnv(): boolean {
  return Boolean(process.env.LINKEDIN_COOKIE_JAR && process.env.LINKEDIN_COOKIE_JAR.trim());
}
