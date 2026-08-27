import { config } from '../config';
import { logger } from '../logger';
import { httpRequest } from '../http/client';
import { ApiError } from '../util/errors';
import { getSession, invalidateSession } from './session';

const API_BASE = 'https://www.linkedin.com/voyager/api';

/**
 * Headers Voyager requires. Getting any of these wrong yields a 403 with an
 * empty body, which is why they are centralised here rather than per-call:
 *
 *  - `csrf-token` must equal the JSESSIONID cookie value with its surrounding
 *    quotes stripped. This is a double-submit CSRF check.
 *  - `x-restli-protocol-version: 2.0.0` selects the Rest.li 2 URL encoding.
 *    Omit it and complex query params are parsed as literal strings.
 *  - `x-li-track` carries client telemetry. LinkedIn does not validate its
 *    contents, but its absence is a strong bot signal.
 */
function voyagerHeaders(csrfToken: string, accept: string): Record<string, string> {
  return {
    accept,
    'csrf-token': csrfToken,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.24555',
      mpVersion: '1.13.24555',
      osName: 'web',
      timezoneOffset: 0,
      timezone: 'UTC',
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
    }),
    'user-agent': config.linkedin.userAgent,
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.linkedin.com/feed/',
    origin: 'https://www.linkedin.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XMLHttpRequest',
  };
}

export interface VoyagerResult {
  status: number;
  json: unknown | null;
  raw: string;
}

const GRAPHQL_URL = `${API_BASE}/graphql`;

/**
 * Issues an authenticated GraphQL call.
 *
 * The profile GraphQL queries are requested with a plain `application/json`
 * Accept header on purpose: the normalized (`normalized+json+2.1`) variant
 * makes LinkedIn's server attempt to flatten the response into a typed
 * `included` graph and throw a 500 on nested records that lack a `$type`,
 * whereas plain JSON returns the whole profile nested inline and never fails
 * that way.
 *
 * `variables` is the Rest.li-encoded variable string, e.g.
 * `(memberIdentity:williamhgates)` — already URL-shaped, so it is inserted
 * verbatim rather than percent-encoded.
 */
export async function graphqlGet(
  queryId: string,
  variables: string,
  options: { retryOnAuthFailure?: boolean } = {},
): Promise<VoyagerResult> {
  const { retryOnAuthFailure = true } = options;
  const session = await getSession();

  const url = `${GRAPHQL_URL}?variables=${variables}&queryId=${queryId}`;

  const response = await httpRequest(url, {
    headers: voyagerHeaders(session.csrfToken, 'application/json'),
    jar: session.jar,
    redirect: 'manual',
  });

  // A successful Voyager call is always a 200 with a JSON body; it never
  // redirects. So any 3xx (LinkedIn bouncing the request toward the login wall,
  // the auth-wall, or a checkpoint — regardless of the exact Location) means
  // the session is dead, as do the explicit 401/403.
  const looksUnauthenticated =
    response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400);

  if (looksUnauthenticated && retryOnAuthFailure) {
    logger.warn('GraphQL rejected the session; re-authenticating once.', {
      status: response.status,
      location: response.location,
    });
    invalidateSession();
    return graphqlGet(queryId, variables, { retryOnAuthFailure: false });
  }

  if (response.status === 429) {
    throw ApiError.upstream('LINKEDIN_RATE_LIMITED', 'LinkedIn rate-limited this account.');
  }
  if (response.status === 999) {
    throw ApiError.upstream(
      'LINKEDIN_UNAVAILABLE',
      'LinkedIn blocked the request (HTTP 999). The deployment IP is likely flagged; ' +
        'configure LINKEDIN_PROXY_URL or run from a residential IP.',
    );
  }

  let json: unknown | null = null;
  if (response.body) {
    try {
      json = JSON.parse(response.body);
    } catch {
      json = null;
    }
  }

  return { status: response.status, json, raw: response.body };
}

/**
 * Issues an authenticated Voyager call.
 *
 * On a 401/403 the session is dropped and the call is retried exactly once
 * against a fresh login — LinkedIn expires sessions server-side without
 * warning, and a single silent re-auth turns that into a non-event.
 */
export async function voyagerGet(
  path: string,
  options: { normalized?: boolean; retryOnAuthFailure?: boolean } = {},
): Promise<VoyagerResult> {
  const { normalized = false, retryOnAuthFailure = true } = options;
  const session = await getSession();

  const accept = normalized
    ? 'application/vnd.linkedin.normalized+json+2.1'
    : 'application/json';

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  const response = await httpRequest(url, {
    headers: voyagerHeaders(session.csrfToken, accept),
    jar: session.jar,
    redirect: 'manual',
  });

  // An authenticated Voyager call returns 200 JSON and never redirects; any
  // 3xx (or 401/403) means LinkedIn no longer accepts the session.
  const looksUnauthenticated =
    response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400);

  if (looksUnauthenticated && retryOnAuthFailure) {
    logger.warn('Voyager rejected the session; re-authenticating once.', {
      status: response.status,
      path,
    });
    invalidateSession();
    return voyagerGet(path, { normalized, retryOnAuthFailure: false });
  }

  if (response.status === 429) {
    throw ApiError.upstream(
      'LINKEDIN_RATE_LIMITED',
      'LinkedIn rate-limited this account. Back off before retrying.',
    );
  }

  if (response.status === 999) {
    // LinkedIn's non-standard "you look like a bot" status.
    throw ApiError.upstream(
      'LINKEDIN_UNAVAILABLE',
      'LinkedIn blocked the request (HTTP 999). The deployment IP is likely flagged; ' +
        'configure LINKEDIN_PROXY_URL or run from a residential IP.',
    );
  }

  let json: unknown | null = null;
  if (response.body) {
    try {
      json = JSON.parse(response.body);
    } catch {
      json = null;
    }
  }

  return { status: response.status, json, raw: response.body };
}

/**
 * Fetches the logged-out public profile page. Used as a last resort when the
 * authenticated paths fail — it returns far less, but it returns something.
 */
export async function fetchPublicProfileHtml(publicId: string): Promise<string | null> {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;
  const response = await httpRequest(url, {
    headers: {
      'user-agent': config.linkedin.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  if (response.status === 404) return null;
  if (response.status >= 400) {
    logger.warn('Public profile page fetch failed.', { status: response.status });
    return null;
  }
  // The auth wall is served with a 200 and no profile content.
  if (/authwall|\/uas\/login\?/.test(response.url)) return null;

  return response.body;
}
