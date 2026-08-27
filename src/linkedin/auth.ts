import { config } from '../config';
import { logger } from '../logger';
import { CookieJar } from '../http/cookieJar';
import { httpRequest } from '../http/client';
import { LinkedInAuthError, LinkedInChallengeError } from '../util/errors';

const AUTHENTICATE = 'https://www.linkedin.com/uas/authenticate';

/**
 * Headers that identify this client as LinkedIn's own mobile auth library.
 *
 * `/uas/authenticate` is the endpoint the Android app uses. Unlike the web
 * login — which is now a React app with no server-rendered form or CSRF input,
 * and so cannot be driven by a plain form post — this endpoint takes
 * credentials directly and answers with a small JSON verdict. The
 * `x-li-user-agent` header is what selects that JSON behaviour; without it
 * LinkedIn serves the HTML login wall instead.
 */
function authHeaders(csrfToken: string): Record<string, string> {
  return {
    'user-agent': config.linkedin.userAgent,
    'x-li-user-agent': 'LIAuthLibrary:0.0.3 com.linkedin.android:4.1.881 Asus_ASUS_Z01QD:26',
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-us',
    'x-user-language': 'en',
    'x-user-locale': 'en_US',
    ...(csrfToken ? { 'csrf-token': csrfToken } : {}),
  };
}

/** The JSON verdict `/uas/authenticate` returns. */
interface AuthenticateResult {
  login_result?: string;
  challenge_url?: string;
  status?: string;
}

export interface LinkedInSessionCookies {
  jar: CookieJar;
  /** The value Voyager expects in the `csrf-token` header. */
  csrfToken: string;
}

/**
 * Builds a session from `LINKEDIN_LI_AT` without touching the login endpoint.
 *
 * When only `li_at` is supplied we synthesise a `JSESSIONID`. LinkedIn does not
 * check that the value maps to a server-side session — it only enforces that
 * the cookie and the `csrf-token` header agree, a double-submit CSRF pattern.
 */
export function sessionFromCookie(liAt: string, jsessionId?: string): LinkedInSessionCookies {
  const jar = new CookieJar();
  jar.set('li_at', liAt);

  const raw = jsessionId?.trim() || `ajax:${Math.floor(Math.random() * 9e18).toString()}`;
  const quoted = raw.startsWith('"') ? raw : `"${raw}"`;
  jar.set('JSESSIONID', quoted);
  jar.set('lang', 'v=2&lang=en-us');

  return { jar, csrfToken: quoted.replace(/^"(.*)"$/, '$1') };
}

/** Maps LinkedIn's `login_result` codes onto messages worth showing an operator. */
const LOGIN_FAILURE_MESSAGES: Record<string, string> = {
  FAIL_LOGIN_BAD_PASSWORD: 'LinkedIn rejected the password.',
  BAD_PASSWORD: 'LinkedIn rejected the password.',
  FAIL_LOGIN_UNKNOWN_USER: 'LinkedIn does not recognise that email address.',
  UNKNOWN_USER: 'LinkedIn does not recognise that email address.',
  FAIL_LOGIN_ACCOUNT_LOCKED: 'The LinkedIn account is locked.',
  ACCOUNT_LOCKED: 'The LinkedIn account is locked.',
  FAIL_LOGIN_THROTTLED: 'LinkedIn is throttling login attempts for this account.',
};

function isChallenge(result: AuthenticateResult): boolean {
  const code = (result.login_result ?? '').toUpperCase();
  return (
    code.includes('CHALLENGE') ||
    code.includes('CAPTCHA') ||
    code.includes('2FA') ||
    Boolean(result.challenge_url)
  );
}

/**
 * Performs a full username/password login and returns the resulting cookies.
 *
 * @throws {LinkedInChallengeError} when LinkedIn interposes a 2FA/captcha step.
 * @throws {LinkedInAuthError}      when the credentials themselves are rejected.
 */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<LinkedInSessionCookies> {
  const jar = new CookieJar();

  // Step 1 — a GET seeds the anonymous tracking cookies (bcookie/bscookie/lidc)
  // that LinkedIn expects to see echoed back on the credential post.
  const seed = await httpRequest(AUTHENTICATE, {
    headers: authHeaders(''),
    jar,
    redirect: 'follow',
  });

  if (seed.status >= 400) {
    throw new LinkedInAuthError(
      `LinkedIn returned HTTP ${seed.status} from the authenticate endpoint. This usually means ` +
        'the deployment IP is blocked; set LINKEDIN_PROXY_URL or supply LINKEDIN_LI_AT.',
    );
  }

  // Present on the web flow, absent on this one. Echoed back when we have it.
  const seededSession = jar.get('JSESSIONID') ?? '';

  logger.debug('Seeded LinkedIn auth cookies', { cookies: jar.names().join(',') });

  // Step 2 — post the credentials.
  const form = new URLSearchParams({
    session_key: email,
    session_password: password,
    JSESSIONID: seededSession,
  });

  const response = await httpRequest(AUTHENTICATE, {
    method: 'POST',
    headers: {
      ...authHeaders(seededSession.replace(/"/g, '')),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    jar,
    redirect: 'manual',
  });

  let verdict: AuthenticateResult = {};
  try {
    verdict = JSON.parse(response.body) as AuthenticateResult;
  } catch {
    // A non-JSON body means we were served the HTML login wall — handled below
    // by the missing-cookie branch.
  }

  if (response.status === 429) {
    throw new LinkedInAuthError('LinkedIn rate-limited the login attempt (HTTP 429).');
  }

  if (isChallenge(verdict)) {
    throw new LinkedInChallengeError(
      'LinkedIn interrupted the login with a verification challenge (email code, captcha, or ' +
        '2FA). Automated login cannot clear this. Log in once from a browser, copy the "li_at" ' +
        'cookie, and set LINKEDIN_LI_AT.',
      verdict.challenge_url || undefined,
    );
  }

  const code = (verdict.login_result ?? '').toUpperCase();
  if (code && code !== 'PASS') {
    throw new LinkedInAuthError(
      LOGIN_FAILURE_MESSAGES[code] ?? `LinkedIn rejected the login (login_result: ${code}).`,
    );
  }

  // The authoritative success signal is the cookie, not the status code.
  if (!jar.has('li_at')) {
    throw new LinkedInAuthError(
      `Login did not produce an li_at cookie (HTTP ${response.status}). LinkedIn may have served ` +
        'the login wall instead of the auth API, which usually indicates a blocked IP.',
    );
  }

  const jsession = jar.get('JSESSIONID');
  if (!jsession) {
    throw new LinkedInAuthError('Login succeeded but LinkedIn did not set a JSESSIONID cookie.');
  }

  logger.info('LinkedIn login succeeded.');
  return { jar, csrfToken: jsession.replace(/^"(.*)"$/, '$1') };
}
