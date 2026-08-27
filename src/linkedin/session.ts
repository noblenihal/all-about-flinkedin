import { config, hasCredentials, hasCookieJarEnv, hasSessionCookie } from '../config';
import { logger } from '../logger';
import { CookieJar } from '../http/cookieJar';
import { LinkedInAuthError, LinkedInChallengeError } from '../util/errors';
import {
  loginWithCredentials,
  sessionFromCookie,
  type LinkedInSessionCookies,
} from './auth';
import { clearStoredSession, loadStoredSession, saveSession } from './sessionStore';

export interface LinkedInSession extends LinkedInSessionCookies {
  createdAt: number;
  /** How the session was obtained — surfaced on /status for operators. */
  origin: 'credentials' | 'cookie' | 'cookie-jar' | 'stored';
}

/**
 * Reconstructs a full session from a serialised cookie jar in the environment.
 *
 * This is the auth path for stateless/serverless hosts (Vercel, Lambda) where
 * the filesystem is ephemeral and logging in on every cold start would provoke
 * challenges. Capture a working jar once with `npm run login:export`, set it as
 * `LINKEDIN_COOKIE_JAR`, and every instance authenticates without a login. A
 * full jar is required — a lone `li_at` is rejected by the GraphQL endpoint
 * because its synthesised JSESSIONID has no matching server session.
 */
function sessionFromCookieJarEnv(): LinkedInSession | null {
  const raw = config.linkedin.cookieJar;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed.li_at) {
      logger.warn('LINKEDIN_COOKIE_JAR is set but contains no li_at cookie; ignoring it.');
      return null;
    }

    const jar = CookieJar.fromJSON(parsed);
    const jsession = jar.get('JSESSIONID') ?? '';
    logger.info('Using LINKEDIN_COOKIE_JAR session.', { cookies: jar.names().length });

    return {
      jar,
      csrfToken: jsession.replace(/^"(.*)"$/, '$1'),
      createdAt: Date.now(),
      origin: 'cookie-jar',
    };
  } catch (error) {
    logger.warn('LINKEDIN_COOKIE_JAR could not be parsed as JSON; ignoring it.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

let current: LinkedInSession | null = null;
/** In-flight login, shared so concurrent requests trigger exactly one login. */
let pending: Promise<LinkedInSession> | null = null;
let lastError: string | null = null;
/**
 * Set once an env-supplied session (cookie-jar or li_at) has been rejected by
 * LinkedIn, so the next `establish()` skips it and falls through to a
 * credentials login instead of handing back the same dead session forever.
 */
let envSessionRejected = false;

function isExpired(session: LinkedInSession): boolean {
  return Date.now() - session.createdAt > config.linkedin.sessionMaxAgeMs;
}

async function establish(): Promise<LinkedInSession> {
  // A previously persisted session is preferred over logging in again — see
  // sessionStore for why re-authenticating is the risky path.
  const stored = loadStoredSession(config.linkedin.sessionMaxAgeMs);
  if (stored) {
    return {
      jar: stored.jar,
      csrfToken: stored.csrfToken,
      createdAt: stored.createdAt,
      origin: 'stored',
    };
  }

  // A full jar in the environment is the preferred zero-login path for
  // stateless hosts. Checked before credentials so a serverless deploy never
  // logs in at runtime — unless that jar has already been rejected, in which
  // case we skip straight to a credentials login (the fallback the operator
  // configured for exactly this case).
  if (hasCookieJarEnv() && !envSessionRejected) {
    const fromEnv = sessionFromCookieJarEnv();
    if (fromEnv) return fromEnv;
  }

  // An explicitly supplied cookie wins over logging in: it is the only path
  // that cannot be interrupted by a challenge, so an operator who sets it
  // means it.
  if (hasSessionCookie() && !envSessionRejected) {
    logger.info('Using LINKEDIN_LI_AT session cookie.');
    const cookies = sessionFromCookie(config.linkedin.liAt, config.linkedin.jsessionId);
    return { ...cookies, createdAt: Date.now(), origin: 'cookie' };
  }

  if (!hasCredentials()) {
    throw new LinkedInAuthError(
      envSessionRejected
        ? 'The configured LinkedIn session cookie was rejected and no email/password fallback ' +
          'is set. Refresh LINKEDIN_COOKIE_JAR / LINKEDIN_LI_AT, or set LINKEDIN_EMAIL and ' +
          'LINKEDIN_PASSWORD.'
        : 'No LinkedIn credentials configured. Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD, or ' +
          'set LINKEDIN_LI_AT / LINKEDIN_COOKIE_JAR to a session cookie.',
    );
  }

  if (envSessionRejected) {
    logger.warn('Env-supplied session was rejected; falling back to a credentials login.');
  }

  const cookies = await loginWithCredentials(config.linkedin.email, config.linkedin.password);
  const createdAt = Date.now();
  saveSession(cookies.jar, cookies.csrfToken, createdAt);
  // A successful login supersedes the dead env session; allow the env path
  // again only after a fresh process start.
  return { ...cookies, createdAt, origin: 'credentials' };
}

/**
 * Returns a usable session, logging in if necessary.
 *
 * Concurrent callers share a single login attempt — without this, a burst of
 * requests against a cold instance would fire simultaneous logins and get the
 * account throttled.
 */
export async function getSession(forceRefresh = false): Promise<LinkedInSession> {
  if (!forceRefresh && current && !isExpired(current)) {
    return current;
  }

  if (pending) return pending;

  pending = establish()
    .then((session) => {
      current = session;
      lastError = null;
      return session;
    })
    .catch((error: unknown) => {
      current = null;
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** Drops the cached session so the next call re-authenticates. */
export function invalidateSession(): void {
  if (current?.origin === 'cookie' || current?.origin === 'cookie-jar') {
    // The env-supplied session is dead. Mark it so `establish()` stops handing
    // it back and falls through to a credentials login if one is configured.
    logger.warn('Env-supplied LinkedIn session was rejected; will fall back to credentials.', {
      origin: current.origin,
    });
    envSessionRejected = true;
  }
  // A rejected session must not be handed back after a restart.
  clearStoredSession();
  current = null;
}

export function sessionStatus(): {
  authenticated: boolean;
  origin: string | null;
  ageSeconds: number | null;
  lastError: string | null;
  configured: 'credentials' | 'cookie' | 'cookie-jar' | 'none';
} {
  const configured = hasCookieJarEnv()
    ? 'cookie-jar'
    : hasSessionCookie()
      ? 'cookie'
      : hasCredentials()
        ? 'credentials'
        : 'none';
  return {
    authenticated: Boolean(current),
    origin: current?.origin ?? null,
    ageSeconds: current ? Math.round((Date.now() - current.createdAt) / 1000) : null,
    lastError,
    configured,
  };
}

export { LinkedInAuthError, LinkedInChallengeError };
