import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { CookieJar } from '../http/cookieJar';

/**
 * On-disk persistence for the LinkedIn session.
 *
 * This exists because logging in is the single riskiest thing this service
 * does: repeated logins from one IP are what provoke LinkedIn's verification
 * challenges, and a challenge takes the whole deployment down until a human
 * intervenes. Persisting the cookie jar means a restart, a redeploy, or a
 * scale-to-zero wake-up reuses the existing session instead of authenticating
 * again.
 *
 * The file contains live session cookies and is therefore treated exactly like
 * a credential: written with 0600 permissions and covered by .gitignore.
 */

interface StoredSession {
  cookies: Record<string, string>;
  csrfToken: string;
  createdAt: number;
  version: 1;
}

const STORE_PATH =
  process.env.LINKEDIN_SESSION_FILE?.trim() || path.join(process.cwd(), '.session', 'linkedin.json');

export function loadStoredSession(
  maxAgeMs: number,
): { jar: CookieJar; csrfToken: string; createdAt: number } | null {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;

    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as StoredSession;
    if (parsed.version !== 1 || !parsed.cookies?.li_at) return null;

    if (Date.now() - parsed.createdAt > maxAgeMs) {
      logger.info('Stored LinkedIn session is past its max age; ignoring it.');
      return null;
    }

    logger.info('Reusing the stored LinkedIn session.', {
      ageMinutes: Math.round((Date.now() - parsed.createdAt) / 60_000),
    });

    return {
      jar: CookieJar.fromJSON(parsed.cookies),
      csrfToken: parsed.csrfToken,
      createdAt: parsed.createdAt,
    };
  } catch (error) {
    logger.warn('Could not read the stored LinkedIn session.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function saveSession(jar: CookieJar, csrfToken: string, createdAt: number): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });

    const payload: StoredSession = { cookies: jar.toJSON(), csrfToken, createdAt, version: 1 };
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload), { mode: 0o600 });

    logger.debug('Persisted the LinkedIn session.');
  } catch (error) {
    // A read-only filesystem is normal on some hosts; the session still works
    // in memory, we just lose it on restart.
    logger.warn('Could not persist the LinkedIn session.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearStoredSession(): void {
  try {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  } catch {
    // Nothing actionable if the unlink fails.
  }
}
